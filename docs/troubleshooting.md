# Troubleshooting Guide

### 1. GitHub Pages Deployment 404

- **Symptom**: Deployment completes successfully, but accessing the site URL returns HTTP 404.
- **Causes & Solutions**:
  - **Build Directory**: Ensure your `path` input points to the directory containing the static output (e.g. `storybook-static` or `dist/storybook`). The output must contain an `index.html` file.
  - **GitHub Pages Source Setting**: Ensure repository settings have GitHub Pages enabled (`Settings > Pages > Source: GitHub Actions` for artifact mode, or `Deploy from a branch: gh-pages` for directory mode).
  - **Subpath / Base Path**: If publishing to a subpath (e.g., directory mode target `staging` or `pr-preview/pr-12`), ensure your Storybook build is configured with matching asset relative paths (`--base-path` or relative URL resolution).

### 2. Permission Denied Errors in GitHub Actions

- **Symptom**: Workflow fails with `403 Forbidden` or `Resource not accessible by integration`.
- **Causes & Solutions**:
  - **Artifact Mode**: The calling workflow job requires `pages: write` and `id-token: write` permissions.
  - **Directory Mode**: The calling workflow job requires `contents: write` and `pages: write` permissions.
  - **Repository Settings**: Verify `Settings > Actions > General > Workflow permissions` is configured to allow workflows to read/write as appropriate.

### 3. PR Preview Publish Gate Skipped for Fork PRs

- **Symptom**: `pr-preview-publish.yml` workflow run shows as skipped for a pull request from an external fork.
- **Explanation**: This is intentional security behavior. External forks execute build code in an unprivileged runner (`contents: read`). For security, the trusted `workflow_run` publisher gates on `workflow_run.pull_requests[0] != null`, which GitHub populates only for same-repository PRs. Fork PRs produce build artifacts but are never permitted to publish or comment.

### 4. Stale Run Skipped (`skip-stale`)

- **Symptom**: `pr-preview-publish.yml` outputs `status: skipped` with a stale run notice.
- **Explanation**: The publish workflow's `gate` job fetches the pull request's current head SHA, and the publish job compares it with the build artifact's head SHA. If a newer commit was pushed while an older run was building, the older run skips publishing to avoid overwriting newer code.

### 5. Artifact Validation Failures

- **Symptom**: `validate-artifact.js` fails with `Path escapes workspace root` or `No static content found`.
- **Causes & Solutions**:
  - **Path Escape**: Ensure `path` is relative to the workspace root and contains no `../` traversal or external symlinks.
  - **Empty Output**: Verify that your build command actually produced files in the specified `path` directory before validation runs.

### 6. Missing Pages Branch (`gh-pages`)

- **Symptom**: Directory mode or PR preview workflows fail when attempting to check out `gh-pages`.
- **Solution**: Create the `gh-pages` branch if it does not yet exist in your repository:
  ```bash
  git checkout --orphan gh-pages
  git rm -rf .
  echo "# GitHub Pages" > README.md
  git add README.md
  git commit -m "Initialize gh-pages branch"
  git push origin gh-pages
  git checkout main
  ```

### 7. Preview Artifact Download in Trusted Workflows (`fatal: not a git repository`)

- **Symptom**: In a trusted `workflow_run` preview publisher workflow that does not check out PR-controlled code, artifact download fails with `fatal: not a git repository`.
- **Causes & Solutions**:
  - **CLI Git Discovery**: When running `gh run download <run-id> --name <artifact>` in a runner environment without a Git checkout, `gh` defaults to querying local Git remotes in the working directory. Provide repository context via environment `env: GH_REPO: ${{ github.repository }}` (or `--repo ${{ github.repository }}`) and `GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}` so `gh` operates without requiring a local Git checkout.
  - **Actions download-artifact (Recommended)**: Use `actions/download-artifact@v4` with explicit `run-id: ${{ github.event.workflow_run.id }}` and `github-token: ${{ secrets.GITHUB_TOKEN }}`. This downloads the artifact directly via GitHub Actions APIs without executing untrusted code or requiring a local checkout.

### 8. Reusable Workflow Permissions & Concurrency Constraints

- **Symptom**: Workflow fails to trigger, encounters `403 Resource not accessible by integration`, fails workflow validation, or a Pages write never starts when calling reusable workflows (`workflow_call`).
- **Causes & Solutions**:
  - **Concurrency**: The reusable workflows already join the shared `storybook-pages-<owner>/<repo>` group with `cancel-in-progress: false` and `queue: max`: `deploy-storybook.yml` at workflow level, and `pr-preview-publish.yml`, `pr-preview-cleanup.yml` and `pr-preview-janitor.yml` on the job that writes the Pages branch. A called workflow gets the caller's `github` context, so the group already names your repository. Do not declare the same group on the workflow or job that calls them: the caller would hold the group that the called jobs wait for. If you set `queue: max` on a group of your own, keep `cancel-in-progress: false`; GitHub rejects the combination with `cancel-in-progress: true`. See [Concurrency](pr-previews.md#concurrency).
  - **Required Caller Permissions**: When invoking `pr-preview-publish.yml` via `workflow_call`, ensure your caller workflow grants the required permissions:
    ```yaml
    permissions:
      contents: write # to update gh-pages branch
      pages: write # to request GitHub Pages build triggers
      pull-requests: write # to post/update the preview comment
      actions: read # to download the untrusted build artifact
    ```
  - **Canonical Site URL Auto-Detection**: `site_url` is optional. If omitted in `.storybook-pages.yml` or workflow inputs, the action automatically derives the standard GitHub Pages URL `https://<owner>.github.io/<repo>` (or `https://<owner>.github.io` for user/organization pages repositories).

### 9. Vite/Rollup Underscore Assets 404 (Jekyll & .nojekyll)

- **Symptom**: In browser developer tools console, Storybook fails to render with `404 Not Found` for files like `assets/_plugin-vue_export-helper-*.js` or `TypeError: Failed to fetch dynamically imported module`.
- **Cause**: GitHub Pages uses Jekyll by default. Jekyll ignores files and folders prefixed with an underscore (`_`), which Vite and Rollup frequently produce for helper chunks.
- **Solution**:
  - `storybook-github-pages` automatically injects a `.nojekyll` file at the root of `gh-pages` and within build bundles.
  - If using a custom deployment workflow, ensure `.nojekyll` exists at the root of the `gh-pages` branch.
  - Ensure your `.storybook/main.ts` configures `base: './'` in `viteFinal` as described in the [Modern Bundlers guide](bundlers.md).

### 10. PR Preview Publish or Cleanup Cancelled (`Canceling since a higher priority waiting request ... exists`)

- **Symptom**: A `pr-preview-publish.yml` or `pr-preview-cleanup.yml` run is cancelled with `Canceling since a higher priority waiting request for storybook-pages-<owner>/<repo> exists`. The preview URL returns 404 and no preview comment is posted, or a closed PR's preview stays until the janitor removes it. It happens most when several PRs build at once.
- **Cause**: v1.11.0 and earlier used GitHub's default concurrency queue, which keeps only one pending run in the shared `storybook-pages-<owner>/<repo>` group and cancels it whenever another Pages writer queues.
- **Solution**:
  - Update the `pr-preview-publish.yml`, `pr-preview-cleanup.yml`, `pr-preview-janitor.yml` and `deploy-storybook.yml` refs to a release that sets `queue: max` on the group (see [Concurrency](pr-previews.md#concurrency)).
  - Add `queue: max` to any workflow of your own that declares the `storybook-pages-${{ github.repository }}` group.
  - To restore an open PR's missing preview, re-run the PR's latest `PR Preview Build` run, or open the cancelled publish run and choose **Re-run all jobs** (`gh run rerun <run-id>`) so the `gate` job re-reads the PR head. If the PR has moved on, that publish skips as `skip-stale`.
  - Never use **Re-run failed jobs** (`gh run rerun <run-id> --failed`) on a publish run, and never re-run the `publish` job on its own (**Re-run job** on `publish`, or `gh run rerun --job <publish-job-id>`). Both reuse the head SHA the `gate` job fetched before the cancellation, so they can publish a stale commit over a newer preview.
  - For a cancelled cleanup, run the janitor manually (`workflow_dispatch`) instead of re-running the cleanup. The janitor removes previews of PRs that are no longer open (plus open-PR previews older than `preview_retention_days`), so it keeps a reopened PR's fresh preview, while a re-run cleanup also deletes the preview of a reopened PR.

---
