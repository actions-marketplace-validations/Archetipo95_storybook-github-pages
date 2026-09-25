import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchArtifactPrNumber, resolveTrustedPullRequestContext } from '../src/resolve-run-context.js';

const RUN_ID = 35577199443;

function runData(overrides = {}) {
  return {
    id: RUN_ID,
    conclusion: 'success',
    event: 'pull_request',
    repository: { full_name: 'teamhubcore/kinboo2.0' },
    head_repository: { full_name: 'teamhubcore/kinboo2.0' },
    head_sha: '502d6c5cc04ce24777becd5222a6269923ecdc9b',
    pull_requests: [
      { number: 619, base: { ref: 'master' } },
      { number: 620, base: { ref: 'preprod' } }
    ],
    ...overrides
  };
}

test('matchArtifactPrNumber extracts the PR number only when the run id matches', () => {
  assert.equal(matchArtifactPrNumber(`storybook-preview-pr-619-run-${RUN_ID}`, RUN_ID), 619);
  assert.equal(matchArtifactPrNumber(`storybook-preview-pr-619-run-${RUN_ID}`, RUN_ID + 1), null);
  assert.equal(matchArtifactPrNumber('some-other-artifact', RUN_ID), null);
  assert.equal(matchArtifactPrNumber(undefined, RUN_ID), null);
});

test('resolves the exact PR that uploaded the artifact, not pull_requests[0], when two PRs share a head SHA', () => {
  // Reproduces the reported issue: build uploaded the artifact for PR #619,
  // but pull_requests[] happens to list #620 first.
  const data = runData();
  const artifacts = [{ name: `storybook-preview-pr-619-run-${RUN_ID}` }];

  const context = resolveTrustedPullRequestContext({ runData: data, artifacts });

  assert.equal(context.prNumber, 619);
  assert.equal(context.baseRef, 'master');
  assert.equal(context.headSha, data.head_sha);
  assert.equal(context.headRepository, 'teamhubcore/kinboo2.0');
});

test('resolves PR #620 the same way when its artifact is the one that was uploaded', () => {
  const data = runData();
  const artifacts = [{ name: `storybook-preview-pr-620-run-${RUN_ID}` }];

  const context = resolveTrustedPullRequestContext({ runData: data, artifacts });

  assert.equal(context.prNumber, 620);
  assert.equal(context.baseRef, 'preprod');
});

test('ignores artifacts from unrelated runs when computing candidates', () => {
  const data = runData();
  const artifacts = [
    { name: `storybook-preview-pr-999-run-${RUN_ID + 1}` },
    { name: `storybook-preview-pr-619-run-${RUN_ID}` }
  ];

  const context = resolveTrustedPullRequestContext({ runData: data, artifacts });

  assert.equal(context.prNumber, 619);
});

test('throws when no matching preview artifact was uploaded for this run', () => {
  const data = runData();
  assert.throws(
    () => resolveTrustedPullRequestContext({ runData: data, artifacts: [] }),
    /No "storybook-preview-pr-<PR>-run-.*" artifact was found/
  );
});

test('throws when multiple pull requests uploaded artifacts for the same run (ambiguous)', () => {
  const data = runData();
  const artifacts = [
    { name: `storybook-preview-pr-619-run-${RUN_ID}` },
    { name: `storybook-preview-pr-620-run-${RUN_ID}` }
  ];
  assert.throws(
    () => resolveTrustedPullRequestContext({ runData: data, artifacts }),
    /uploaded preview artifacts for multiple pull requests/
  );
});

test('throws when the artifact references a PR that GitHub did not associate with the run', () => {
  const data = runData();
  const artifacts = [{ name: `storybook-preview-pr-621-run-${RUN_ID}` }];
  assert.throws(
    () => resolveTrustedPullRequestContext({ runData: data, artifacts }),
    /not among the pull requests GitHub associated with workflow run/
  );
});

test('throws when there is no same-repository pull request on the run at all', () => {
  const data = runData({ pull_requests: [] });
  assert.throws(
    () => resolveTrustedPullRequestContext({ runData: data, artifacts: [] }),
    /No same-repository pull request associated with workflow run/
  );
});

test('supports an explicit expectedArtifactName override (workflow_call artifact_name input)', () => {
  const data = runData();
  const artifacts = [{ name: 'custom-name' }];
  assert.throws(
    () => resolveTrustedPullRequestContext({ runData: data, artifacts, expectedArtifactName: 'custom-name' }),
    /does not conform to the .*naming contract/
  );
});

test('resolves via expectedArtifactName when it conforms to the naming contract', () => {
  const data = runData();
  const artifacts = [{ name: `storybook-preview-pr-620-run-${RUN_ID}` }];
  const context = resolveTrustedPullRequestContext({
    runData: data,
    artifacts,
    expectedArtifactName: `storybook-preview-pr-620-run-${RUN_ID}`
  });
  assert.equal(context.prNumber, 620);
  assert.equal(context.baseRef, 'preprod');
});

test('throws when expectedArtifactName is not present among the run artifacts', () => {
  const data = runData();
  assert.throws(
    () =>
      resolveTrustedPullRequestContext({
        runData: data,
        artifacts: [],
        expectedArtifactName: `storybook-preview-pr-620-run-${RUN_ID}`
      }),
    /No artifact named/
  );
});
