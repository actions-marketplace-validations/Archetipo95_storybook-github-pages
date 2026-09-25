import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { digestDirectory, PREVIEW_METADATA_FILENAME, PREVIEW_CONTENT_DIRNAME } from '../src/preview-metadata.js';

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function makeStorybookSource() {
  const sourceDir = makeTempDir('preview-build-source-');
  fs.writeFileSync(path.join(sourceDir, 'index.html'), '<!DOCTYPE html><html><body>Storybook</body></html>');
  fs.writeFileSync(path.join(sourceDir, 'iframe.html'), '<!DOCTYPE html><html><body>Stories iframe</body></html>');
  fs.writeFileSync(path.join(sourceDir, 'stories.json'), '{"stories":{}}');
  return sourceDir;
}

function makeGitHubFiles(prefix) {
  const tempDir = makeTempDir(prefix);
  const outputFilePath = path.join(tempDir, 'github_output');
  const summaryFilePath = path.join(tempDir, 'github_step_summary');
  fs.writeFileSync(outputFilePath, '');
  fs.writeFileSync(summaryFilePath, '');
  return { outputFilePath, summaryFilePath };
}

function extractConfigStepScript() {
  const content = fs.readFileSync(path.join(process.cwd(), 'preview-build/action.yml'), 'utf8');
  const stepMatch = content.match(
    /- name: Resolve bundle configuration[\s\S]*?run: \|\n([\s\S]*?)\n\n    - name: Run Storybook smoke test/
  );
  assert.ok(stepMatch, 'could not locate the "Resolve bundle configuration" step script in preview-build/action.yml');
  return stepMatch[1];
}

function runConfigStep(env) {
  const script = extractConfigStepScript();
  const outputFile = path.join(makeTempDir('preview-build-config-output-'), 'github_output');
  fs.writeFileSync(outputFile, '');
  const result = spawnSync('bash', ['-c', script], {
    env: { ...process.env, GITHUB_OUTPUT: outputFile, RUNNER_TEMP: os.tmpdir(), ...env },
    encoding: 'utf8'
  });
  return { ...result, outputFile, output: fs.existsSync(outputFile) ? fs.readFileSync(outputFile, 'utf8') : '' };
}

const SHA_VALID = 'e'.repeat(40);

test('preview-build action.yml is a read-only, untrusted-job-scoped composite action', () => {
  const actionPath = path.join(process.cwd(), 'preview-build/action.yml');
  assert.ok(fs.existsSync(actionPath), 'preview-build/action.yml must exist');
  const content = fs.readFileSync(actionPath, 'utf8');

  assert.match(content, /name:\s*['"]?Storybook PR preview bundle['"]?/);
  assert.match(content, /using:\s*['"]?composite['"]?/);

  // Required input
  assert.match(content, /source_path:\s*\n\s*description:.*\n\s*required:\s*true/);

  // Event-context inputs default to the pull_request context available in an untrusted build job
  assert.match(
    content,
    /pr_number:\s*\n\s*description:.*\n\s*required:\s*false\s*\n\s*default:\s*\$\{\{ github\.event\.pull_request\.number \}\}/
  );
  assert.match(content, /base_ref:[\s\S]*?default:\s*\$\{\{ github\.event\.pull_request\.base\.ref \}\}/);
  assert.match(
    content,
    /head_repository:[\s\S]*?default:\s*\$\{\{ github\.event\.pull_request\.head\.repo\.full_name \}\}/
  );
  assert.match(content, /head_sha:[\s\S]*?default:\s*\$\{\{ github\.event\.pull_request\.head\.sha \}\}/);
  assert.match(content, /repository:[\s\S]*?default:\s*\$\{\{ github\.repository \}\}/);
  assert.match(content, /run_id:[\s\S]*?default:\s*\$\{\{ github\.run_id \}\}/);

  // Reuses existing preview-metadata/validate-artifact internals rather than duplicating logic
  assert.match(content, /node "\$\{\{ github\.action_path \}\}\/\.\.\/src\/validate-artifact\.js"/);
  assert.match(content, /node "\$\{\{ github\.action_path \}\}\/\.\.\/src\/preview-metadata\.js"/);

  // Never references secrets, tokens, or write/publish targets - this must stay usable only
  // as the untrusted build-side of the contract, never as a trusted publisher component.
  assert.doesNotMatch(content, /secrets\./, 'the untrusted preview-build action must never reference secrets');
  assert.doesNotMatch(
    content,
    /github\.token/,
    'the untrusted preview-build action must never reference the job token'
  );
  assert.doesNotMatch(
    content,
    /pages_repo|pages_branch|trusted_/,
    'preview-build must never accept publisher-side trust/target inputs'
  );

  // Nested third-party action is pinned to a full commit SHA
  assert.match(content, /uses:\s*actions\/upload-artifact@[a-f0-9]{40}/);

  // Refuses to run outside a pull_request-triggered job rather than silently producing a bad bundle
  assert.match(content, /event_name:[\s\S]*?default:\s*\$\{\{ github\.event_name \}\}/);
  assert.match(content, /must run in a job triggered by the pull_request event/);
  assert.match(content, /exit 1/);

  // Never accepts a caller-supplied artifact name override - the deterministic
  // storybook-preview-pr-<PR>-run-<run> namespace the trusted publisher expects
  // must never be spoofable or redirectable by this untrusted build-job action.
  assert.doesNotMatch(
    content,
    /artifact_name:\s*\n\s*description:.*\n\s*required:\s*false/,
    'preview-build must not expose an artifact_name input'
  );
  assert.doesNotMatch(
    content,
    /ARTIFACT_NAME_INPUT/,
    'preview-build must never accept an artifact name override from the caller'
  );

  // Outputs expose the artifact contract for callers that disable upload
  assert.match(content, /artifact_name:\s*\n\s*description:/);
  assert.match(content, /bundle_dir:\s*\n\s*description:/);
  assert.match(content, /content_digest:\s*\n\s*description:/);
  assert.match(content, /is_fork:\s*\n\s*description:/);
});

test('preview-build reference workflow dogfoods the public action instead of inline scripts', () => {
  const content = fs.readFileSync(path.join(process.cwd(), '.github/workflows/pr-preview-build.yml'), 'utf8');
  assert.match(content, /uses:\s*\.\/preview-build/);
  assert.match(content, /source_path:\s*'test\/fixtures\/sample-storybook'/);
  assert.doesNotMatch(
    content,
    /node src\/preview-metadata\.js/,
    'the workflow must delegate to the composite action, not call the script inline'
  );
});

test('pr-preview-build reference workflow exercises the opt-in Playwright smoke-test gate on both public actions', () => {
  const content = fs.readFileSync(path.join(process.cwd(), '.github/workflows/pr-preview-build.yml'), 'utf8');

  const rootActionStep = content.match(/uses:\s*\.\/\n([\s\S]*?)(?=\n {6}- name:|\n {2}- name:|$)/);
  assert.ok(rootActionStep, 'could not locate the root composite action ("uses: ./") step');
  assert.match(rootActionStep[1], /smoke_test:\s*'true'/, 'root composite action step must enable smoke_test');

  const previewBuildStep = content.match(/uses:\s*\.\/preview-build\n([\s\S]*?)$/);
  assert.ok(previewBuildStep, 'could not locate the preview-build composite action step');
  assert.match(
    previewBuildStep[1],
    /smoke_test:\s*'true'/,
    'preview-build composite action step must enable smoke_test'
  );
});

test('preview-metadata CLI emits the artifact contract fields to $GITHUB_OUTPUT for the composite action', () => {
  const sourceDir = makeStorybookSource();
  const outputDir = makeTempDir('preview-build-bundle-');
  const { outputFilePath, summaryFilePath } = makeGitHubFiles('preview-build-env-');

  const scriptPath = path.join(process.cwd(), 'src/preview-metadata.js');
  const env = {
    ...process.env,
    REPOSITORY: 'acme/design-system',
    RUN_ID: '999',
    RUN_ATTEMPT: '1',
    PR_NUMBER: '77',
    BASE_REF: 'main',
    HEAD_REPOSITORY: 'acme/design-system',
    HEAD_SHA: SHA_VALID,
    ARTIFACT_NAME: 'storybook-preview-pr-77-run-999',
    PREVIEW_ROOT: 'pr-preview',
    SOURCE_PATH: sourceDir,
    GITHUB_OUTPUT: outputFilePath,
    GITHUB_STEP_SUMMARY: summaryFilePath
  };

  const run = spawnSync('node', [scriptPath, outputDir], { env, encoding: 'utf8' });
  assert.equal(run.status, 0, `Process failed with stderr: ${run.stderr}`);

  // Deterministic artifact contract: storybook/ + preview-metadata.json
  const metadataPath = path.join(outputDir, PREVIEW_METADATA_FILENAME);
  const contentDir = path.join(outputDir, PREVIEW_CONTENT_DIRNAME);
  assert.ok(fs.existsSync(metadataPath), 'preview-metadata.json must be staged');
  assert.ok(fs.existsSync(path.join(contentDir, 'index.html')), 'storybook/ content must be staged');

  const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
  assert.equal(metadata.artifactName, 'storybook-preview-pr-77-run-999');
  assert.equal(metadata.isFork, false);
  assert.equal(metadata.target, 'pr-preview/pr-77');

  // SHA-256 digest binding: metadata digest must match an independent recomputation of storybook/
  assert.equal(metadata.contentDigest, digestDirectory(contentDir));
  assert.match(metadata.contentDigest, /^[0-9a-f]{64}$/);

  const outputContent = fs.readFileSync(outputFilePath, 'utf8');
  assert.match(outputContent, /artifact_name=storybook-preview-pr-77-run-999/);
  assert.match(outputContent, new RegExp(`content_digest=${metadata.contentDigest}`));
  assert.match(outputContent, /is_fork=false/);
  assert.match(outputContent, /target=pr-preview\/pr-77/);
});

test('preview-metadata CLI marks fork pull requests with a null target and no publish target in outputs', () => {
  const sourceDir = makeStorybookSource();
  const outputDir = makeTempDir('preview-build-fork-bundle-');
  const { outputFilePath, summaryFilePath } = makeGitHubFiles('preview-build-fork-env-');

  const scriptPath = path.join(process.cwd(), 'src/preview-metadata.js');
  const env = {
    ...process.env,
    REPOSITORY: 'acme/design-system',
    RUN_ID: '1000',
    RUN_ATTEMPT: '1',
    PR_NUMBER: '78',
    BASE_REF: 'main',
    HEAD_REPOSITORY: 'external-fork/design-system',
    HEAD_SHA: SHA_VALID,
    ARTIFACT_NAME: 'storybook-preview-pr-78-run-1000',
    PREVIEW_ROOT: 'pr-preview',
    SOURCE_PATH: sourceDir,
    GITHUB_OUTPUT: outputFilePath,
    GITHUB_STEP_SUMMARY: summaryFilePath
  };

  const run = spawnSync('node', [scriptPath, outputDir], { env, encoding: 'utf8' });
  assert.equal(run.status, 0, `Process failed with stderr: ${run.stderr}`);

  const metadata = JSON.parse(fs.readFileSync(path.join(outputDir, PREVIEW_METADATA_FILENAME), 'utf8'));
  assert.equal(metadata.isFork, true);
  assert.equal(metadata.target, null);

  const outputContent = fs.readFileSync(outputFilePath, 'utf8');
  assert.match(outputContent, /is_fork=true/);
  assert.match(outputContent, /target=\n/, 'target output must be empty (not null/undefined literal) for fork PRs');
});

test('preview-metadata CLI fails closed on an empty or non-directory source path rather than staging a broken bundle', () => {
  const outputDir = makeTempDir('preview-build-missing-source-bundle-');
  const scriptPath = path.join(process.cwd(), 'src/preview-metadata.js');
  const env = {
    ...process.env,
    REPOSITORY: 'acme/design-system',
    RUN_ID: '1',
    RUN_ATTEMPT: '1',
    PR_NUMBER: '1',
    BASE_REF: 'main',
    HEAD_REPOSITORY: 'acme/design-system',
    HEAD_SHA: SHA_VALID,
    ARTIFACT_NAME: 'storybook-preview-pr-1-run-1',
    PREVIEW_ROOT: 'pr-preview',
    SOURCE_PATH: path.join(os.tmpdir(), 'this-path-does-not-exist-12345'),
    GITHUB_STEP_SUMMARY: ''
  };

  const run = spawnSync('node', [scriptPath, outputDir], { env, encoding: 'utf8' });
  assert.notEqual(run.status, 0);
  assert.ok(
    !fs.existsSync(path.join(outputDir, PREVIEW_METADATA_FILENAME)),
    'no metadata must be written when the digest/copy step fails'
  );
});

test('preview-metadata CLI rejects an invalid PR number even when a source directory is valid', () => {
  const sourceDir = makeStorybookSource();
  const outputDir = makeTempDir('preview-build-bad-pr-bundle-');
  const scriptPath = path.join(process.cwd(), 'src/preview-metadata.js');
  const env = {
    ...process.env,
    REPOSITORY: 'acme/design-system',
    RUN_ID: '1',
    RUN_ATTEMPT: '1',
    PR_NUMBER: '7; rm -rf /',
    BASE_REF: 'main',
    HEAD_REPOSITORY: 'acme/design-system',
    HEAD_SHA: SHA_VALID,
    ARTIFACT_NAME: 'storybook-preview-pr-1-run-1',
    PREVIEW_ROOT: 'pr-preview',
    SOURCE_PATH: sourceDir,
    GITHUB_STEP_SUMMARY: ''
  };

  const run = spawnSync('node', [scriptPath, outputDir], { env, encoding: 'utf8' });
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /prNumber/);
});

test('preview-build config step guard executes and rejects non-pull_request invocation even with a spoofed pr_number', () => {
  const nonPullRequest = runConfigStep({ EVENT_NAME: 'workflow_dispatch', PR_NUMBER: '999', RUN_ID: '1' });
  assert.notEqual(
    nonPullRequest.status,
    0,
    'the guard must reject a non-pull_request event even when pr_number is supplied'
  );
  assert.match(nonPullRequest.stderr, /must run in a job triggered by the pull_request event/);
  assert.equal(
    nonPullRequest.output,
    '',
    'no artifact_name/bundle_dir output must be produced when the event guard rejects the invocation'
  );
});

test('preview-build config step guard rejects a pull_request event with an empty pr_number', () => {
  const missingPr = runConfigStep({ EVENT_NAME: 'pull_request', PR_NUMBER: '', RUN_ID: '1' });
  assert.notEqual(missingPr.status, 0);
  assert.match(missingPr.stderr, /github\.event\.pull_request\.number is empty/);
});

test('preview-build config step guard rejects non-numeric or zero pr_number/run_id before deriving an artifact name', () => {
  for (const badPr of ['7; rm -rf /', '7abc', '-1', '0', '7.5']) {
    const result = runConfigStep({ EVENT_NAME: 'pull_request', PR_NUMBER: badPr, RUN_ID: '1' });
    assert.notEqual(result.status, 0, `pr_number "${badPr}" must be rejected`);
    assert.match(result.stderr, /pr_number/);
    assert.equal(result.output, '', `no output must be produced for invalid pr_number "${badPr}"`);
  }

  for (const badRun of ['1; rm -rf /', 'abc', '-1', '0']) {
    const result = runConfigStep({ EVENT_NAME: 'pull_request', PR_NUMBER: '42', RUN_ID: badRun });
    assert.notEqual(result.status, 0, `run_id "${badRun}" must be rejected`);
    assert.match(result.stderr, /run_id/);
    assert.equal(result.output, '', `no output must be produced for invalid run_id "${badRun}"`);
  }
});

test('preview-build config step guard always derives the deterministic artifact name and ignores any attempted override', () => {
  const computed = runConfigStep({ EVENT_NAME: 'pull_request', PR_NUMBER: '42', RUN_ID: '555' });
  assert.equal(computed.status, 0, `config step failed: ${computed.stderr}`);
  assert.match(computed.output, /artifact_name=storybook-preview-pr-42-run-555/);
  assert.match(computed.output, /bundle_dir=/);

  // Even if a caller sets an ARTIFACT_NAME_INPUT-like environment variable (as the
  // removed input used to be wired), the script no longer reads it - the name is
  // always storybook-preview-pr-<PR>-run-<run>.
  const attemptedOverride = runConfigStep({
    EVENT_NAME: 'pull_request',
    PR_NUMBER: '42',
    RUN_ID: '555',
    ARTIFACT_NAME_INPUT: 'attacker-controlled-name'
  });
  assert.equal(attemptedOverride.status, 0, `config step failed: ${attemptedOverride.stderr}`);
  assert.match(attemptedOverride.output, /artifact_name=storybook-preview-pr-42-run-555/);
  assert.doesNotMatch(
    attemptedOverride.output,
    /attacker-controlled-name/,
    'artifact_name must never reflect a caller-supplied override'
  );
});
