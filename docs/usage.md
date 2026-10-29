# Usage

## Quickstart

### Option 1: Reusable Workflow (Recommended)

Call the reusable workflow directly in your repository `.github/workflows/deploy-storybook.yml`:

```yaml
name: Deploy Storybook

on:
  push:
    branches:
      - main

permissions:
  contents: read
  pages: write
  id-token: write

jobs:
  deploy-storybook:
    uses: Archetipo95/storybook-github-pages/.github/workflows/deploy-storybook.yml@v1.11.0
    with:
      path: 'storybook-static'
      package_manager: 'npm'
      build_command: 'npm run build-storybook'
```

### Option 2: Composite Action

Use the composite action in your own custom job:

```yaml
name: Custom Deploy Pipeline

on:
  push:
    branches:
      - main

permissions:
  contents: read
  pages: write
  id-token: write

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2

      - name: Build and Deploy Storybook
        uses: Archetipo95/storybook-github-pages@v1.11.0
        with:
          path: 'storybook-static'
          build_command: 'npm run build-storybook'
```

### Option 3: Trusted Directory Mode Pipeline (Branch-backed)

For branch-backed directory deployments (e.g., publishing to subdirectories on `gh-pages`), use a two-job pipeline separating unprivileged building from trusted publishing with the dedicated `publisher` action:

```yaml
name: Deploy Storybook Directory

on:
  push:
    branches:
      - main

concurrency:
  group: storybook-pages-${{ github.repository }}
  cancel-in-progress: false
  queue: max

jobs:
  build:
    name: Build Storybook
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - name: Checkout repository
        uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2

      - name: Set up Node.js
        uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4.4.0
        with:
          node-version: '24'

      - name: Install dependencies and build
        run: |
          npm ci
          npm run build-storybook

      - name: Upload static build
        uses: actions/upload-artifact@65462800fd760344b1a7b4382951275a0abb4808 # v4.3.3
        with:
          name: storybook-static
          path: storybook-static

  publish:
    name: Publish to Pages Branch
    needs: build
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pages: write
    steps:
      - name: Download build output
        uses: actions/download-artifact@fa0a91b85d4f404e444e00e005971372dc801d16 # v4.1.8
        with:
          name: storybook-static
          path: storybook-static

      - name: Checkout Pages branch
        uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2
        with:
          ref: gh-pages
          path: pages-repo
          fetch-depth: 0

      - name: Publish directory
        uses: Archetipo95/storybook-github-pages/publisher@v1.11.0
        with:
          pages_repo: ${{ github.workspace }}/pages-repo
          source_directory: ${{ github.workspace }}/storybook-static
          pages_branch: gh-pages
          target_directory: preprod
```

---

## Support Matrix & Execution Environment

`storybook-github-pages` is designed and validated for the following support matrix:

| Category             | Supported Environments                                                                   | Notes                                                                                                             |
| -------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| **Platform**         | GitHub.com (Public & Private Repositories)                                               | Uses native GitHub Pages API & OIDC JWTs                                                                          |
| **Runner OS**        | GitHub-hosted Linux (`ubuntu-latest`)                                                    | Tested on `ubuntu-latest` with Node.js 24+                                                                        |
| **Node.js Runtime**  | Node.js 24+                                                                              | Zero external npm dependencies (uses native Node.js ES modules)                                                   |
| **Package Managers** | Reusable workflow: `npm`, `yarn`, `pnpm`, `bun`; composite action: `npm`, `yarn`, `pnpm` | Bun is provisioned only in the reusable workflow's read-only build job                                            |
| **Tagging Strategy** | Immutable release tags (for example, `@v1.11.0`)                                         | **Recommended for stable, reproducible use.** Floating major tags (e.g. `@v1`) are optional and non-reproducible. |

---

## Inputs & Outputs

### Action / Workflow Inputs

| Input                         | Type      | Default              | Description                                                                                                                               |
| ----------------------------- | --------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `path`                        | `string`  | `storybook-static`   | Path to the directory containing built static Storybook files                                                                             |
| `package_manager`             | `string`  | `npm`                | Reusable workflow: `npm`, `yarn`, `pnpm`, or `bun`; composite action: `npm`, `yarn`, or `pnpm`                                            |
| `cache`                       | `boolean` | `true`               | Reusable workflow only: restore and save dependency plus Storybook compilation caches in its read-only build job                          |
| `cache_key_prefix`            | `string`  | `storybook-gh-pages` | Reusable workflow only: prefix for Bun and Storybook compilation cache keys                                                               |
| `checkout`                    | `string`  | `'true'`             | Whether to check out the repository automatically (Action only)                                                                           |
| `install_command`             | `string`  | `''`                 | Bitovi compatibility / custom dependency installation command                                                                             |
| `build_command`               | `string`  | `''`                 | Bitovi compatibility / custom Storybook build command                                                                                     |
| `custom_install_command`      | `string`  | `''`                 | Alias for `install_command`                                                                                                               |
| `custom_build_command`        | `string`  | `''`                 | Alias for `build_command`                                                                                                                 |
| `publish`                     | `string`  | `'true'`             | Whether to upload and deploy the Pages artifact                                                                                           |
| `artifact_name`               | `string`  | `github-pages`       | GitHub Pages artifact name                                                                                                                |
| `environment`                 | `string`  | `github-pages`       | GitHub Pages deployment environment name                                                                                                  |
| `mode`                        | `string`  | `artifact`           | `artifact` or trusted branch-backed `directory`                                                                                           |
| `pages_branch`                | `string`  | `gh-pages`           | Pages branch used by directory mode                                                                                                       |
| `target_directory`            | `string`  | `''`                 | Relative directory to replace; empty means the production root                                                                            |
| `site_url`                    | `string`  | `''`                 | Canonical site URL used for deployment metadata                                                                                           |
| `base_path`                   | `string`  | `''`                 | URL base path; derived from `target_directory` when empty                                                                                 |
| `cname`                       | `string`  | `''`                 | Reusable workflow, directory mode: custom domain written as a single-line `CNAME` at the Pages branch root; ignored in artifact mode      |
| `preserve_cname`              | `boolean` | `true`               | Reusable workflow, directory mode: keep the existing root `CNAME` when a root publish does not provide one                                |
| `trigger_pages_rebuild`       | `boolean` | `false`              | Whether to explicitly request a Pages rebuild after a directory publish; normally unnecessary for branch-based Pages                      |
| `preview_root`                | `string`  | `pr-preview`         | Root directory (on the Pages branch) under which PR previews are published, as `<preview_root>/pr-<number>`                               |
| `preview_retention_days`      | `number`  | `30`                 | Days an _open_ PR's preview may remain before the janitor prunes it; closed-PR previews are always eligible for removal regardless of age |
| `warning_days_before_cleanup` | `number`  | `3`                  | Days before cleanup to warn in the bot PR comment; `0` disables warnings                                                                  |
| `managed_directories`         | `string`  | `''`                 | Comma-separated directories preserved during root publication in directory mode (e.g. `pr-preview`)                                       |
| `generate_badges`             | `boolean` | `true`               | Whether to automatically generate SVG/JSON component and story count badges                                                               |
| `badges_directory`            | `string`  | `badges`             | Relative directory inside the static output where generated badges are hosted                                                             |
| `test_results_path`           | `string`  | `''`                 | Optional repository-relative path to a JSON interaction test results file (for example, `.storybook/test-results.json`)                   |
| `generate_stats_graph`        | `boolean` | `true`               | Whether to automatically generate hand-drawn growth chart (`history.svg`) and update metrics ledger (`history.json`)                      |
| `stats_directory`             | `string`  | `stats`              | Relative directory inside the static output where generated stats graph and history ledger are hosted                                     |
| `enable_passcode_gate`        | `boolean` | `false`              | Inject a client-side passcode prompt into `index.html` and `iframe.html`                                                                  |
| `passcode_session_hours`      | `number`  | `24`                 | Duration of a successful browser session                                                                                                  |
| `passcode_hash`               | `secret`  | —                    | SHA-256 hash of the passcode; provide as a workflow secret (composite action input)                                                       |
| `smoke_test`                  | `boolean` | `false`              | Run a local Playwright smoke test against the built Storybook before validation and publishing                                            |
| `smoke_test_stories`          | `string`  | `all`                | Comma-separated story id globs to exercise after the manager and canvas checks                                                            |
| `smoke_test_timeout_ms`       | `number`  | `30000`              | Per-page browser navigation timeout in milliseconds                                                                                       |
| `auto_base_url`               | `boolean` | `true`               | Automatically inject the repository or preview base URL into Storybook builds unless an explicit base option is provided                  |
| `audit_bundle_size`           | `boolean` | `false`              | Report total, gzip-estimated and per-type asset sizes in the job summary ([Bundle size](bundle-size.md))                                  |
| `bundle_size_max_mb`          | `string`  | `''`                 | Optional total static output budget in megabytes; the build fails when exceeded                                                           |

When `smoke_test` is enabled, the action serves the static output only on
`127.0.0.1`, opens the manager and canvas with Playwright, and fails on
uncaught page errors, console errors, failed requests, HTTP errors, or a
missing Storybook sidebar. It uses an installed `playwright` package when
available; otherwise it downloads Playwright and Chromium into a temporary
directory for the run. Story globs are matched against `stories.json` or
`index.json` entry ids.

### Build caching

The reusable workflow enables caching by default in its `contents: read` build job. `actions/setup-node` provides native dependency caching for `npm`, Yarn, and pnpm; Bun uses its package cache. A separate cache restores Storybook builder output from `node_modules/.cache/storybook`, `.cache/storybook`, and `.storybook/.cache`.

Set `cache: false` to disable all reusable-workflow caches, or set `cache_key_prefix` when independent cache namespaces are needed. Cache keys include the runner OS and lockfile or Storybook source/configuration hashes. The untrusted PR preview build deliberately never uses a cache, so forked pull requests cannot share build state with trusted publishing workflows. The deploy-capable composite action also does not manage caches; use the reusable workflow when a read-only cached build is required.

### Outputs

| Output          | Description                                               |
| --------------- | --------------------------------------------------------- |
| `page_url`      | The URL of the published GitHub Pages site                |
| `status`        | Status of the deployment (`success`, `skipped`, `failed`) |
| `deployment_id` | The GitHub Pages deployment ID                            |

---

## Configuration File (`.storybook-pages.yml`)

An optional `.storybook-pages.yml` file in the repository root allows centralizing configuration across workflows:

```yaml
version: 1
mode: artifact
path: storybook-static
package_manager: npm
build:
  install_command: npm ci
  build_command: npm run build-storybook
```

_Note: Explicit workflow inputs override file configuration, which in turn overrides default values._

For Bun projects, use the reusable workflow and set `package_manager: bun`. It provisions Bun in its read-only build job; the deploy-capable composite action intentionally rejects Bun so installation never runs in a job with Pages, OIDC, or write privileges. When omitted, the commands default to `bun install --frozen-lockfile` and `bun run build-storybook`:

```yaml
package_manager: bun
build:
  install_command: bun install --frozen-lockfile
  build_command: bun run build-storybook
```

### Trusted directory mode

Set `mode: directory` to publish to a shared Pages branch. The build job remains untrusted (`contents: read`) and transfers its validated output to a separate publisher job with `contents: write`. Writes are serialized by the `storybook-pages-<owner>/<repo>` concurrency group with `queue: max`: up to 100 runs wait instead of replacing each other and run first in, first out by when each run started waiting (not by when it was triggered; GitHub notes that ordering is not guaranteed; see [PR previews → Concurrency](pr-previews.md#concurrency)). A rejected push is retried on the fresh branch tip, and the configured target is staged and replaced atomically. GitHub Pages normally rebuilds automatically after a branch push; set `trigger_pages_rebuild: 'true'` only when an explicit rebuild request is needed for a non-standard Pages configuration.

Use an empty `target_directory` for the production root and a name such as `staging` for a named environment; both can coexist. Targets must be relative and cannot traverse or address `.git` or `.github`. Unrelated directories are preserved. GitHub Pages has one site/custom-domain configuration, so named environments are URL subpaths (for example `/staging`) and publication is eventually visible after the rebuild.

### Custom domains (`CNAME`)

How GitHub Pages picks up a custom domain depends on the publishing source:

- **Artifact mode** (`actions/deploy-pages`): GitHub ignores `CNAME` files in the deployed artifact. Configure the domain in repository **Settings → Pages → Custom domain**. Setting `cname` in artifact mode only emits a warning.
- **Directory mode** (branch-backed): GitHub reads the domain from the `CNAME` file at the root of the Pages branch, so that file must survive every publish.

In directory mode, an existing root `CNAME` is kept when a root publish replaces the branch contents and neither `cname` nor the build output provides one, so the custom domain is not reset and certificate renewal keeps working. Subdirectory publishes (named environments, PR previews) never touch the root `CNAME`. Set `preserve_cname: false` to let a root publish remove it.

Set `cname: storybook.example.com` to have the publisher write the file for you. The value must be a bare hostname: schemes (`https://`), ports, paths, and trailing slashes are rejected. Precedence on a root publish is: `cname` input, then a `CNAME` shipped in the build output (for example from `.storybook/public`), then the preserved branch file.

---
