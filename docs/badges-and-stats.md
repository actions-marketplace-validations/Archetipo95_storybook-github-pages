# Dynamic SVG Badges & Endpoints

When `generate_badges` is enabled (default), `storybook-github-pages` analyzes your Storybook output (`index.json` / `stories.json`) and source tree to generate static SVG badges and Shields.io JSON endpoints into the `<badges_directory>/` subfolder on GitHub Pages:

- `badges/coverage.svg` / `badges/coverage.json` — Component coverage percentage and ratio (e.g. `coverage | 86% (6/7)` with dynamic green/yellow/red thresholds).
- `badges/stories.svg` / `badges/stories.json` — Story count badge (e.g. `stories | 26`).
- `badges/components.svg` / `badges/components.json` — Documented component count badge (e.g. `components | 6`).
- `badges/storybook.svg` / `badges/storybook.json` — Storybook version badge (e.g. `storybook | v8.6.0` or `v10.0.0`).
- `badges/status.svg` / `badges/status.json` — State-aware deployment status badge with commit SHA (e.g. `storybook | published • 8ba5315`, `storybook | building • 8ba5315` in yellow, or `storybook | failed • 8ba5315` in red).
- `badges/build.svg` / `badges/build.json` — Build status badge (`build | passed • 8ba5315`, `build | building`, `build | failed`).
- `badges/tests.svg` / `badges/tests.json` — Optional interaction test badge (`tests | 546/546 passed`, or `tests | 3/546 failed`) when `test_results_path` points at a valid JSON results file.
- `badges/overview.json` — Comprehensive metadata endpoint aggregating story count, component count, total components, coverage percentage, build status, commit details, and optional test totals.

You can embed these badges directly into your `README.md`:

```markdown
[![Storybook](https://<owner>.github.io/<repo>/badges/storybook.svg)](https://<owner>.github.io/<repo>)
[![Coverage](https://<owner>.github.io/<repo>/badges/coverage.svg)](https://<owner>.github.io/<repo>)
[![Stories](https://<owner>.github.io/<repo>/badges/stories.svg)](https://<owner>.github.io/<repo>)
[![Components](https://<owner>.github.io/<repo>/badges/components.svg)](https://<owner>.github.io/<repo>)
[![Tests](https://<owner>.github.io/<repo>/badges/tests.svg)](https://<owner>.github.io/<repo>)
[![Status](https://<owner>.github.io/<repo>/badges/status.svg)](https://<owner>.github.io/<repo>)
```

---

# Coverage Discovery & Path Filtering

The component coverage calculation uses the checked-out repository as the default discovery root. In the current release, the action walks the workspace and counts likely framework component files such as `.vue`, `.jsx`, `.tsx`, and `.svelte` while excluding common non-component and generated paths (`node_modules`, `.git`, `storybook-static`, `dist`, `build`, `coverage`, and files ending with `.stories.*`, `.story.*`, `.test.*`, `.spec.*`). This default behavior is intentionally repository-wide and is what drives the coverage badge, `badges/overview.json`, PR preview coverage deltas, and the growth-chart ledger.

### Supported configuration

These inputs are supported and are evaluated against the repository root before the coverage badge or metrics are generated:

```yaml
with:
  coverage_include_paths: |
    src/components/**
    packages/*/src/components/**
  coverage_ignore_paths: |
    **/generated/**
    **/vendor/**
    **/*.stories.*
    **/*.spec.*
```

The patterns are intentionally repository-root-relative. In other words, they are evaluated against the checkout root rather than the Storybook source directory, and the effective coverage set is computed before badge generation and stats ledger updates.

### Matching rules and precedence

- `coverage_include_paths` narrows the candidate component set to matching files; when it is empty, the default repository-wide scan is used.
- `coverage_ignore_paths` removes matching files from the final set even if they also match an include rule.
- Ignore rules win when the same file matches both include and ignore patterns.
- Supported globs follow standard `*`, `**`, and `?` matching semantics for files and directories under the repository root.
- Glob examples for monorepos are usually written as `packages/*/src/components/**` or `apps/web/src/**`, while generated and vendor content is typically excluded with patterns like `**/generated/**`, `**/vendor/**`, and `**/dist/**`.

### Example scenarios

- Monorepo: `coverage_include_paths` can target only the actual app packages that should contribute to the published Storybook coverage score.
- Generated code: `coverage_ignore_paths` can ignore files under `**/generated/**` or `**/vendor/**` so metrics reflect the shipped, hand-maintained components instead of build artifacts.
- Storybook-only files: `**/*.stories.*` and `**/*.story.*` remain excluded from component totals by design, preventing documentation-only files from inflating or skewing the ratio.

### Impact on published metrics

The selected coverage set is the single source of truth for:

- the coverage badge (`badges/coverage.svg` / `badges/coverage.json`);
- `badges/overview.json`;
- PR preview coverage comparisons and deltas;
- the historical growth-chart ledger (`stats/history.json` and `stats/history.svg`).

---

# 📈 Hand-Drawn Growth Chart & Metrics Ledger

When `generate_stats_graph` is enabled (default), `storybook-github-pages` generates a star-history styled hand-drawn SVG chart and keeps an incremental metrics ledger across deployments:

- `stats/history.svg` — Hand-drawn SVG growth chart showing total components in red and covered components in green. Story count stays available as a badge/JSON metric, but is not plotted because it can change much more frequently than component coverage. Supports dark-mode viewing with vintage hand-drawn styling and responsive layout.
- `stats/history.json` — Historical commit ledger appending metrics (`timestamp`, `commitSha`, `stories`, `components`, `totalComponents`, `coveragePercent`) on every deployment.

The ledger keeps every deployment snapshot for auditability. The SVG chart renders only metric-changing snapshots plus the latest snapshot, so repeated no-op deploys do not add visual noise.

Embed the growth chart in your `README.md`:

```markdown
[![Storybook Growth History](https://<owner>.github.io/<repo>/stats/history.svg)](https://<owner>.github.io/<repo>)
```

---
