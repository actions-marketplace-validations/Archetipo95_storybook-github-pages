# Bundle size audit

The bundle size audit is opt-in. It runs in the read-only build job after
Storybook is built and before badges, stats, or the passcode gate are added,
so it measures your Storybook output only.

| Input                | Type      | Default | Description                                                                 |
| -------------------- | --------- | ------- | --------------------------------------------------------------------------- |
| `audit_bundle_size`  | `boolean` | `false` | Audit static asset sizes and add a bundle size scorecard to the job summary |
| `bundle_size_max_mb` | `string`  | `''`    | Optional total output budget in MB; the build fails when it is exceeded     |

The inputs are accepted by the reusable workflow, the composite action, the
`preview-build` action, and `.storybook-pages.yml`.

```yaml
jobs:
  storybook:
    uses: Archetipo95/storybook-github-pages/.github/workflows/deploy-storybook.yml@v1
    with:
      audit_bundle_size: true
      bundle_size_max_mb: '25'
```

## What it reports

`src/audit-static.js` walks the static output with no extra dependencies and
appends a scorecard to `$GITHUB_STEP_SUMMARY` with:

- total size and an estimated gzip transfer size (already-compressed images and
  `woff`/`woff2` fonts are counted as-is);
- a breakdown by JavaScript, CSS, fonts, images, HTML, JSON, source maps and
  other files;
- the 10 largest assets.

The report is also saved to `audit/bundle-size.json` in the static output.
Because the production deploy publishes that file, PR preview comments can
compare a pull request against the base branch's last deployed report.

Most of a Storybook build is Storybook itself (manager UI, addons, preview
runtime), so absolute totals stay fairly constant. The per-PR change is the
useful signal.

## PR preview comments

When the untrusted build enables `audit_bundle_size` (through `preview-build`),
the trusted publisher adds a **Bundle Size** table to the preview comment. The
publisher does not trust the sizes in the artifact: the artifact's
`audit/bundle-size.json` only signals that auditing is on, and the publisher
recomputes the sizes from the digest-verified content. It also compares them
with the base branch's `audit/bundle-size.json` on the Pages branch when that
file exists. Asset names are sanitized before they are rendered in the comment.

The publisher leaves the badges and stats folders out of the recomputed size,
because the build audits before writing them. If your build uses a custom
`badges_directory`, set the same value on the `preview-publisher` action so the
PR and base totals stay comparable. If the audit fails, the publisher logs a
warning and posts the comment without the bundle size table; the preview is
still published.
