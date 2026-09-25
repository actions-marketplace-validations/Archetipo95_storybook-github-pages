import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { execFileSync } from 'node:child_process';

// Regression test for the v1.9.1 bug: `pr-preview-publish.yml`'s `gate` job
// checked out the default branch with a plain `actions/checkout` (no
// `repository:` override) before importing `./src/resolve-run-context.js`.
// Inside a reusable workflow invoked via `workflow_call`, that checkout
// resolves to the *caller's* repository, not this one - so any consumer
// (e.g. Archetipo95/storybook-vue-demo) hit
// "Cannot find module '.../src/resolve-run-context.js'" because their own
// repository has no such file.
//
// This test proves the fix two ways: (1) statically, that the checkout step
// pins an explicit `repository:`/`ref:` to this action repo instead of
// relying on the ambient checkout, and that the pinned ref actually contains
// `src/resolve-run-context.js`; (2) functionally, by extracting the real
// "Extract trusted pull request context" step script from the workflow file
// and executing it from a directory that - like a consumer's checkout -
// has no top-level `src/`, only the pinned resolver checked out at its own
// path, and confirming it still resolves the trusted PR context.

const repoRoot = process.cwd();
const workflowPath = path.join(repoRoot, '.github/workflows/pr-preview-publish.yml');

function gitCommitExists(sha) {
  try {
    execFileSync('git', ['cat-file', '-e', sha], { cwd: repoRoot, stdio: ['ignore', 'ignore', 'ignore'] });
    return true;
  } catch {
    return false;
  }
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

function extractGateResolverStep() {
  const content = fs.readFileSync(workflowPath, 'utf8');
  const stepMatch = content.match(
    /- name: Extract trusted pull request context[\s\S]*?run: \|\n([\s\S]*?)\n\n      - name: Fetch current pull request head SHA/
  );
  assert.ok(
    stepMatch,
    'could not locate the "Extract trusted pull request context" step script in pr-preview-publish.yml'
  );
  return stepMatch[1];
}

function extractCheckoutStep() {
  const content = fs.readFileSync(workflowPath, 'utf8');
  const stepMatch = content.match(
    /- name: Checkout resolver source \(storybook-github-pages, pinned\)[\s\S]*?\n\n      - name: Extract trusted pull request context/
  );
  assert.ok(stepMatch, 'could not locate the resolver checkout step in pr-preview-publish.yml');
  return stepMatch[0];
}

test('gate job pins an explicit repository/ref checkout for the resolver instead of the ambient (caller) checkout', () => {
  const step = extractCheckoutStep();

  assert.match(
    step,
    /repository:\s*Archetipo95\/storybook-github-pages/,
    'checkout must explicitly target this action repo, not the caller'
  );
  const refMatch = step.match(/ref:\s*([a-f0-9]{40})/);
  assert.ok(refMatch, 'checkout must pin an explicit full-length commit SHA ref');
  assert.match(
    step,
    /path:\s*\.storybook-github-pages-resolver/,
    'checkout must land in a dedicated path, not the job workspace root'
  );
  assert.match(step, /persist-credentials:\s*false/, 'resolver checkout must never persist credentials');

  const sha = refMatch[1];
  assert.ok(gitCommitExists(sha), `pinned commit ${sha} does not exist in this repository's history`);
  assert.ok(
    gitShowExists(sha, 'src/resolve-run-context.js'),
    `pinned commit ${sha} is missing src/resolve-run-context.js required by the gate job`
  );
});

test('extract-context step imports the resolver from the pinned checkout path, not the job workspace root', () => {
  const script = extractGateResolverStep();
  assert.match(script, /import\("\.\/\.storybook-github-pages-resolver\/src\/resolve-run-context\.js"\)/);
  assert.doesNotMatch(script, /import\("\.\/src\/resolve-run-context\.js"\)/);
});

test('extract-context step resolves the trusted PR context even when the job workspace has no top-level src/ (consumer checkout simulation)', () => {
  // Simulate exactly what breaks in a consumer repo: cwd (the ambient
  // checkout of the *caller*) has no `src/` at all. Only the pinned
  // resolver checkout subdirectory is populated, as the fixed workflow does.
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-resolver-consumer-checkout-'));
  const resolverDir = path.join(workDir, '.storybook-github-pages-resolver', 'src');
  fs.mkdirSync(resolverDir, { recursive: true });
  fs.copyFileSync(path.join(repoRoot, 'src/resolve-run-context.js'), path.join(resolverDir, 'resolve-run-context.js'));
  assert.ok(!fs.existsSync(path.join(workDir, 'src')), 'sanity check: consumer checkout has no top-level src/');

  const runId = 987654321;
  const runData = {
    id: runId,
    conclusion: 'success',
    event: 'pull_request',
    repository: { full_name: 'Archetipo95/storybook-vue-demo' },
    head_repository: { full_name: 'Archetipo95/storybook-vue-demo' },
    head_sha: 'a'.repeat(40),
    pull_requests: [{ number: 42, base: { ref: 'main' } }]
  };

  // Stub global fetch (used by the script for the artifacts-listing call)
  // before the extracted script runs, so this test never hits the network.
  const stubPath = path.join(workDir, 'fetch-stub.cjs');
  fs.writeFileSync(
    stubPath,
    `globalThis.fetch = async (url) => {
      if (String(url).includes('/artifacts')) {
        return { ok: true, json: async () => ({ artifacts: [{ name: 'storybook-preview-pr-42-run-${runId}' }] }) };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    };`
  );

  const outputFile = path.join(workDir, 'github_output');
  fs.writeFileSync(outputFile, '');

  const script = extractGateResolverStep();
  const result = spawnSync('bash', ['-c', script], {
    cwd: workDir,
    env: {
      ...process.env,
      NODE_OPTIONS: `--require ${stubPath}`,
      WORKFLOW_RUN_EVENT: JSON.stringify(runData),
      INPUT_RUN_ID: '',
      INPUT_ARTIFACT_NAME: '',
      GITHUB_TOKEN: 'test-token',
      REPOSITORY: 'Archetipo95/storybook-vue-demo',
      GITHUB_OUTPUT: outputFile
    },
    encoding: 'utf8'
  });

  assert.equal(result.status, 0, `expected script to succeed, got stderr: ${result.stderr}`);
  assert.doesNotMatch(result.stderr, /Cannot find module/);

  const output = fs.readFileSync(outputFile, 'utf8');
  assert.match(output, /run_id=987654321/);
  assert.match(output, /pr_number=42/);
  assert.match(output, /base_ref=main/);
  assert.match(output, new RegExp(`head_sha=${'a'.repeat(40)}`));
});

test('extract-context step fails with the reported "Cannot find module" error when the resolver is missing (proves the test reproduces the regression)', () => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-resolver-missing-'));
  const outputFile = path.join(workDir, 'github_output');
  fs.writeFileSync(outputFile, '');

  const script = extractGateResolverStep();
  const result = spawnSync('bash', ['-c', script], {
    cwd: workDir,
    env: {
      ...process.env,
      WORKFLOW_RUN_EVENT: '',
      INPUT_RUN_ID: '999',
      INPUT_ARTIFACT_NAME: '',
      GITHUB_TOKEN: 'test-token',
      REPOSITORY: 'Archetipo95/storybook-vue-demo',
      GITHUB_OUTPUT: outputFile
    },
    encoding: 'utf8'
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Cannot find module/);
});
