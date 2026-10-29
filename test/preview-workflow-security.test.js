import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

function extractJobBlock(content, jobName) {
  const regex = new RegExp(`^  ${jobName}:[\\s\\S]*?(?=^  [A-Za-z0-9_-]+:\\n|$(?![\\s\\S]))`, 'm');
  const match = content.match(regex);
  assert.ok(match, `job "${jobName}" not found`);
  return match[0];
}

test('pr-preview-build workflow is unprivileged: contents:read only, no secrets, untrusted checkout of the PR head', () => {
  const content = read('.github/workflows/pr-preview-build.yml');

  assert.match(content, /^on:\s*\n\s*pull_request:/m);
  assert.match(content, /permissions:\s*\n\s*contents:\s*read\s*\n/);
  assert.doesNotMatch(content, /pages:\s*write/);
  assert.doesNotMatch(content, /id-token:\s*write/);
  assert.doesNotMatch(content, /pull-requests:\s*write/);
  assert.doesNotMatch(content, /secrets\./, 'the untrusted build workflow must never reference secrets');
  assert.match(content, /ref: \$\{\{ github\.event\.pull_request\.head\.sha \}\}/);
  assert.doesNotMatch(content, /uses: actions\/cache/, 'no shared build cache to avoid cross-fork cache poisoning');
});

test('pr-preview-publish workflow gates on success/event/repository and requires a matching same-repo pull request', () => {
  const content = read('.github/workflows/pr-preview-publish.yml');

  assert.match(content, /workflow_run:\s*\n\s*workflows:\s*\[['"]PR Preview Build['"]\]/);
  assert.match(content, /workflow_call:/, 'publish must support reusable workflow_call trigger');
  assert.match(content, /workflow_run_id:/, 'publish must support workflow_run_id input');
  assert.match(content, /preview_root:/, 'publish must support preview_root input');
  assert.match(content, /pages_branch:/, 'publish must support pages_branch input');
  assert.match(content, /site_url:/, 'publish must support site_url input');
  assert.match(content, /base_path:/, 'publish must support base_path input');
  assert.match(content, /generate_stats_graph:/, 'publish must support generate_stats_graph input');
  assert.match(content, /stats_directory:/, 'publish must support stats_directory input');
  assert.match(content, /badges_directory:/, 'publish must support badges_directory input');
  assert.match(content, /managed_directories:/, 'publish must support managed_directories input');
  assert.match(content, /artifact_name:/, 'publish must support artifact_name input');
  assert.match(content, /enable_passcode_gate:/, 'publish must support passcode gate input');
  assert.match(content, /passcode_session_hours:/, 'publish must support passcode session duration');
  assert.match(content, /passcode_hash:/, 'publish must declare the trusted passcode secret');
  const gateJob = extractJobBlock(content, 'gate');
  assert.match(gateJob, /github\.event\.workflow_run\.conclusion == 'success'/);
  assert.match(gateJob, /github\.event\.workflow_run\.event == 'pull_request'/);
  assert.match(gateJob, /github\.event\.workflow_run\.repository\.full_name == github\.repository/);
  assert.match(
    gateJob,
    /github\.event\.workflow_run\.pull_requests\[0\] != null/,
    'fork PRs (empty pull_requests[]) must be excluded by the gate condition'
  );
  assert.match(gateJob, /contents:\s*read/, 'the gate job must grant contents: read');
  assert.match(
    gateJob,
    /pull-requests:\s*read/,
    'the gate job must grant pull-requests: read to fetch current PR head SHA'
  );
  assert.match(gateJob, /actions:\s*read/, 'the gate job must grant actions: read to fetch workflow run context');
  assert.doesNotMatch(gateJob, /contents:\s*write/, 'the read-only gate job must not hold write permissions');
  assert.doesNotMatch(gateJob, /pages:\s*write/, 'the read-only gate job must not hold pages write permissions');
  assert.doesNotMatch(
    gateJob,
    /pull-requests:\s*write/,
    'the read-only gate job must not hold pull-requests write permissions'
  );

  const publishJob = extractJobBlock(content, 'publish');
  assert.match(publishJob, /contents:\s*write/);
  assert.match(publishJob, /pages:\s*write/);
  assert.match(publishJob, /pull-requests:\s*write/);
  assert.match(publishJob, /actions:\s*read/);
  assert.match(publishJob, /run-id: \$\{\{ needs\.gate\.outputs\.run_id \}\}/);
  assert.match(publishJob, /github-token: \$\{\{ secrets\.GITHUB_TOKEN \}\}/);
  assert.match(publishJob, /passcode_hash: \$\{\{ secrets\.passcode_hash \}\}/);
  assert.doesNotMatch(
    read('.github/workflows/pr-preview-build.yml'),
    /passcode_hash|enable_passcode_gate|PASSCODE_HASH/,
    'the untrusted build workflow must never receive passcode gate configuration or secrets'
  );
  assert.match(
    publishJob,
    /git ls-remote --exit-code --heads origin/,
    'publish must check if Pages branch exists remotely before attempting checkout'
  );
  assert.match(
    publishJob,
    /steps\.branch_check\.outputs\.exists == 'true'/,
    'checkout and publish steps must be guarded by Pages branch existence'
  );
  assert.match(
    publishJob,
    /generate_stats_graph: \$\{\{ steps\.config\.outputs\.generate_stats_graph \}\}/,
    'trusted publisher must receive the resolved stats regeneration setting'
  );
  assert.match(
    publishJob,
    /stats_directory: \$\{\{ steps\.config\.outputs\.stats_directory \}\}/,
    'trusted publisher must receive the resolved stats directory'
  );
  assert.match(
    publishJob,
    /badges_directory: \$\{\{ steps\.config\.outputs\.badges_directory \}\}/,
    'trusted publisher must receive the resolved badges directory'
  );
});

test('pr-preview-publish pins a preview-publisher action schema that supports the passcode gate', () => {
  const content = read('.github/workflows/pr-preview-publish.yml');
  const match = content.match(/Archetipo95\/storybook-github-pages\/preview-publisher@([a-f0-9]{40})/);
  assert.ok(match, 'publish must pin preview-publisher to a full commit SHA');

  const action = execFileSync('git', ['show', `${match[1]}:preview-publisher/action.yml`], {
    cwd: root,
    encoding: 'utf8'
  });

  assert.match(action, /enable_passcode_gate:/, 'pinned preview-publisher must accept enable_passcode_gate');
  assert.match(action, /passcode_hash:/, 'pinned preview-publisher must accept passcode_hash');
  assert.match(action, /passcode_session_hours:/, 'pinned preview-publisher must accept passcode_session_hours');
  assert.match(action, /generate_stats_graph:/, 'pinned preview-publisher must accept generate_stats_graph');
  assert.match(action, /stats_directory:/, 'pinned preview-publisher must accept stats_directory');
});

test('pr-preview-cleanup workflow never checks out the pull request head and stays metadata-only', () => {
  const content = read('.github/workflows/pr-preview-cleanup.yml');

  assert.match(content, /pull_request_target:\s*\n\s*types: \[closed\]/);
  assert.match(content, /workflow_call:/, 'cleanup must support reusable workflow_call trigger');
  assert.match(content, /preview_root:/, 'cleanup must support preview_root input');
  assert.match(content, /pages_branch:/, 'cleanup must support pages_branch input');
  assert.match(content, /pr_number:/, 'cleanup must support pr_number input');
  assert.match(
    content,
    /inputs\.pr_number > 0 && inputs\.pr_number \|\| github\.event\.pull_request\.number/,
    'cleanup must treat the default workflow_call pr_number=0 as missing and fall back to event metadata'
  );
  assert.doesNotMatch(
    content,
    /ref: \$\{\{ github\.event\.pull_request\.head/,
    'cleanup must never check out the PR head ref/sha'
  );
  assert.doesNotMatch(
    content,
    /pull-requests:\s*write/,
    'cleanup does not need PR write access; it only touches the Pages branch'
  );
  const cleanupJob = extractJobBlock(content, 'cleanup');
  assert.match(cleanupJob, /contents:\s*write/);
  assert.match(cleanupJob, /pages:\s*write/);
  assert.match(cleanupJob, /deployments:\s*write/);
  assert.match(
    cleanupJob,
    /git ls-remote --exit-code --heads origin/,
    'cleanup must check if Pages branch exists remotely before attempting checkout'
  );
  assert.match(
    cleanupJob,
    /steps\.branch_check\.outputs\.exists == 'true'/,
    'checkout and removal steps must be guarded by Pages branch existence'
  );
});

test('pr-preview-janitor workflow supports manual dispatch and schedule, never checks out a pull request head', () => {
  const content = read('.github/workflows/pr-preview-janitor.yml');

  assert.match(content, /workflow_dispatch:/);
  assert.match(content, /schedule:/);
  assert.match(content, /workflow_call:/, 'janitor must support reusable workflow_call trigger');
  assert.match(content, /preview_root:/, 'janitor must support preview_root input');
  assert.match(content, /pages_branch:/, 'janitor must support pages_branch input');
  assert.match(content, /retention_days:/, 'janitor must support retention_days input');
  assert.match(content, /warning_days_before_cleanup:/, 'janitor must support warning_days_before_cleanup input');
  assert.doesNotMatch(content, /pull_request/);
  const janitorJob = extractJobBlock(content, 'janitor');
  assert.match(janitorJob, /contents:\s*write/);
  assert.match(janitorJob, /pages:\s*write/);
  assert.match(janitorJob, /deployments:\s*write/);
  assert.match(janitorJob, /pull-requests:\s*read/);
  assert.match(
    janitorJob,
    /git ls-remote --exit-code --heads origin/,
    'janitor must check if Pages branch exists remotely before attempting checkout'
  );
  assert.match(
    janitorJob,
    /steps\.branch_check\.outputs\.exists == 'true'/,
    'checkout and prune steps must be guarded by Pages branch existence'
  );
});

function pagesConcurrencyBlocks(content) {
  return [...content.matchAll(/^( *)concurrency:\n((?:\1 {2}.*\n)+)/gm)]
    .map(([, indent, body]) => ({ indent, body }))
    .filter(({ body }) => body.includes('group: storybook-pages-${{ github.repository }}'));
}

test('trusted Pages writers share one concurrency group that queues instead of replacing pending runs', () => {
  for (const { file, job } of [
    { file: '.github/workflows/pr-preview-publish.yml', job: 'publish' },
    { file: '.github/workflows/pr-preview-cleanup.yml', job: 'cleanup' },
    { file: '.github/workflows/pr-preview-janitor.yml', job: 'janitor' },
    { file: '.github/workflows/deploy-storybook.yml' },
    { file: 'docs/usage.md' }
  ]) {
    const content = read(file);
    const writer = job ? `${file} job "${job}"` : `${file} (workflow level)`;
    assert.equal(
      pagesConcurrencyBlocks(content).length,
      1,
      `${file} must join the shared Pages concurrency group exactly once`
    );
    const [block] = pagesConcurrencyBlocks(job ? extractJobBlock(content, job) : content);
    assert.equal(block?.indent, job ? '    ' : '', `${writer} must join the shared Pages concurrency group`);
    assert.match(
      block.body,
      /^\s*cancel-in-progress: false$/m,
      `${writer} must never cancel an in-progress Pages write`
    );
    assert.match(
      block.body,
      /^\s*queue: max$/m,
      `${writer} must set queue: max: with GitHub's default single queue, every run that joins the group cancels the pending one, which silently drops PR preview publishes and cleanups`
    );
  }
});

function markdownSection(content, heading) {
  const start = content.indexOf(`### ${heading}`);
  assert.notEqual(start, -1, `section "${heading}" not found`);
  const end = content.indexOf('\n### ', start + 1);
  return content.slice(start, end === -1 ? undefined : end);
}

test('docs recover a cancelled preview publish without reusing the gate job head SHA snapshot', () => {
  assert.match(
    extractJobBlock(read('.github/workflows/pr-preview-publish.yml'), 'publish'),
    /current_head_sha: \$\{\{ needs\.gate\.outputs\.current_head_sha \}\}/,
    'the publish job compares against the head SHA the gate job fetched, so re-running publish alone reuses that snapshot'
  );

  const recovery = markdownSection(read('docs/troubleshooting.md'), '10. PR Preview Publish or Cleanup Cancelled');
  assert.match(recovery, /Re-run all jobs/, 'recovery must re-run the gate job so it re-reads the PR head');
  assert.match(
    recovery,
    /never use \*\*Re-run failed jobs\*\* \(`gh run rerun <run-id> --failed`\) on a publish run/i,
    'recovery must warn that re-running only the failed publish job reuses the gate job head SHA'
  );
  assert.match(
    recovery,
    /never re-run the `publish` job on its own \(\*\*Re-run job\*\* on `publish`, or `gh run rerun --job <publish-job-id>`\)/i,
    'recovery must warn against re-running publish alone; re-running the gate job also re-runs publish with a fresh head SHA'
  );

  assert.match(
    markdownSection(read('docs/pr-previews.md'), 'Stale-run protection'),
    /re-running only the publish job .*reuses the `gate` job's earlier head SHA snapshot/i,
    'stale-run docs must say that a publish-only re-run reuses the gate head SHA'
  );
});

test('preview target resolution and metadata modules are wired into the workflows and composite actions', () => {
  const build = read('.github/workflows/pr-preview-build.yml');
  const publish = read('.github/workflows/pr-preview-publish.yml');
  const cleanupWorkflow = read('.github/workflows/pr-preview-cleanup.yml');
  const janitorWorkflow = read('.github/workflows/pr-preview-janitor.yml');
  const buildAction = read('preview-build/action.yml');
  const publisherAction = read('preview-publisher/action.yml');
  const cleanupAction = read('preview-cleanup/action.yml');
  const janitorAction = read('preview-janitor/action.yml');

  assert.match(
    build,
    /uses:\s*\.\/preview-build/,
    'the reference build workflow must dogfood the public preview-build action'
  );
  assert.match(buildAction, /preview-metadata\.js/);
  assert.match(buildAction, /validate-artifact\.js/);
  assert.match(publish, /preview-publisher@/);
  assert.match(cleanupWorkflow, /preview-cleanup@/);
  assert.match(janitorWorkflow, /preview-janitor@/);
  assert.match(publisherAction, /preview-publish\.js/);
  assert.match(cleanupAction, /preview-cleanup\.js/);
  assert.match(janitorAction, /preview-janitor\.js/);
});
