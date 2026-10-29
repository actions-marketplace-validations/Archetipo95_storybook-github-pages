import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolvePreviewTarget,
  buildPreviewMetadata,
  validatePreviewMetadata,
  decidePreviewAction,
  PREVIEW_METADATA_SCHEMA_VERSION
} from '../src/preview-metadata.js';

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);

function sameRepoMetadata(overrides = {}) {
  return buildPreviewMetadata({
    repository: 'octo/widgets',
    runId: 123,
    runAttempt: 1,
    prNumber: 42,
    baseRef: 'main',
    headRepository: 'octo/widgets',
    headSha: SHA_A,
    artifactName: 'storybook-preview-pr-42-run-123',
    contentDigest: '0'.repeat(64),
    previewRoot: 'pr-preview',
    ...overrides
  });
}

test('resolvePreviewTarget builds a safe, configurable preview path', () => {
  assert.equal(resolvePreviewTarget({ previewRoot: 'pr-preview', prNumber: 7 }), 'pr-preview/pr-7');
  assert.equal(resolvePreviewTarget({ previewRoot: 'previews', prNumber: '12' }), 'previews/pr-12');
  assert.equal(
    resolvePreviewTarget({ previewRoot: '', prNumber: 42 }),
    'pr-42',
    'repository-root layout produces pr-<number>'
  );
});

test('resolvePreviewTarget rejects unsafe roots and PR numbers', () => {
  assert.throws(() => resolvePreviewTarget({ previewRoot: '../escape', prNumber: 1 }), /preview_root/);
  assert.throws(() => resolvePreviewTarget({ previewRoot: '.git', prNumber: 1 }), /preview_root/);
  assert.throws(() => resolvePreviewTarget({ previewRoot: 'pr-preview', prNumber: 0 }), /prNumber/);
  assert.throws(() => resolvePreviewTarget({ previewRoot: 'pr-preview', prNumber: 'abc' }), /prNumber/);
  assert.throws(() => resolvePreviewTarget({ previewRoot: 'pr-preview', prNumber: '5; rm -rf /' }), /prNumber/);
});

test('buildPreviewMetadata produces a target for same-repository PRs', () => {
  const metadata = sameRepoMetadata();
  assert.equal(metadata.schemaVersion, PREVIEW_METADATA_SCHEMA_VERSION);
  assert.equal(metadata.isFork, false);
  assert.equal(metadata.target, 'pr-preview/pr-42');
});

test('buildPreviewMetadata marks fork PRs with a null target and explicit isFork', () => {
  const metadata = sameRepoMetadata({ headRepository: 'someone-else/widgets' });
  assert.equal(metadata.isFork, true);
  assert.equal(metadata.target, null);
});

test('buildPreviewMetadata rejects shell/path-unsafe fields before they can be used anywhere', () => {
  assert.throws(() => sameRepoMetadata({ headSha: 'not-a-sha' }), /headSha/);
  assert.throws(() => sameRepoMetadata({ repository: 'octo/widgets; rm -rf /' }), /repository/);
  assert.throws(() => sameRepoMetadata({ baseRef: 'main`touch pwned`' }), /baseRef/);
  assert.throws(() => sameRepoMetadata({ artifactName: '../../etc/passwd' }), /artifactName/);
  assert.throws(() => sameRepoMetadata({ prNumber: '7 && curl evil.example' }), /prNumber/);
});

test('validatePreviewMetadata accepts a well-formed same-repo payload', () => {
  assert.equal(validatePreviewMetadata(sameRepoMetadata()), true);
});

test('validatePreviewMetadata rejects an unsupported schema version', () => {
  const metadata = { ...sameRepoMetadata(), schemaVersion: 2 };
  assert.throws(() => validatePreviewMetadata(metadata), /schema version/);
});

test('validatePreviewMetadata rejects internally inconsistent isFork/target combinations', () => {
  const forkClaimingTarget = { ...sameRepoMetadata({ headRepository: 'fork/widgets' }), target: 'pr-preview/pr-42' };
  assert.throws(() => validatePreviewMetadata(forkClaimingTarget), /target must be null/);

  const nonForkMissingTarget = { ...sameRepoMetadata(), target: null };
  assert.throws(() => validatePreviewMetadata(nonForkMissingTarget), /metadata\.target/);

  const inconsistentFlag = { ...sameRepoMetadata(), isFork: true };
  assert.throws(() => validatePreviewMetadata(inconsistentFlag), /inconsistent/);
});

test('validatePreviewMetadata rejects any field mismatch against the trusted workflow_run context', () => {
  const metadata = sameRepoMetadata();
  const trustedContext = {
    repository: 'octo/widgets',
    runId: 123,
    prNumber: 42,
    headSha: SHA_A,
    headRepository: 'octo/widgets',
    baseRef: 'main',
    artifactName: 'storybook-preview-pr-42-run-123'
  };
  assert.equal(validatePreviewMetadata(metadata, trustedContext), true);

  for (const [field, badValue] of [
    ['runId', 999],
    ['prNumber', 999],
    ['headSha', SHA_B],
    ['headRepository', 'someone-else/widgets'],
    ['baseRef', 'develop'],
    ['artifactName', 'something-else']
  ]) {
    assert.throws(
      () => validatePreviewMetadata(metadata, { ...trustedContext, [field]: badValue }),
      new RegExp(field),
      `expected mismatch on ${field} to be rejected`
    );
  }
});

test('decidePreviewAction publishes only for a matching, current, same-repo head SHA', () => {
  const metadata = sameRepoMetadata();
  const decision = decidePreviewAction({ metadata, trustedContext: undefined, currentHeadSha: SHA_A });
  assert.equal(decision.action, 'publish');
});

test('decidePreviewAction skips fork pull requests explicitly, without throwing', () => {
  const metadata = sameRepoMetadata({ headRepository: 'fork/widgets' });
  const decision = decidePreviewAction({ metadata, currentHeadSha: SHA_A });
  assert.equal(decision.action, 'skip-fork');
});

test('decidePreviewAction skips a stale run whose head SHA no longer matches the live PR head', () => {
  const metadata = sameRepoMetadata();
  const decision = decidePreviewAction({ metadata, currentHeadSha: SHA_B });
  assert.equal(decision.action, 'skip-stale');
  assert.match(decision.reason, /stale/);
});

test('decidePreviewAction throws on provenance mismatches instead of silently skipping', () => {
  const metadata = sameRepoMetadata();
  assert.throws(
    () =>
      decidePreviewAction({
        metadata,
        trustedContext: { repository: 'someone-else/widgets' },
        currentHeadSha: SHA_A
      }),
    /does not match trusted workflow_run context/
  );
});

test('decidePreviewAction rejects a malformed currentHeadSha rather than comparing loosely', () => {
  const metadata = sameRepoMetadata();
  assert.throws(() => decidePreviewAction({ metadata, currentHeadSha: 'not-a-sha' }), /currentHeadSha/);
});

test('validatePreviewMetadata rejects metadata targets that escape or overwrite protected paths', () => {
  for (const target of ['../main', 'pr-preview/../..', '.git/hooks', '.github/workflows', '/etc', 'C:/x']) {
    assert.throws(
      () => validatePreviewMetadata({ ...sameRepoMetadata(), target }),
      /metadata\.target/,
      `expected target ${target} to be rejected`
    );
  }
});
