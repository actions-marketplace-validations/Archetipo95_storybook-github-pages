import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

// Regression test for #35: `.github/workflows/pr-preview-publish.yml` pinned
// `preview-publisher` to a commit SHA that predates the `preview-publisher`
// action's existence in this repository, so GitHub Actions failed to
// resolve it ("Can't find action.yml") before any provenance gates ran.
//
// This test statically resolves every internal self-reference of the form
// `Archetipo95/storybook-github-pages/<subaction>@<full-sha>` found in the
// workflows/docs of this repository and inspects the *actual git object* at
// that pinned commit (via `git show <sha>:<path>`) to make sure the
// referenced action definition really exists there. This catches a stale or
// otherwise invalid internal pin without needing network access or GitHub's
// action resolution step.

const repoRoot = process.cwd();

// Historical SHAs can only be inspected if the local clone has that commit
// object (a shallow clone, e.g. `actions/checkout` without `fetch-depth: 0`,
// would not). Best-effort deepen the clone so the checks below are
// meaningful instead of silently no-op-ing; ignore failures (e.g. no
// network, already complete) since gitCommitExists() still guards each ref.
try {
  const isShallow = execFileSync('git', ['rev-parse', '--is-shallow-repository'], {
    cwd: repoRoot,
    stdio: ['ignore', 'pipe', 'ignore']
  })
    .toString()
    .trim();
  if (isShallow === 'true') {
    execFileSync('git', ['fetch', '--unshallow'], { cwd: repoRoot, stdio: 'ignore' });
  }
} catch {
  // Not a git repo, offline, or already unshallowed — proceed with what we have.
}

function gitShowExists(sha, relPath) {
  try {
    execFileSync('git', ['cat-file', '-e', `${sha}:${relPath}`], {
      cwd: repoRoot,
      stdio: ['ignore', 'ignore', 'ignore']
    });
    return true;
  } catch {
    return false;
  }
}

function gitCommitExists(sha) {
  try {
    execFileSync('git', ['cat-file', '-e', sha], {
      cwd: repoRoot,
      stdio: ['ignore', 'ignore', 'ignore']
    });
    return true;
  } catch {
    return false;
  }
}

function findInternalActionRefs(content) {
  // Matches `Archetipo95/storybook-github-pages[/<subaction>]@<40-hex-sha>`
  // e.g. `Archetipo95/storybook-github-pages/preview-publisher@6fdc8e3...`
  const regex = /Archetipo95\/storybook-github-pages(\/[a-zA-Z0-9_-]+)?@([a-f0-9]{40})/g;
  const refs = [];
  for (const match of content.matchAll(regex)) {
    refs.push({ subaction: match[1] ? match[1].slice(1) : null, sha: match[2] });
  }
  return refs;
}

function filesToScan() {
  const candidates = [
    '.github/workflows/deploy-storybook.yml',
    '.github/workflows/ci.yml',
    '.github/workflows/pr-preview-build.yml',
    '.github/workflows/pr-preview-publish.yml',
    '.github/workflows/pr-preview-cleanup.yml',
    '.github/workflows/pr-preview-janitor.yml'
  ];
  return candidates.map(file => path.join(repoRoot, file)).filter(file => fs.existsSync(file));
}

test('internal action pins reference a commit that actually contains that action', () => {
  const files = filesToScan();
  assert.ok(files.length > 0, 'expected at least one workflow file to scan');

  let checked = 0;

  for (const file of files) {
    const relFile = path.relative(repoRoot, file);
    const content = fs.readFileSync(file, 'utf8');
    const refs = findInternalActionRefs(content);

    for (const { subaction, sha } of refs) {
      checked += 1;

      assert.ok(
        gitCommitExists(sha),
        `${relFile}: pinned commit ${sha} for ${subaction ?? '(root action)'} does not exist in this repository's history`
      );

      const actionYmlPath = subaction ? `${subaction}/action.yml` : 'action.yml';
      assert.ok(
        gitShowExists(sha, actionYmlPath),
        `${relFile}: pinned commit ${sha} for "${subaction ?? '(root)'}" does not contain ${actionYmlPath} — ` +
          'this is a stale/invalid release pin (action resolution would fail with "Can\'t find action.yml")'
      );
    }
  }

  assert.ok(checked > 0, 'expected to find at least one internal SHA-pinned action reference to validate');
});

test('preview-publisher pin resolves alongside the src it depends on', () => {
  const workflow = fs.readFileSync(path.join(repoRoot, '.github/workflows/pr-preview-publish.yml'), 'utf8');
  const match = workflow.match(/Archetipo95\/storybook-github-pages\/preview-publisher@([a-f0-9]{40})/);
  assert.ok(match, 'expected a SHA-pinned preview-publisher reference in pr-preview-publish.yml');

  const sha = match[1];
  assert.ok(gitCommitExists(sha), `pinned commit ${sha} does not exist in this repository's history`);
  assert.ok(
    gitShowExists(sha, 'preview-publisher/action.yml'),
    `pinned commit ${sha} is missing preview-publisher/action.yml`
  );
  // preview-publisher/action.yml invokes `${{ github.action_path }}/../src/preview-publish.js`,
  // so the pinned commit must also contain the script it depends on.
  assert.ok(
    gitShowExists(sha, 'src/preview-publish.js'),
    `pinned commit ${sha} is missing src/preview-publish.js required by preview-publisher/action.yml`
  );

  // Guard against ever regressing to the known-bad pre-preview-publisher pin from #35.
  assert.notEqual(sha, '6fdc8e329e5109026e6f0312f3886c1e64328719');
});

// Regression test for the live v1.9.3 bug: the `preview-publisher` pin above
// resolves the *entire* composite action, including the version of
// `src/preview-publish.js` and `src/generate-stats.js` it runs, at the
// pinned commit - independent of which reusable-workflow tag (e.g. `@v1.9.3`)
// a consumer invoked. #124 fixed `publishPreview` to reuse the untrusted
// build's own current-PR stats snapshot instead of recomputing metrics
// against the source-less checked-out static output, but the pin above was
// never bumped past its pre-#124 value, so every consumer kept running the
// old recompute logic (reproducing the exact "coverage always 100%" bug)
// even after upgrading to v1.9.2/v1.9.3. This proves the pinned commit's
// *content* - not just its existence - includes the #124 fix.
test('preview-publisher pin content includes the current-PR snapshot preservation fix (#124)', () => {
  const workflow = fs.readFileSync(path.join(repoRoot, '.github/workflows/pr-preview-publish.yml'), 'utf8');
  const match = workflow.match(/Archetipo95\/storybook-github-pages\/preview-publisher@([a-f0-9]{40})/);
  assert.ok(match, 'expected a SHA-pinned preview-publisher reference in pr-preview-publish.yml');
  const sha = match[1];

  const previewPublishSrc = execFileSync('git', ['show', `${sha}:src/preview-publish.js`], {
    cwd: repoRoot
  }).toString();
  assert.match(
    previewPublishSrc,
    /readArtifactCurrentSnapshot/,
    `pinned commit ${sha} predates #124: it recomputes stats from the checked-out static output instead of reusing ` +
      "the untrusted build's own current-PR snapshot, undercounting totalComponents/coveragePercent"
  );

  const generateStatsSrc = execFileSync('git', ['show', `${sha}:src/generate-stats.js`], {
    cwd: repoRoot
  }).toString();
  assert.match(
    generateStatsSrc,
    /currentSnapshot/,
    `pinned commit ${sha} predates #124: generateStatsGraph has no currentSnapshot bypass for the trusted publisher`
  );
});

test('preview-publisher pin content includes compact stats graph rendering', () => {
  const workflow = fs.readFileSync(path.join(repoRoot, '.github/workflows/pr-preview-publish.yml'), 'utf8');
  const match = workflow.match(/Archetipo95\/storybook-github-pages\/preview-publisher@([a-f0-9]{40})/);
  assert.ok(match, 'expected a SHA-pinned preview-publisher reference in pr-preview-publish.yml');
  const sha = match[1];

  const generateStatsSrc = execFileSync('git', ['show', `${sha}:src/generate-stats.js`], {
    cwd: repoRoot
  }).toString();
  assert.match(
    generateStatsSrc,
    /compactHistoryForChart/,
    `pinned commit ${sha} predates compact stats graph rendering and will render every no-op deploy point`
  );
  assert.doesNotMatch(
    generateStatsSrc,
    /Stories \(\$\{latestEntry\.stories\}\)|stories-line|storiesPoints/,
    `pinned commit ${sha} still renders the stories series in PR preview graphs`
  );
  assert.match(
    generateStatsSrc,
    /--total-color: #dc2626/,
    `pinned commit ${sha} does not render total components as the red series`
  );
  assert.match(
    generateStatsSrc,
    /--components-color: #16a34a/,
    `pinned commit ${sha} does not render covered components as the green series`
  );
});

test('preview-cleanup pin content includes best-effort optional post-cleanup updates', () => {
  const workflow = fs.readFileSync(path.join(repoRoot, '.github/workflows/pr-preview-cleanup.yml'), 'utf8');
  const match = workflow.match(/Archetipo95\/storybook-github-pages\/preview-cleanup@([a-f0-9]{40})/);
  assert.ok(match, 'expected a SHA-pinned preview-cleanup reference in pr-preview-cleanup.yml');
  const sha = match[1];

  const previewCleanupSrc = execFileSync('git', ['show', `${sha}:src/preview-cleanup.js`], {
    cwd: repoRoot
  }).toString();
  assert.match(
    previewCleanupSrc,
    /requestCleanupPagesRebuild/,
    `pinned commit ${sha} predates the best-effort Pages rebuild handling`
  );
  assert.match(
    previewCleanupSrc,
    /requestCleanupCommentUpdate/,
    `pinned commit ${sha} predates the best-effort preview comment update handling`
  );
});
