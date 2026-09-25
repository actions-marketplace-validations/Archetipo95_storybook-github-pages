import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  removePreviewDirectory,
  requestCleanupCommentUpdate,
  requestCleanupPagesRebuild
} from '../src/preview-cleanup.js';

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    .toString()
    .trim();
}

function initBarePagesRepo({ withPreview } = {}) {
  const bareDir = makeTempDir('storybook-cleanup-bare-');
  git(bareDir, 'init', '--bare', '-q', '.');

  const seedDir = makeTempDir('storybook-cleanup-seed-');
  git(seedDir, 'init', '-q', '.');
  git(seedDir, 'config', 'user.email', 'seed@example.com');
  git(seedDir, 'config', 'user.name', 'seed');
  fs.writeFileSync(path.join(seedDir, 'index.html'), '<html>root</html>');
  if (withPreview) {
    fs.mkdirSync(path.join(seedDir, 'pr-preview', 'pr-5'), { recursive: true });
    fs.writeFileSync(path.join(seedDir, 'pr-preview', 'pr-5', 'index.html'), '<html>preview 5</html>');
    fs.mkdirSync(path.join(seedDir, 'pr-preview', 'pr-9'), { recursive: true });
    fs.writeFileSync(path.join(seedDir, 'pr-preview', 'pr-9', 'index.html'), '<html>preview 9</html>');
  }
  fs.mkdirSync(path.join(seedDir, 'staging'), { recursive: true });
  fs.writeFileSync(path.join(seedDir, 'staging', 'index.html'), '<html>staging</html>');
  git(seedDir, 'add', '-A');
  git(seedDir, 'commit', '-q', '-m', 'seed');
  git(seedDir, 'branch', '-M', 'gh-pages');
  git(seedDir, 'remote', 'add', 'origin', bareDir);
  git(seedDir, 'push', '-q', 'origin', 'gh-pages');

  const cloneDir = makeTempDir('storybook-cleanup-clone-');
  git(cloneDir, 'clone', '-q', bareDir, '.');
  git(cloneDir, 'config', 'user.email', 'clone@example.com');
  git(cloneDir, 'config', 'user.name', 'clone');
  git(cloneDir, 'checkout', '-q', 'gh-pages');
  return { bareDir, cloneDir };
}

test('removePreviewDirectory removes only the targeted PR directory', async () => {
  const { cloneDir } = initBarePagesRepo({ withPreview: true });

  const result = await removePreviewDirectory({
    repo: cloneDir,
    branch: 'gh-pages',
    previewRoot: 'pr-preview',
    prNumber: 5
  });

  assert.equal(result.changed, true);
  assert.equal(result.target, 'pr-preview/pr-5');
  assert.ok(!fs.existsSync(path.join(cloneDir, 'pr-preview', 'pr-5')), 'targeted preview must be removed');
  assert.ok(fs.existsSync(path.join(cloneDir, 'pr-preview', 'pr-9')), 'sibling preview must be preserved');
  assert.ok(
    fs.existsSync(path.join(cloneDir, 'staging', 'index.html')),
    'unrelated environment directory must be untouched'
  );
  assert.ok(fs.existsSync(path.join(cloneDir, 'index.html')), 'production root must be untouched');
});

test('removePreviewDirectory is an idempotent no-op when the directory does not exist', async () => {
  const { cloneDir } = initBarePagesRepo({ withPreview: false });
  const beforeHead = git(cloneDir, 'rev-parse', 'HEAD');

  const result = await removePreviewDirectory({
    repo: cloneDir,
    branch: 'gh-pages',
    previewRoot: 'pr-preview',
    prNumber: 123
  });

  assert.equal(result.changed, false);
  assert.equal(git(cloneDir, 'rev-parse', 'HEAD'), beforeHead, 'a no-op removal must not create a commit');
});

test('removePreviewDirectory rejects unsafe PR numbers before touching the filesystem', async () => {
  const { cloneDir } = initBarePagesRepo({ withPreview: true });
  await assert.rejects(
    removePreviewDirectory({ repo: cloneDir, branch: 'gh-pages', previewRoot: 'pr-preview', prNumber: '5; rm -rf /' }),
    /prNumber/
  );
  assert.ok(
    fs.existsSync(path.join(cloneDir, 'pr-preview', 'pr-5')),
    'nothing should be removed when the PR number is invalid'
  );
});

test('removePreviewDirectory rejects an unsafe configured preview root', async () => {
  const { cloneDir } = initBarePagesRepo({ withPreview: true });
  await assert.rejects(
    removePreviewDirectory({ repo: cloneDir, branch: 'gh-pages', previewRoot: '../escape', prNumber: 5 }),
    /preview_root/
  );
});

test('removePreviewDirectory supports repository-root layout and preserves root/environment content', async () => {
  const bareDir = makeTempDir('storybook-cleanup-root-bare-');
  git(bareDir, 'init', '--bare', '-q', '.');

  const seedDir = makeTempDir('storybook-cleanup-root-seed-');
  git(seedDir, 'init', '-q', '.');
  git(seedDir, 'config', 'user.email', 'seed@example.com');
  git(seedDir, 'config', 'user.name', 'seed');
  fs.writeFileSync(path.join(seedDir, 'index.html'), '<html>root</html>');
  fs.mkdirSync(path.join(seedDir, 'pr-5'), { recursive: true });
  fs.writeFileSync(path.join(seedDir, 'pr-5', 'index.html'), '<html>preview 5 at root</html>');
  fs.mkdirSync(path.join(seedDir, 'pr-9'), { recursive: true });
  fs.writeFileSync(path.join(seedDir, 'pr-9', 'index.html'), '<html>preview 9 at root</html>');
  fs.mkdirSync(path.join(seedDir, 'staging'), { recursive: true });
  fs.writeFileSync(path.join(seedDir, 'staging', 'index.html'), '<html>staging</html>');
  git(seedDir, 'add', '-A');
  git(seedDir, 'commit', '-q', '-m', 'seed root layout');
  git(seedDir, 'branch', '-M', 'gh-pages');
  git(seedDir, 'remote', 'add', 'origin', bareDir);
  git(seedDir, 'push', '-q', 'origin', 'gh-pages');

  const cloneDir = makeTempDir('storybook-cleanup-root-clone-');
  git(cloneDir, 'clone', '-q', bareDir, '.');
  git(cloneDir, 'config', 'user.email', 'clone@example.com');
  git(cloneDir, 'config', 'user.name', 'clone');
  git(cloneDir, 'checkout', '-q', 'gh-pages');

  const result = await removePreviewDirectory({ repo: cloneDir, branch: 'gh-pages', previewRoot: '', prNumber: 5 });

  assert.equal(result.changed, true);
  assert.equal(result.target, 'pr-5');
  assert.ok(!fs.existsSync(path.join(cloneDir, 'pr-5')), 'targeted root preview pr-5 must be removed');
  assert.ok(fs.existsSync(path.join(cloneDir, 'pr-9', 'index.html')), 'sibling preview pr-9 at root must be preserved');
  assert.ok(
    fs.existsSync(path.join(cloneDir, 'staging', 'index.html')),
    'unrelated environment directory must be untouched'
  );
  assert.ok(fs.existsSync(path.join(cloneDir, 'index.html')), 'production root must be untouched');
});

test('removePreviewDirectory safely skips when repo directory does not exist', async () => {
  const nonexistentDir = path.join(os.tmpdir(), `nonexistent-pages-${Date.now()}`);
  const result = await removePreviewDirectory({
    repo: nonexistentDir,
    branch: 'gh-pages',
    previewRoot: 'pr-preview',
    prNumber: 42
  });
  assert.equal(result.changed, false);
  assert.equal(result.skipped, true);
});

test('preview-cleanup CLI removes a preview and writes a step summary without a token', () => {
  const { cloneDir } = initBarePagesRepo({ withPreview: true });
  const summaryPath = path.join(makeTempDir('cleanup-cli-summary-'), 'summary.md');
  fs.writeFileSync(summaryPath, '');

  const run = spawnSync('node', [path.join(process.cwd(), 'src/preview-cleanup.js')], {
    env: {
      ...process.env,
      PAGES_REPO: cloneDir,
      PAGES_BRANCH: 'gh-pages',
      PREVIEW_ROOT: 'pr-preview',
      PR_NUMBER: '5',
      GITHUB_STEP_SUMMARY: summaryPath,
      GITHUB_TOKEN: ''
    },
    encoding: 'utf8'
  });

  assert.equal(run.status, 0, `Process failed:\n${run.stdout}\n${run.stderr}`);
  assert.match(run.stdout, /"changed":true/);
  assert.ok(!fs.existsSync(path.join(cloneDir, 'pr-preview', 'pr-5')));
  assert.match(fs.readFileSync(summaryPath, 'utf8'), /Removed `pr-preview\/pr-5`/);
});

test('requestCleanupPagesRebuild reports Pages rebuild failures without failing cleanup', async () => {
  const result = await requestCleanupPagesRebuild({
    token: 'token',
    repository: 'octo/widgets',
    commitSha: 'a'.repeat(40),
    requestRebuild: async () => {
      throw new Error('Page build failed.');
    }
  });

  assert.equal(result.ok, false);
  assert.match(result.message, /optional Pages rebuild failed: Page build failed/);
});

test('requestCleanupCommentUpdate reports comment update failures without failing cleanup', async () => {
  const result = await requestCleanupCommentUpdate({
    token: 'token',
    repository: 'octo/widgets',
    prNumber: 18,
    updateStatus: async () => {
      throw new Error('Resource not accessible by integration');
    }
  });

  assert.equal(result.ok, false);
  assert.match(result.message, /optional preview comment update failed: Resource not accessible by integration/);
});
