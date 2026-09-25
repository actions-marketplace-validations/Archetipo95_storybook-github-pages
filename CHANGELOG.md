# Changelog

All notable changes to `storybook-github-pages` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

## [1.9.14] - 2026-09-25

### Fixed

- Apply coverage include/ignore filters to stats history so `history.json` and `history.svg` match badge coverage metrics.

## [1.9.13] - 2026-09-24

### Changed

- Update the reusable PR preview publish workflow's internal `preview-publisher` pin so PR preview graphs use the component-only red/green renderer.

## [1.9.12] - 2026-09-24

### Changed

- Plot total components in red and covered components in green in `stats/history.svg`; story counts remain in badges and JSON but are no longer plotted.

## [1.9.11] - 2026-09-24

### Changed

- Update the reusable PR preview publish workflow's internal `preview-publisher` pin so PR preview graphs also use compact stats graph rendering.

## [1.9.10] - 2026-09-24

### Changed

- Render `stats/history.svg` with metric-changing snapshots plus the latest snapshot, while keeping `stats/history.json` as the complete deployment ledger.

## [1.9.9] - 2026-09-24

### Fixed

- Prevent preview metadata test fixtures from leaking synthetic PR numbers and SHAs into real CI job summaries.
- Make reusable PR preview cleanup tolerate missing numeric `pr_number` inputs and optional post-cleanup Pages/comment update failures.
- Update the reusable cleanup workflow's internal `preview-cleanup` pin so consumers receive the resilient cleanup behavior.

## [1.9.8] - 2026-09-24

### Fixed

- **Preview Cleanup Rebuild Resilience**: Closing a PR still removes its preview directory and updates preview metadata, but a transient GitHub Pages rebuild failure for that intermediate cleanup commit is now reported as an explicit warning instead of failing the whole cleanup workflow. This avoids false-negative cleanup runs when a production deploy immediately follows and succeeds.

## [1.9.7] - 2026-09-24

### Added

- **Lean Testing Strategy and Demo Canary Flow**: Documented the native `node:test` testing strategy, added focused smoke-test coverage for Storybook story glob selection and missing-story failures, and added a release checklist that validates candidate refs through the external `storybook-vue-demo` Action Canary workflow before tagging.

## [1.9.6] - 2026-09-23

### Fixed

- **Reference/demo workflows now exercise the smoke-test gate**: `pr-preview-build.yml` enables `smoke_test: 'true'` on both the root composite action and the `preview-build` action so every PR to this repository actually runs the opt-in Playwright smoke test end to end, instead of only shipping the feature unused. The bundled `test/fixtures/sample-storybook` fixture now includes a minimal story-sidebar element so the smoke test's manager/sidebar assertion has something to find. Also fixed a bug where the smoke test's Playwright bootstrap loader imported the CJS entry point by file path, bypassing `package.json` `"exports"` conditions and losing the top-level `chromium` export, causing every real (non-mocked) smoke test run to fail with "Cannot read properties of undefined (reading 'launch')".

## [1.9.5] - 2026-09-23

### Added

- **Optional Playwright Smoke-Test Gate (#48)**: Added `smoke_test`, `smoke_test_stories`, and `smoke_test_timeout_ms` inputs. When enabled, built Storybook output is served on loopback and checked with Playwright for manager/sidebar mounting, canvas loading, browser errors, failed requests, and selected story ids before validation or publishing.

## [1.9.4] - 2026-09-22

### Fixed

- **Stale `preview-publisher` Internal Pin Reintroduced the Pre-#124 Recompute Bug (#126)**: `.github/workflows/pr-preview-publish.yml` pinned the `preview-publisher` composite action to a commit predating #124's stats-snapshot-preservation fix. Because GitHub Actions resolves a SHA-pinned sub-action independently of the reusable workflow's own tag, every v1.9.2/v1.9.3 consumer kept running the old recompute logic and continued to see coverage collapse to 100% on PR previews, even though the fix had already shipped. Repinned `preview-publisher` to a commit that contains the #124 fix, and added a content-level regression test (`test/action-pin-integrity.test.js`) that inspects the pinned commit's actual `src/preview-publish.js`/`src/generate-stats.js` source for the fix markers, rather than only checking the pinned commit exists.

## [1.9.3] - 2026-09-22

### Fixed

- **Preview Stats Snapshot Preservation (#124)**: Trusted preview publishing no longer recomputes current-PR component/coverage metrics from the checked-out (source-less) static output directory, which previously undercounted `totalComponents` and reported inflated coverage. It now reuses the untrusted build's own accurate current-PR snapshot from the artifact's `stats/history.json`, merging it with the trusted base Pages history. Stats regeneration is skipped, rather than fabricated, when the artifact has no snapshot.

## [1.9.2] - 2026-09-22

### Fixed

- **Reusable Workflow Resolver Checkout (#122)**: The `PR Preview Publish` reusable workflow's `gate` job now explicitly checks out this repository (pinned to a commit) before importing its pull-request-identity resolver, instead of relying on an ambient `actions/checkout` that resolves to the _caller's_ repository when invoked via `workflow_call`. This fixes a v1.9.1 regression where any consumer repository failed with `Cannot find module '.../src/resolve-run-context.js'`.

## [1.9.1] - 2026-09-22

### Fixed

- **PR Preview Stats History (#120)**: Trusted preview publishing now regenerates growth statistics only after provenance and digest validation, using the Pages history for the pull request's base ref instead of artifact-provided or unrelated root history. Custom `stats_directory` and `generate_stats_graph` settings are forwarded through the reusable workflow.

### Changed

- **Internal Action Pins (#120)**: Refreshed the reusable deployment, preview cleanup, preview janitor, and preview publisher workflows to reviewed implementation commits containing the v1.9.0 release and stats-history fix.

## [1.9.0] - 2026-09-22

### Fixed

- **Explicit Pages Rebuild Verification (#109)**: Explicit rebuilds now wait for GitHub Pages to successfully build the exact commit pushed to the Pages branch, failing with diagnostics when the build is missing, errored, or cannot be queried.
- **PR Preview Identity Provenance (#115)**: Trusted preview publication now derives the pull request number from the run's exact uploaded artifact and cross-checks it against GitHub's associated pull requests, avoiding ambiguous `pull_requests[0]` resolution when multiple pull requests share a head SHA.

### Added

- **Reusable Workflow Build Caching (#43)**: Added opt-out dependency caching for npm, Yarn, pnpm, and Bun plus Storybook compilation caches, with configurable cache key prefixes. Untrusted PR preview builds remain cache-free.
- **Trusted PR Preview Passcode Gate**: Added optional `enable_passcode_gate`, `passcode_session_hours`, and trusted `passcode_hash` inputs to the reusable PR preview publisher and `preview-publisher` action. The hash stays in the trusted publisher context, while the existing gate injector runs only after provenance and content-digest validation and immediately before publication.

### Changed

- **GitHub Actions Dependency Updates**: Updated the Pages artifact upload and deployment actions to v5 and refreshed the Prettier development dependency to 3.9.7. Internal publisher, preview cleanup, and preview janitor pins were advanced to the reviewed release commit.

## [1.8.3] - 2026-09-15

### Fixed

- **Directory Publisher Release Pin**: Updated the reusable directory deployment workflow to pin the `publisher` action to the reviewed release commit containing the shared Pages branch writer, so directory deployments use the same serialized write, retry, and rebuild behavior as other branch mutations.
- **Release Metadata**: Aligned package metadata and all documented action examples with the current stable release.

## [1.6.1] - 2026-09-15

### Fixed

- **Interaction-Test Badge Action Input**: Exposed the documented `test_results_path` input in the `publisher` and `preview-build` composite actions so consumers can generate `tests.svg` and `tests.json` badges.
- **PR Preview Cleanup Permissions (#90)**: Granted `deployments: write` to the reusable cleanup and janitor workflows and documented the permission for direct composite-action consumers, preventing successful preview removals from failing during deployment deactivation.

## [1.6.0] - 2026-09-14

### Added

- **Optional Storybook Passcode Gate**: Added a zero-dependency browser passcode prompt for published `index.html` and `iframe.html` documents, with configurable session duration, `robots.txt`, and `noindex, nofollow, noarchive` metadata. This is a casual privacy measure, not access control; static assets remain publicly fetchable.
- **Interaction-Test Badges and Preview Results**: Added `test_results_path` support for common JSON test-result shapes, generated `tests.svg`/`tests.json` badges and overview metrics, and included test totals in PR preview comments.
- **Base-Ref Metrics Resolution**: PR preview comments now read baseline metrics from the Pages directory associated with the PR base ref, including explicit ref-to-directory mappings and non-root branch-backed deployments.
- **Dynamic SVG Badges & Endpoints (`src/generate-badges.js`) (#53)**: Automatically extracts Storybook metadata (total stories, unique components, and Storybook version from `index.json` or `stories.json`) and renders pixel-perfect flat Shields.io-style SVG badges (`storybook.svg`, `stories.svg`, `components.svg`, `status.svg`) and Shields.io JSON endpoints into the `<badges_directory>/` folder (`badges/`). Configurable via `generate_badges` (default: `true`) and `badges_directory` (default: `badges`).
- **ESLint & Prettier Tooling**: Added ESLint 10 with flat config (`eslint.config.js`) and Prettier 3 (`.prettierrc`, `.prettierignore`) with `npm run lint`, `npm run format`, and `npm run format:fix` scripts, integrated into CI (`ci.yml`).
- **Node.js Engine Specification**: Defined `"engines": { "node": ">=20.0.0" }` in `package.json` for explicit runtime version compatibility.
- **Reusable Untrusted PR Preview Bundle Action (`preview-build/action.yml`)**: Public, supported composite action for the unprivileged `pull_request` build job. Accepts an already-built static Storybook directory and the job's own pull request event context, validates the output with `validate-artifact.js`, and stages/uploads the deterministic `storybook-preview-pr-<PR>-run-<run>` artifact (`storybook/` + `preview-metadata.json` with SHA-256 digest binding) via `preview-metadata.js` - reusing the same internals the trusted publisher independently re-validates, so consumers never need to copy or reimplement metadata-generation logic. The artifact name is **not configurable**: it is always derived from the validated pull request number and run id, so this untrusted action can never emit outside the exact namespace the trusted publisher expects. Requires only the default `contents: read` build-job permission; never references secrets/tokens, never checks out or writes to the Pages branch, and cannot be repurposed as a trusted publisher component. All nested actions (`actions/upload-artifact`) are pinned to full commit SHAs. The repository's own reference `pr-preview-build.yml` workflow now dogfoods this action instead of calling `src/preview-metadata.js` inline.
- **Reusable Trusted PR Preview Publisher Workflow and Action (`.github/workflows/pr-preview-publish.yml` & `preview-publisher/action.yml`)**: Expose reusable workflow (`workflow_call`) and supported composite action (`preview-publisher`) for trusted `workflow_run` preview publishing with complete provenance validation (workflow identity, completed success event, repository, same-repo PR association, base ref, current live head SHA, artifact name/schema, metadata/digest binding, and trusted target resolution) without requiring consumers to check out PR-controlled source or duplicate internal publishing orchestration.
- **Bun Package-Manager Support**: The reusable deployment workflow accepts `package_manager: bun`, defaults to `bun install --frozen-lockfile` and `bun run build-storybook`, and provisions SHA-pinned `oven-sh/setup-bun` only in its read-only build job. The deploy-capable composite action intentionally excludes Bun.
- **Reusable PR Preview Cleanup Workflow and Action (`.github/workflows/pr-preview-cleanup.yml` & `preview-cleanup/action.yml`)**: Expose reusable workflow (`workflow_call`) and supported composite action for trusted closed-PR preview cleanup without requiring consumers to check out platform source or duplicate internal scripts.
- **Reusable Stale-Preview Janitor Workflow and Action (`.github/workflows/pr-preview-janitor.yml` & `preview-janitor/action.yml`)**: Expose reusable workflow (`workflow_call`) and supported composite action for scheduled and manual reconciliation of stale or orphaned PR previews according to retention configuration.
- **Repository-Root Preview Layout Support (`preview_root: ''`)**: Support empty string `preview_root` across configuration resolution, metadata validation, trusted publication, close cleanup, and janitor pruning, safely managing `pr-<number>` directories directly at the Pages branch root while strictly preserving production root assets and named environments.
- **External Consumer Lifecycle Regression Suite (`test/preview-consumer-lifecycle.test.js`)**: End-to-end regression tests verifying untrusted build artifact creation, trusted artifact transfer in non-git environments, provenance validation, idempotent bot comments, stale-run skipping, PR close cleanup, and root layout lifecycle.

### Fixed

- **Redundant Pages Rebuild Requests**: Directory and preview publishing no longer request an explicit Pages rebuild by default after a successful branch push; `trigger_pages_rebuild` remains available for non-standard Pages configurations.
- **Existing Robots Metadata**: The passcode gate replaces pre-existing robots directives so an indexable `robots` meta tag cannot override the documented noindex behavior.
- **Stale `preview-publisher` Internal Release Pin (#35)**: `.github/workflows/pr-preview-publish.yml` invoked `Archetipo95/storybook-github-pages/preview-publisher@6fdc8e3...` (v1.1.0), a commit that predates the `preview-publisher` action's introduction, causing every trusted preview publication to fail at action resolution (`Can't find action.yml`) before any provenance gates or Pages writes ran. Repinned to the current compatible commit (`d46e4b2...`, `v1.3.0`) which contains `preview-publisher/action.yml` and the `src/preview-publish.js` it depends on. Audited all other internal `Archetipo95/storybook-github-pages/<subaction>@<sha>` pins (`publisher`, `preview-cleanup`, `preview-janitor`) and confirmed they already resolve correctly. Added `test/action-pin-integrity.test.js`, which `git show`s every pinned commit locally to assert the referenced action path actually exists there, so an internal stale pin cannot silently pass CI again; `ci.yml` now checks out full history (`fetch-depth: 0`) so this validation has the commit objects it needs.
- **PR Preview Artifact Download Without Git Checkout**: Clarified and documented artifact download requirements for trusted `workflow_run` preview publishers. When downloading untrusted build artifacts without a local Git checkout (to preserve security invariants), `actions/download-artifact@v4` with `run-id` and `github-token` or `gh run download` with `GH_REPO` / `--repo` prevents `fatal: not a git repository` errors.
- **PR Preview Cleanup Missing Branch Graceful Skip**: When a repository has not initialized or configured a Pages branch, PR preview close cleanup (`pr-preview-cleanup.yml`) safely and noiselessly skips without failing the workflow.

### Documentation

- **Directory Rebuild Behavior**: Documented `trigger_pages_rebuild` and clarified that branch-based Pages normally rebuild automatically after a push.
- **Directory Mode Integration via Dedicated Publisher Action**: Investigated generic `startup_failure` runs when external consumers invoke multi-job reusable workflows in directory mode (#24). Documented the GitHub Actions platform limitation where caller permission validation evaluates all jobs in a reusable workflow graph at startup, causing runs to be rejected when callers only grant mode-specific permissions (`contents: write`, `pages: write`). Clarified and documented the supported two-job architecture for directory deployments using `publisher@v1.0.1` directly.

### Changed

- **CI Branch Triggers**: Push validation now runs only on `main`; feature branches continue to receive validation through pull-request workflows without duplicate push checks.

---

## [1.0.0] - 2026-09-12

### Added

- **Reusable Workflow (`.github/workflows/deploy-storybook.yml`)**: Turnkey pipeline for building, validating, and deploying static Storybook builds to GitHub Pages with minimal caller setup.
- **Composite Action (`action.yml`)**: Flexible composite action for existing CI/CD workflows, fully supporting artifact deployment and validation.
- **Trusted Directory Mode (`mode: directory`)**: Atomically updates specific directories on a branch-backed GitHub Pages repository (e.g., `gh-pages`) with locking, retry logic, and preserved sibling directories.
- **PR Preview Lifecycle**:
  - `pr-preview-build.yml`: Unprivileged PR build workflow (`contents: read` only, no secrets) supporting fork PRs safely.
  - `pr-preview-publish.yml`: Privileged `workflow_run` publisher enforcing strict provenance checks, same-repository validation, and stale-run protection before publishing to `<preview_root>/pr-<number>`.
  - `pr-preview-cleanup.yml`: Metadata-only PR closure cleanup workflow (`pull_request_target`) that removes PR preview directories without checking out PR code.
  - `pr-preview-janitor.yml`: Scheduled and manual workflow for pruning abandoned or aged PR previews according to `preview_retention_days`.
  - **Idempotent Bot Comment**: Single, updated-in-place PR preview comment authored by `github-actions[bot]` identified by a stable hidden HTML marker.
- **Artifact Validation Safeguards**: Built-in verification (`src/validate-artifact.js`) ensuring target directories exist, contain non-empty static assets (`index.html` or `.html`/`.js`), contain no nested `.git` repositories, and do not escape workspace boundaries via symlinks or relative path traversal.
- **Bitovi Compatibility**: 100% input parameter parity with `bitovi/github-actions-storybook-to-github-pages` (`path`, `checkout`, `install_command`, `build_command`, `custom_install_command`, `custom_build_command`).
- **Configuration File Support (`.storybook-pages.yml`)**: Centralized YAML configuration for project-wide deployment settings.
- **Security Hardening**:
  - Full 40-character commit SHA pins for all third-party GitHub Actions.
  - Job-scoped minimal permissions (`contents: read`, `pages: write`, `id-token: write`).
  - Strict isolation for fork pull requests and unprivileged builds.
  - Zero runtime npm dependencies and zero external telemetry or tracking.
