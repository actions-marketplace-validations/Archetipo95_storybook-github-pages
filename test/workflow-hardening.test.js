import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

const ACTION_FILES = [
  'action.yml',
  'publisher/action.yml',
  'preview-build/action.yml',
  'preview-publisher/action.yml',
  'preview-cleanup/action.yml',
  'preview-janitor/action.yml'
];

function workflowFiles() {
  return fs
    .readdirSync(path.join(root, '.github/workflows'))
    .filter(file => /\.ya?ml$/.test(file))
    .map(file => `.github/workflows/${file}`);
}

// Runner-controlled values that cannot carry caller- or PR-controlled text.
const SAFE_RUN_EXPRESSIONS = new Set(['github.workspace']);

/**
 * Returns every `${{ ... }}` expression interpolated directly into a `run:`
 * script. Anything interpolated there is pasted into the shell source before
 * bash parses it, so untrusted values must flow through `env:` instead.
 */
function runScriptExpressions(content) {
  const found = [];
  const lines = content.split('\n');
  let runIndent = -1;
  lines.forEach((line, index) => {
    const runMatch = line.match(/^(\s*)(- )?run:\s*(.*)$/);
    if (runMatch) {
      const inline = runMatch[3];
      runIndent = runMatch[1].length + (runMatch[2] ? 2 : 0);
      if (inline && !/^[|>][-+]?$/.test(inline)) {
        for (const expr of inline.matchAll(/\$\{\{\s*([^}]*?)\s*\}\}/g)) found.push({ line: index + 1, expr: expr[1] });
        runIndent = -1;
      }
      return;
    }
    if (runIndent < 0) return;
    if (line.trim() !== '' && line.match(/^\s*/)[0].length <= runIndent) {
      runIndent = -1;
      return;
    }
    for (const expr of line.matchAll(/\$\{\{\s*([^}]*?)\s*\}\}/g)) found.push({ line: index + 1, expr: expr[1] });
  });
  return found;
}

test('run scripts never interpolate caller, event, step, or env values directly into shell source', () => {
  const offenders = [];
  for (const file of [...ACTION_FILES, ...workflowFiles()]) {
    for (const { line, expr } of runScriptExpressions(read(file))) {
      if (!SAFE_RUN_EXPRESSIONS.has(expr)) offenders.push(`${file}:${line} \${{ ${expr} }}`);
    }
  }
  assert.deepEqual(offenders, [], 'pass these values through `env:` and reference them as shell variables');
});

test('run-script scanner detects block and inline interpolation (guards the guard)', () => {
  const sample = [
    'steps:',
    '  - run: echo "${{ github.event.pull_request.title }}"',
    '  - name: block',
    '    run: |',
    '      CMD="${{ inputs.build_command }}"',
    '      eval "$CMD"',
    '    env:',
    '      SAFE: ${{ inputs.build_command }}',
    '  - run: node "${{ github.action_path }}/x.js"'
  ].join('\n');
  assert.deepEqual(
    runScriptExpressions(sample).map(item => item.expr),
    ['github.event.pull_request.title', 'inputs.build_command', 'github.action_path']
  );
});
