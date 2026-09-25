import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

test('CLI fixture tests do not write to the real CI step summary', () => {
  const summaryPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ci-summary-leak-')), 'summary.md');
  fs.writeFileSync(summaryPath, '');

  const run = spawnSync('node', ['--test', 'test/preview-build-action.test.js', 'test/preview-publisher.test.js'], {
    env: { ...process.env, GITHUB_STEP_SUMMARY: summaryPath },
    encoding: 'utf8'
  });

  assert.equal(run.status, 0, `Nested tests failed:\n${run.stdout}\n${run.stderr}`);
  assert.equal(fs.readFileSync(summaryPath, 'utf8'), '');
});
