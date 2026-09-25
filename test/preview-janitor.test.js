import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { classifyPreviewEntries, parsePreviewDirName, runJanitor } from '../src/preview-janitor.js';

const DAY_MS = 24 * 60 * 60 * 1000;

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    .toString()
    .trim();
}

test('parsePreviewDirName only matches the strict pr-<number> naming scheme', () => {
  assert.equal(parsePreviewDirName('pr-42'), 42);
  assert.equal(parsePreviewDirName('pr-0'), 0);
  assert.equal(parsePreviewDirName('staging'), null);
  assert.equal(parsePreviewDirName('pr-abc'), null);
  assert.equal(parsePreviewDirName('pr-42-extra'), null);
  assert.equal(parsePreviewDirName('production'), null);
});

test('classifyPreviewEntries removes previews for pull requests that are no longer open', () => {
  const { keep, remove, ignored } = classifyPreviewEntries({
    entries: ['pr-1', 'pr-2'],
    openPrNumbers: new Set([1]),
    retentionMs: 0,
    getLastModifiedMs: () => Date.now()
  });
  assert.deepEqual(keep, ['pr-1']);
  assert.deepEqual(
    remove.map(r => r.entry),
    ['pr-2']
  );
  assert.equal(remove[0].reason, 'pr-not-open');
  assert.deepEqual(ignored, []);
});

test('classifyPreviewEntries removes open-PR previews that exceed the retention window', () => {
  const now = Date.now();
  const { keep, remove } = classifyPreviewEntries({
    entries: ['pr-1', 'pr-2'],
    openPrNumbers: new Set([1, 2]),
    retentionMs: 7 * DAY_MS,
    now,
    getLastModifiedMs: entry => (entry === 'pr-1' ? now - 1 * DAY_MS : now - 30 * DAY_MS)
  });

  assert.deepEqual(keep, ['pr-1']);
  assert.deepEqual(
    remove.map(r => r.entry),
    ['pr-2']
  );
  assert.equal(remove[0].reason, 'stale-retention');
});

test('classifyPreviewEntries identifies open previews approaching cleanup', () => {
  const now = Date.now();
  const { warn, remove } = classifyPreviewEntries({
    entries: ['pr-1', 'pr-2'],
    openPrNumbers: new Set([1, 2]),
    retentionMs: 30 * DAY_MS,
    warningMs: 27 * DAY_MS,
    now,
    getLastModifiedMs: entry => (entry === 'pr-1' ? now - 28 * DAY_MS : now - 31 * DAY_MS)
  });
  assert.deepEqual(
    warn.map(item => item.entry),
    ['pr-1']
  );
  assert.equal(warn[0].remainingDays, 2);
  assert.deepEqual(
    remove.map(item => item.entry),
    ['pr-2']
  );
});

test('classifyPreviewEntries warns from the first day when warning threshold covers retention', () => {
  const now = Date.now();
  const { warn } = classifyPreviewEntries({
    entries: ['pr-1'],
    openPrNumbers: new Set([1]),
    retentionMs: 7 * DAY_MS,
    warningMs: 0,
    now,
    getLastModifiedMs: () => now
  });
  assert.deepEqual(
    warn.map(item => item.entry),
    ['pr-1']
  );
  assert.equal(warn[0].remainingDays, 7);
});

test('classifyPreviewEntries never considers retention when retentionMs is 0 (disabled)', () => {
  const now = Date.now();
  const { keep, remove } = classifyPreviewEntries({
    entries: ['pr-1'],
    openPrNumbers: new Set([1]),
    retentionMs: 0,
    now,
    getLastModifiedMs: () => now - 365 * DAY_MS
  });
  assert.deepEqual(keep, ['pr-1']);
  assert.deepEqual(remove, []);
});

test('classifyPreviewEntries ignores entries outside the pr-<number> naming scheme, including production/environment directories', () => {
  const { keep, remove, ignored } = classifyPreviewEntries({
    entries: ['staging', 'production', 'assets', 'pr-3'],
    openPrNumbers: new Set(),
    retentionMs: 0,
    getLastModifiedMs: () => Date.now()
  });
  assert.deepEqual(ignored, ['staging', 'production', 'assets']);
  assert.deepEqual(
    remove.map(r => r.entry),
    ['pr-3']
  );
  assert.deepEqual(keep, []);
});

function initBarePagesRepo() {
  const bareDir = makeTempDir('storybook-janitor-bare-');
  git(bareDir, 'init', '--bare', '-q', '.');

  const seedDir = makeTempDir('storybook-janitor-seed-');
  git(seedDir, 'init', '-q', '.');
  git(seedDir, 'config', 'user.email', 'seed@example.com');
  git(seedDir, 'config', 'user.name', 'seed');
  fs.writeFileSync(path.join(seedDir, 'index.html'), '<html>root</html>');
  fs.mkdirSync(path.join(seedDir, 'pr-preview', 'pr-1'), { recursive: true });
  fs.writeFileSync(path.join(seedDir, 'pr-preview', 'pr-1', 'index.html'), 'open pr, keep');
  fs.mkdirSync(path.join(seedDir, 'pr-preview', 'pr-2'), { recursive: true });
  fs.writeFileSync(path.join(seedDir, 'pr-preview', 'pr-2', 'index.html'), 'closed pr, remove');
  fs.mkdirSync(path.join(seedDir, 'staging'), { recursive: true });
  fs.writeFileSync(path.join(seedDir, 'staging', 'index.html'), 'named environment, never touched');
  git(seedDir, 'add', '-A');
  git(seedDir, 'commit', '-q', '-m', 'seed');
  git(seedDir, 'branch', '-M', 'gh-pages');
  git(seedDir, 'remote', 'add', 'origin', bareDir);
  git(seedDir, 'push', '-q', 'origin', 'gh-pages');

  const cloneDir = makeTempDir('storybook-janitor-clone-');
  git(cloneDir, 'clone', '-q', bareDir, '.');
  git(cloneDir, 'config', 'user.email', 'clone@example.com');
  git(cloneDir, 'config', 'user.name', 'clone');
  git(cloneDir, 'checkout', '-q', 'gh-pages');
  return cloneDir;
}

test('runJanitor removes closed-PR previews and preserves production/environment directories', async () => {
  const cloneDir = initBarePagesRepo();
  const originalFetch = global.fetch;
  global.fetch = async url => {
    assert.match(url, /\/pulls\?state=open/);
    return { ok: true, status: 200, json: async () => [{ number: 1 }] };
  };

  try {
    const result = await runJanitor({
      repo: cloneDir,
      branch: 'gh-pages',
      previewRoot: 'pr-preview',
      retentionDays: 0,
      token: 't',
      repository: 'octo/widgets'
    });
    assert.equal(result.changed, true);
    assert.deepEqual(
      result.removed.map(r => r.entry),
      ['pr-2']
    );
    assert.ok(!fs.existsSync(path.join(cloneDir, 'pr-preview', 'pr-2')));
    assert.ok(fs.existsSync(path.join(cloneDir, 'pr-preview', 'pr-1')));
    assert.ok(
      fs.existsSync(path.join(cloneDir, 'staging', 'index.html')),
      'named environment directory must never be touched'
    );
    assert.ok(fs.existsSync(path.join(cloneDir, 'index.html')), 'production root must never be touched');
  } finally {
    global.fetch = originalFetch;
  }
});

test('runJanitor is a no-op (and requests no rebuild) when nothing qualifies for removal', async () => {
  const cloneDir = initBarePagesRepo();
  const beforeHead = git(cloneDir, 'rev-parse', 'HEAD');
  const originalFetch = global.fetch;
  global.fetch = async url => {
    if (url.includes('/pulls')) return { ok: true, status: 200, json: async () => [{ number: 1 }, { number: 2 }] };
    throw new Error(`Unexpected fetch: ${url}`);
  };

  try {
    const result = await runJanitor({
      repo: cloneDir,
      branch: 'gh-pages',
      previewRoot: 'pr-preview',
      retentionDays: 0,
      token: 't',
      repository: 'octo/widgets'
    });
    assert.equal(result.changed, false);
    assert.deepEqual(result.removed, []);
    assert.equal(git(cloneDir, 'rev-parse', 'HEAD'), beforeHead);
  } finally {
    global.fetch = originalFetch;
  }
});

test('runJanitor supports repository-root layout: removes only closed-PR pr-<number> directories and preserves root content', async () => {
  const bareDir = makeTempDir('storybook-janitor-root-bare-');
  git(bareDir, 'init', '--bare', '-q', '.');

  const seedDir = makeTempDir('storybook-janitor-root-seed-');
  git(seedDir, 'init', '-q', '.');
  git(seedDir, 'config', 'user.email', 'seed@example.com');
  git(seedDir, 'config', 'user.name', 'seed');
  fs.writeFileSync(path.join(seedDir, 'index.html'), '<html>root</html>');
  fs.mkdirSync(path.join(seedDir, 'pr-1'), { recursive: true });
  fs.writeFileSync(path.join(seedDir, 'pr-1', 'index.html'), 'open pr, keep');
  fs.mkdirSync(path.join(seedDir, 'pr-2'), { recursive: true });
  fs.writeFileSync(path.join(seedDir, 'pr-2', 'index.html'), 'closed pr, remove');
  fs.mkdirSync(path.join(seedDir, 'staging'), { recursive: true });
  fs.writeFileSync(path.join(seedDir, 'staging', 'index.html'), 'named environment, never touched');
  fs.mkdirSync(path.join(seedDir, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(seedDir, 'assets', 'style.css'), 'css');
  git(seedDir, 'add', '-A');
  git(seedDir, 'commit', '-q', '-m', 'seed root layout');
  git(seedDir, 'branch', '-M', 'gh-pages');
  git(seedDir, 'remote', 'add', 'origin', bareDir);
  git(seedDir, 'push', '-q', 'origin', 'gh-pages');

  const cloneDir = makeTempDir('storybook-janitor-root-clone-');
  git(cloneDir, 'clone', '-q', bareDir, '.');
  git(cloneDir, 'config', 'user.email', 'clone@example.com');
  git(cloneDir, 'config', 'user.name', 'clone');
  git(cloneDir, 'checkout', '-q', 'gh-pages');

  const originalFetch = global.fetch;
  global.fetch = async url => {
    assert.match(url, /\/pulls\?state=open/);
    return { ok: true, status: 200, json: async () => [{ number: 1 }] };
  };

  try {
    const result = await runJanitor({
      repo: cloneDir,
      branch: 'gh-pages',
      previewRoot: '',
      retentionDays: 0,
      token: 't',
      repository: 'octo/widgets'
    });
    assert.equal(result.changed, true);
    assert.deepEqual(
      result.removed.map(r => r.entry),
      ['pr-2']
    );
    assert.deepEqual(result.keep, ['pr-1']);
    assert.ok(result.ignored.includes('staging'));
    assert.ok(result.ignored.includes('assets'));
    assert.ok(!fs.existsSync(path.join(cloneDir, 'pr-2')), 'closed PR preview pr-2 must be removed');
    assert.ok(fs.existsSync(path.join(cloneDir, 'pr-1', 'index.html')), 'open PR preview pr-1 must be kept');
    assert.ok(
      fs.existsSync(path.join(cloneDir, 'staging', 'index.html')),
      'named environment staging must be preserved'
    );
    assert.ok(fs.existsSync(path.join(cloneDir, 'assets', 'style.css')), 'assets directory must be preserved');
    assert.ok(fs.existsSync(path.join(cloneDir, 'index.html')), 'production root index.html must be preserved');
  } finally {
    global.fetch = originalFetch;
  }
});
