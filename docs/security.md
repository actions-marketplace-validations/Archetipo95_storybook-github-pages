# Security & Required Permissions

Deployment requires configuring GitHub Pages settings in your repository (`Settings > Pages > Source: GitHub Actions`).

The required workflow job permissions are:

```yaml
permissions:
  contents: read
  pages: write
  id-token: write
```

- `contents: read`: Fetch source repository files.
- `pages: write`: Upload and deploy to GitHub Pages.
- `id-token: write`: Mint OpenID Connect (OIDC) JWT tokens for authenticated Pages deployment.

For artifact mode deployments, workflows require `contents: read`, `pages: write`, and `id-token: write`.

For branch-backed directory mode deployments, publication requires `contents: write` (to update the Pages branch) and `pages: write` (to request Pages rebuilds), but does **not** require `id-token: write`:

```yaml
permissions:
  contents: write
  pages: write
```

> **Platform Note on Reusable Workflows vs Directory Mode:**
> GitHub Actions compiles all jobs in a reusable workflow (`workflow_call`) before execution. Because the reusable workflow contains both artifact deployment (`id-token: write`) and directory deployment (`contents: write`) jobs, invoking it with only directory-level permissions triggers a GitHub Actions `startup_failure` (zero materialized jobs) due to caller permission validation. For branch-backed directory deployments in external repositories, always use the supported **Option 3** pipeline invoking `Archetipo95/storybook-github-pages/publisher@v1.9.13` directly in a dedicated publish job.

The PR preview lifecycle workflows declare their own job-scoped permissions and need no caller configuration: the untrusted build job uses `contents: read` only; the trusted publish job uses `contents: write`, `pages: write`, `pull-requests: write` (for the bot comment), `actions: read` (to download the build artifact by run id), and `deployments: write` (to deactivate superseded deployments); cleanup uses `contents: write`, `pages: write`, and `deployments: write`; the janitor uses `contents: write`, `pages: write`, `deployments: write`, and `pull-requests: read`.

---
