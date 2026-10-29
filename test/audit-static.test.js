import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  auditBundleSize,
  categorize,
  formatBundleReport,
  formatBytes,
  parseBudgetMb,
  readBundleReport,
  runBundleAudit,
  safeAssetName
} from '../src/audit-static.js';

function makeStaticDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-static-'));
  fs.writeFileSync(path.join(dir, 'index.html'), '<!DOCTYPE html><html><body>Storybook</body></html>');
  fs.mkdirSync(path.join(dir, 'assets'));
  fs.writeFileSync(path.join(dir, 'assets', 'main.js'), 'console.log("x");\n'.repeat(2000));
  fs.writeFileSync(path.join(dir, 'assets', 'main.css'), 'body{color:red}\n'.repeat(100));
  fs.writeFileSync(path.join(dir, 'assets', 'font.woff2'), Buffer.alloc(512, 7));
  return dir;
}

test('categorize maps extensions to payload categories', () => {
  assert.equal(categorize('a/b.mjs'), 'js');
  assert.equal(categorize('x.CSS'), 'css');
  assert.equal(categorize('f.woff2'), 'font');
  assert.equal(categorize('main.js.map'), 'sourcemap');
  assert.equal(categorize('README'), 'other');
});

test('formatBytes renders human readable sizes', () => {
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(2048), '2.0 KB');
  assert.equal(formatBytes(3 * 1024 * 1024), '3.00 MB');
  assert.equal(formatBytes(-2048), '-2.0 KB');
});

test('parseBudgetMb accepts positive numbers and rejects invalid budgets', () => {
  assert.equal(parseBudgetMb(''), null);
  assert.equal(parseBudgetMb('2.5'), 2.5);
  assert.throws(() => parseBudgetMb('0'), /positive number/);
  assert.throws(() => parseBudgetMb('abc'), /positive number/);
});

test('auditBundleSize totals categories, ranks largest assets and estimates gzip', () => {
  const dir = makeStaticDir();
  const report = auditBundleSize({ staticDir: dir });
  assert.equal(report.totalFiles, 4);
  assert.equal(report.categories.js.files, 1);
  assert.equal(report.categories.css.files, 1);
  assert.equal(report.categories.font.files, 1);
  assert.equal(report.largest[0].path, 'assets/main.js');
  assert.ok(report.categories.js.gzipBytes < report.categories.js.bytes, 'text assets compress');
  assert.equal(report.categories.font.gzipBytes, 512, 'woff2 is counted as already compressed');
  assert.equal(report.budget, null);
});

test('auditBundleSize flags an exceeded budget and ignores its own audit output', () => {
  const dir = makeStaticDir();
  fs.mkdirSync(path.join(dir, 'audit'));
  fs.writeFileSync(path.join(dir, 'audit', 'bundle-size.json'), 'x'.repeat(10_000));
  const report = auditBundleSize({ staticDir: dir, maxMb: 0.001 });
  assert.equal(report.totalFiles, 4);
  assert.equal(report.budget.exceeded, true);
  assert.equal(auditBundleSize({ staticDir: dir, maxMb: 10 }).budget.exceeded, false);
});

test('auditBundleSize can exclude generated directories', () => {
  const dir = makeStaticDir();
  fs.mkdirSync(path.join(dir, 'badges'));
  fs.writeFileSync(path.join(dir, 'badges', 'stories.svg'), '<svg/>');
  assert.equal(auditBundleSize({ staticDir: dir }).totalFiles, 5);
  assert.equal(auditBundleSize({ staticDir: dir, excludeDirectories: ['badges'] }).totalFiles, 4);
});

test('auditBundleSize fails on a missing directory', () => {
  assert.throws(() => auditBundleSize({ staticDir: '/does/not/exist' }), /does not exist/);
});

test('formatBundleReport renders a scorecard, budget status and largest assets', () => {
  const dir = makeStaticDir();
  const markdown = formatBundleReport(auditBundleSize({ staticDir: dir, maxMb: 5 }));
  assert.match(markdown, /### 📦 Bundle Size/);
  assert.match(markdown, /\| JavaScript \| 1 \|/);
  assert.match(markdown, /Within the 5 MB budget/);
  assert.match(markdown, /`assets\/main\.js`/);
});

test('formatBundleReport compares against a base report', () => {
  const dir = makeStaticDir();
  const report = auditBundleSize({ staticDir: dir });
  const base = { ...report, totalBytes: report.totalBytes - 1000, totalGzipBytes: report.totalGzipBytes };
  const markdown = formatBundleReport(report, { baseReport: base });
  assert.match(markdown, /\| Payload \| Base \| Current \| Change \|/);
  assert.match(markdown, /\+1000 B .*📈/);
});

test('formatBundleReport ignores malformed base reports', () => {
  const dir = makeStaticDir();
  const markdown = formatBundleReport(auditBundleSize({ staticDir: dir }), { baseReport: { totalBytes: 'big' } });
  assert.doesNotMatch(markdown, /\| Base \|/);
});

test('safeAssetName neutralizes markdown and HTML control characters', () => {
  assert.equal(safeAssetName('a|b`c<img>.js'), 'a_b_c_img_.js');
  assert.equal(safeAssetName('x'.repeat(100)).length, 80);
});

test('runBundleAudit writes audit/bundle-size.json and appends to the step summary', () => {
  const dir = makeStaticDir();
  const summaryPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'audit-summary-')), 'summary.md');
  const { report } = runBundleAudit({
    staticPath: path.basename(dir),
    workspaceRoot: path.dirname(dir),
    summaryPath
  });
  assert.deepEqual(readBundleReport(dir), JSON.parse(JSON.stringify(report)));
  assert.match(fs.readFileSync(summaryPath, 'utf8'), /Bundle Size/);
});

test('runBundleAudit rejects paths outside the workspace', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-root-'));
  assert.throws(() => runBundleAudit({ staticPath: '../x', workspaceRoot: root, summaryPath: '' }), /escapes/);
});
