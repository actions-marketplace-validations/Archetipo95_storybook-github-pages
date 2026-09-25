# PR Preview Lifecycle

Four workflows implement a full pull-request preview lifecycle on top of directory mode: `.github/workflows/pr-preview-build.yml`, `pr-preview-publish.yml`, `pr-preview-cleanup.yml`, and `pr-preview-janitor.yml`. Together they publish one preview per pull request at `<preview_root>/pr-<number>` (default `pr-preview/pr-<number>`), post exactly one bot comment with the preview URL, and clean the directory up when the PR closes - all without ever running PR-controlled code in a privileged context.

### Security model

| Stage                                  | Trigger                                              | Trust level            | What it can do                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| -------------------------------------- | ---------------------------------------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Build** (`pr-preview-build.yml`)     | `pull_request` (`opened`, `synchronize`, `reopened`) | Untrusted              | `contents: read` only. No secrets, no `pages`/`pull-requests` permission, no cache shared across builds. Builds and validates the PR's actual code (including forks), then uploads a single artifact bundling the static output with signed-shape metadata (repository, run id, PR number, base ref, head repository, head SHA, artifact name, schema version, and the computed preview target, or `null` for forks).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **Publish** (`pr-preview-publish.yml`) | `workflow_run` on completion of the build workflow   | Trusted                | Never checks out PR content. The `gate` job (read-only) accepts a run only if it succeeded, was triggered by `pull_request`, belongs to this repository, and - critically - has a non-empty `workflow_run.pull_requests[]` array. GitHub only populates that array for **same-repository** pull requests, so forked PRs are excluded by construction before any privileged job runs. The `publish` job then downloads the artifact by run id, derives the trusted target directory `<preview_root>/pr-<number>` from base/default configuration (ignoring any target altered in the PR branch), re-validates every metadata field against this trusted context, re-fetches the PR's _current_ head SHA from the API, and only proceeds if it still matches the build's head SHA (an older completed run for an already-superseded commit is skipped, never published). Only then does it publish and post/update the PR comment. |
| **Cleanup** (`pr-preview-cleanup.yml`) | `pull_request_target` (`closed`)                     | Trusted, metadata-only | Uses `pull_request_target` for a write-capable token even on forked PR closures, but only ever reads structured event fields (PR number) - it never checks out the pull request's head ref/SHA or executes any code from it. It checks out the default branch to resolve the trusted base `.storybook-pages.yml` configuration (computing `<preview_root>/pr-<number>`), checks out the trusted Pages branch, removes the directory if present (a no-op otherwise), and requests a Pages rebuild after a successful removal.                                                                                                                                                                                                                                                                                                                                                                                                     |
| **Janitor** (`pr-preview-janitor.yml`) | `workflow_dispatch` or daily `schedule`              | Trusted                | Lists live open PR numbers via the API and removes any `<preview_root>/pr-<number>` directory whose PR is no longer open, plus any still-open PR's preview older than `preview_retention_days`. Only entries matching the strict `pr-<number>` name are ever considered; everything else at the Pages branch root (production output, named environments, unrelated files) is left untouched.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

### Fork PRs

A pull request is treated as a fork whenever its head repository differs from the base repository. Fork PRs:

- **do** get a real, isolated build (so contributors see build failures), with `contents: read` and no secrets;
- **never** reach the publish job - the `gate` job's `workflow_run.pull_requests[0] != null` condition is false for forks, so the entire trusted job is skipped, not merely denied inside;
- **never** get a PR comment, a Pages write, or any other privileged side effect from this platform.

### Stale-run protection

Because multiple build runs can complete out of order (retries, re-runs, or a fast follow-up push), the publisher always compares the artifact's `headSha` against the pull request's **current** head SHA fetched live from the API at publish time, not against a cached value. A run whose commit is no longer the PR's head SHA is skipped with an explicit `skip-stale` status; it can never overwrite a newer preview.

### The preview comment

The comment is idempotent: it is identified by a stable hidden marker (`<!-- storybook-pages-preview:pr-<number> -->`), created once, and updated in place on every subsequent successful publish - never duplicated. Updates are restricted to an existing comment authored by `github-actions[bot]` with GitHub's `Bot` user type; if a user comment claims the marker, the publisher fails closed without editing or creating a comment. Comment failures are reported independently of the publish step: if the directory push already succeeded but the comment API call fails (for example, a transient GitHub outage), the job fails visibly on the comment step without rolling back or hiding the successful publish.

The PR preview comment provides a rich overview for reviewers:

- **Live Badge Row**: Real-time badges for Coverage %, Stories count, Documented Components count, and Build Status.
- **Metrics & Coverage Comparison Table**: Compares Base branch vs PR Preview metrics with computed diff deltas (e.g., `+19%` 🟢 component coverage improvement, `+10` stories 📈).
- **Collapsible Growth Chart**: An expandable `<details>` section embedding the hand-drawn `stats/history.svg` growth graph.
- **Provenance Footer**: Built commit SHA, workflow run link, and clear update timestamping.

### Configuring the preview path and retention

Both are ordinary `.storybook-pages.yml` / workflow-input settings, validated the same way as `target_directory`:

```yaml
preview_root: pr-preview # default; set to '' in .storybook-pages.yml for repository-root layout (pr-<number>)
preview_retention_days: 30 # default; 0 disables age-based pruning (closed-PR previews are still removed)
warning_days_before_cleanup: 3 # default; 0 disables inactivity warnings
```

#### Repository-Root Preview Layout (`preview_root: ''`)

When `preview_root` is set to `''` (empty string), previews are placed directly at the Pages branch root as `pr-<number>` (e.g. `pr-42`). The trusted publisher, cleanup, and janitor strictly target `pr-<number>` directories:

- **Cleanup**: Removes only the exact `pr-<closed-pr-number>` directory on PR close.
- **Janitor**: Scans the root and removes only entries matching `^pr-(\d+)$` whose PR is closed or exceeds retention; production root files (`index.html`, assets) and named environment directories (such as `staging/`) are never touched.

### Reusable Preview Lifecycle APIs

Consumers can invoke the preview publisher, cleanup, and janitor workflows and actions directly without checking out platform source or duplicating internal scripts:

#### 0. Reusable Untrusted PR Preview Bundle Action

The trusted publisher (below) expects a specific artifact contract: a workflow artifact named `storybook-preview-pr-<PR>-run-<run>` containing a `storybook/` directory (the static Storybook output) and a `preview-metadata.json` file with a SHA-256 digest binding the two together. The `preview-build` composite action produces that exact artifact from your **already-built** static Storybook output, so you never need to reimplement or copy the metadata-generation internals.

`preview-build` is intended **exclusively** for your unprivileged `pull_request` build job:

- it accepts your build output directory (`source_path`) and reads the pull request's event context (`pr_number`, `base_ref`, `head_sha`, `head_repository`) directly from `github.event.pull_request.*`, so nothing PR-controlled is ever interpolated into a shell command;
- it validates the output directory (non-empty static content, no nested `.git`, no path traversal, no symlink escapes) using the same `validate-artifact.js` module the main deploy action uses;
- it stages `preview-metadata.json` + `storybook/` and computes the content digest with the same `preview-metadata.js` module the trusted publisher independently re-validates against;
- it uploads the artifact under the deterministic name the publisher expects (or returns the name/bundle path as outputs if you set `upload: 'false'` to upload it yourself);
- it requires **no** `contents: write`, `pages`, `actions: read`, or `pull-requests: write` permission — the job that runs it needs only `contents: read` (the default for `pull_request`-triggered workflows) — and it never checks out or writes to the Pages branch, so it cannot be repurposed as a trusted publisher component even if misconfigured or run in a privileged context.
- every nested third-party action (`actions/upload-artifact`) is pinned to a full 40-character commit SHA.

A complete, secure pairing of the untrusted build job with the trusted `v1.2` publisher:

```yaml
# .github/workflows/pr-preview-build.yml (untrusted, runs for same-repo and fork PRs alike)
name: PR Preview Build

on:
  pull_request:
    types: [opened, synchronize, reopened]

permissions:
  contents: read # the only permission this job ever needs

jobs:
  build:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          ref: ${{ github.event.pull_request.head.sha }}
          persist-credentials: false

      # Replace with your real install/build commands (or the main `Archetipo95/storybook-github-pages@v1.9.13`
      # composite action with `publish: 'false'`) so `storybook-static` contains your actual build output.
      - run: npm ci && npm run build-storybook

      - name: Package and upload preview bundle
        uses: Archetipo95/storybook-github-pages/preview-build@v1.9.13
        with:
          source_path: storybook-static # your built static Storybook output directory
```

```yaml
# .github/workflows/pr-preview-publish.yml (trusted, only runs after the build above completes)
name: PR Preview Publish

on:
  workflow_run:
    workflows: ['PR Preview Build']
    types: [completed]

permissions:
  contents: write
  pages: write
  deployments: write
  pull-requests: write
  actions: read

jobs:
  publish:
    uses: Archetipo95/storybook-github-pages/.github/workflows/pr-preview-publish.yml@v1.9.13
    with:
      pages_branch: 'gh-pages'
```

Required inputs/outputs and the artifact contract at a glance:

| Input            | Required | Default      | Description                                                     |
| ---------------- | -------- | ------------ | --------------------------------------------------------------- |
| `source_path`    | Yes      | —            | Path to the already-built static Storybook output directory     |
| `preview_root`   | No       | `pr-preview` | Must match the trusted publisher's configured `preview_root`    |
| `upload`         | No       | `true`       | Set `'false'` to stage the bundle without uploading it yourself |
| `retention_days` | No       | `7`          | Artifact retention when `upload` is true                        |

| Output           | Description                                                                                                  |
| ---------------- | ------------------------------------------------------------------------------------------------------------ |
| `artifact_name`  | The deterministic `storybook-preview-pr-<PR>-run-<run>` artifact name used; there is no input to override it |
| `bundle_dir`     | Path to the staged `storybook/` + `preview-metadata.json` bundle                                             |
| `content_digest` | SHA-256 digest binding `storybook/` to `preview-metadata.json`                                               |
| `is_fork`        | Whether the pull request head repository differs from the base repository                                    |

The artifact name is **not configurable**: it is always derived from the validated pull request number and run id available to the untrusted build job, so this action can never emit an artifact outside the exact `storybook-preview-pr-<PR>-run-<run>` namespace the trusted publisher expects, and cannot be used to redirect or spoof a different artifact name.

The action fails closed (non-zero exit, no artifact uploaded) if it is invoked outside a `pull_request`-triggered job (`github.event_name` is not `pull_request`, `github.event.pull_request.number` is empty, or the pull request number/run id are not positive integers), if `source_path` fails artifact validation, or if any event-context field is malformed - the same strict, shell/path-safe validation the trusted publisher itself relies on.

#### 1. Reusable Trusted PR Preview Publisher

Call the reusable publisher workflow on completion of your unprivileged PR build workflow (`workflow_run: types: [completed]`):

```yaml
name: PR Preview Publish

on:
  workflow_run:
    workflows: ['PR Preview Build']
    types: [completed]

permissions:
  contents: write
  pages: write
  pull-requests: write
  actions: read

jobs:
  publish:
    uses: Archetipo95/storybook-github-pages/.github/workflows/pr-preview-publish.yml@v1.9.13
    with:
      preview_root: '' # optional: override preview root; defaults to .storybook-pages.yml or 'pr-preview'
      pages_branch: 'gh-pages'
      trigger_pages_rebuild: true # optional: required for branch-based/legacy Pages setups that do not auto-rebuild on gh-pages pushes
      enable_passcode_gate: true
      passcode_session_hours: 24
    secrets:
      passcode_hash: ${{ secrets.STORYBOOK_PREVIEW_PASSCODE_HASH }}
```

`trigger_pages_rebuild` is only needed when your Pages setup does not automatically rebuild after a push to the Pages branch (for example, older branch-based/legacy Pages configurations using `gh-pages` as the source). When enabled, the publisher waits for GitHub Pages to report a successful build of the exact commit it pushed and fails if no matching build appears. In standard branch-based Pages setups GitHub usually rebuilds automatically after the publish commit, so the default `false` value is appropriate.

Or call the composite action `preview-publisher` in a custom `workflow_run` job:

```yaml
steps:
  - name: Fetch current PR head SHA
    id: current
    env:
      GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      REPOSITORY: ${{ github.repository }}
      PR_NUMBER: ${{ github.event.workflow_run.pull_requests[0].number }}
    run: |
      response=$(curl -sf -H "authorization: token $GITHUB_TOKEN" -H "accept: application/vnd.github+json" "https://api.github.com/repos/$REPOSITORY/pulls/$PR_NUMBER")
      sha=$(node -e 'console.log(JSON.parse(process.argv[1]).head.sha)' "$response")
      echo "head_sha=$sha" >> "$GITHUB_OUTPUT"

  - name: Download build artifact
    uses: actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c # v8.0.1
    with:
      name: storybook-preview-pr-${{ github.event.workflow_run.pull_requests[0].number }}-run-${{ github.event.workflow_run.id }}
      run-id: ${{ github.event.workflow_run.id }}
      github-token: ${{ secrets.GITHUB_TOKEN }}
      path: ${{ runner.temp }}/preview-bundle

  - name: Checkout Pages branch
    uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
    with:
      ref: gh-pages
      path: pages-repo
      fetch-depth: 0
      token: ${{ secrets.GITHUB_TOKEN }}

  - name: Validate provenance and publish preview
    uses: Archetipo95/storybook-github-pages/preview-publisher@v1.9.13
    with:
      bundle_dir: ${{ runner.temp }}/preview-bundle
      pages_repo: pages-repo
      pages_branch: gh-pages
      preview_root: ''
      trusted_repository: ${{ github.repository }}
      trusted_run_id: ${{ github.event.workflow_run.id }}
      trusted_pr_number: ${{ github.event.workflow_run.pull_requests[0].number }}
      trusted_head_sha: ${{ github.event.workflow_run.head_sha }}
      trusted_head_repository: ${{ github.event.workflow_run.head_repository.full_name }}
      trusted_base_ref: ${{ github.event.workflow_run.pull_requests[0].base.ref }}
      expected_artifact_name: storybook-preview-pr-${{ github.event.workflow_run.pull_requests[0].number }}-run-${{ github.event.workflow_run.id }}
      current_head_sha: ${{ steps.current.outputs.head_sha }}
      enable_passcode_gate: true
      passcode_session_hours: 24
      passcode_hash: ${{ secrets.STORYBOOK_PREVIEW_PASSCODE_HASH }}
```

The preview gate is configured only in the trusted publisher. `passcode_hash`
must be a 64-character SHA-256 hash stored as a secret; it is never included
in the untrusted `pull_request` build artifact. The publisher validates
provenance and the artifact content digest first, then injects the existing
gate immediately before publishing. Omit `enable_passcode_gate` (or set it to
`false`) to publish without a gate.

#### 2. Reusable Closed-PR Preview Cleanup

Call the reusable workflow on PR closure (`pull_request_target: types: [closed]`):

```yaml
name: PR Preview Cleanup

on:
  pull_request_target:
    types: [closed]

permissions:
  contents: write
  pages: write

jobs:
  cleanup:
    uses: Archetipo95/storybook-github-pages/.github/workflows/pr-preview-cleanup.yml@v1.9.13
    with:
      preview_root: '' # optional: override preview root; defaults to .storybook-pages.yml or 'pr-preview'
      pages_branch: 'gh-pages'
```

Or call the composite action in a custom job:

```yaml
steps:
  - name: Checkout Pages branch
    uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2
    with:
      ref: gh-pages
      path: pages-repo
      token: ${{ secrets.GITHUB_TOKEN }}
  - name: Remove preview directory
    uses: Archetipo95/storybook-github-pages/preview-cleanup@v1.9.13
    with:
      pages_repo: pages-repo
      pages_branch: gh-pages
      preview_root: ''
      pr_number: ${{ github.event.pull_request.number }}
```

The job running this composite action also needs `deployments: write` because
cleanup deactivates the deployment associated with a removed preview.

#### 3. Reusable Stale-Preview Janitor

Call the reusable janitor workflow on schedule or dispatch:

```yaml
name: PR Preview Janitor

on:
  workflow_dispatch:
  schedule:
    - cron: '17 4 * * *'

permissions:
  contents: write
  pages: write
  deployments: write
  pull-requests: read

jobs:
  janitor:
    uses: Archetipo95/storybook-github-pages/.github/workflows/pr-preview-janitor.yml@v1.9.13
    with:
      preview_root: ''
      pages_branch: 'gh-pages'
      retention_days: '30'
```

Or use the composite action directly:

```yaml
steps:
  - name: Checkout Pages branch
    uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2
    with:
      ref: gh-pages
      path: pages-repo
      token: ${{ secrets.GITHUB_TOKEN }}
  - name: Prune stale previews
    uses: Archetipo95/storybook-github-pages/preview-janitor@v1.9.13
    with:
      pages_repo: pages-repo
      pages_branch: gh-pages
      preview_root: ''
      retention_days: '30'
```

The job running this composite action needs `deployments: write` and
`pull-requests: read` to deactivate deployments and identify live PRs.

### Adapting the templates to another repository

This repository ships the four workflows above as a working reference implementation using its own bundled `test/fixtures/sample-storybook` fixture as a stand-in Storybook build (it has no Storybook of its own). To adopt them in a repository that does build a real Storybook:

1. Copy the four `pr-preview-*.yml` workflows into your repository's `.github/workflows/`.
2. Replace the build step in `pr-preview-build.yml` with your real install/build commands (or the composite action with `path` set to your actual build output directory).
3. Ensure a `gh-pages` (or your configured `pages_branch`) branch exists; the publish/cleanup/janitor workflows all target it.
4. Optionally add `preview_root`/`preview_retention_days` to `.storybook-pages.yml`.

---
