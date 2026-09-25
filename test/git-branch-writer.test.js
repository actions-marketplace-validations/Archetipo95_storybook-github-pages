import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requestPagesRebuild } from '../src/git-branch-writer.js';

const COMMIT_SHA = 'a'.repeat(40);

function response({ ok = true, status = 200, body = '' } = {}) {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body))
  };
}

test('requestPagesRebuild waits for a successful build of the pushed commit', async () => {
  const originalFetch = global.fetch;
  const requests = [];
  global.fetch = async (url, options = {}) => {
    requests.push({ url, method: options.method || 'GET' });
    if (options.method === 'POST') return response({ status: 201, body: { status: 'queued' } });
    if (requests.length === 2) return response({ body: [{ commit: 'b'.repeat(40), status: 'built' }] });
    return response({ body: [{ commit: COMMIT_SHA, status: 'built' }] });
  };

  try {
    const build = await requestPagesRebuild({
      token: 'token',
      repository: 'octo/widgets',
      commitSha: COMMIT_SHA,
      pollIntervalMs: 0
    });
    assert.equal(build.commit, COMMIT_SHA);
    assert.deepEqual(
      requests.map(({ method }) => method),
      ['POST', 'GET', 'GET']
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test('requestPagesRebuild fails when no build appears for the pushed commit', async () => {
  const originalFetch = global.fetch;
  global.fetch = async (_url, options = {}) =>
    options.method === 'POST'
      ? response({ status: 201, body: { status: 'queued' } })
      : response({ body: [{ commit: 'b'.repeat(40), status: 'built' }] });

  try {
    await assert.rejects(
      requestPagesRebuild({
        token: 'token',
        repository: 'octo/widgets',
        commitSha: COMMIT_SHA,
        timeoutMs: 0
      }),
      new RegExp(`Timed out waiting for a Pages build for pushed commit ${COMMIT_SHA}`)
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test('requestPagesRebuild surfaces Pages builds API failures', async () => {
  const originalFetch = global.fetch;
  global.fetch = async (_url, options = {}) =>
    options.method === 'POST'
      ? response({ status: 201, body: { status: 'queued' } })
      : response({ ok: false, status: 503, body: 'service unavailable' });

  try {
    await assert.rejects(
      requestPagesRebuild({
        token: 'token',
        repository: 'octo/widgets',
        commitSha: COMMIT_SHA
      }),
      new RegExp(`Pages build verification failed \\(503\\) for pushed commit ${COMMIT_SHA}: service unavailable`)
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test('requestPagesRebuild surfaces a failed build for the pushed commit', async () => {
  const originalFetch = global.fetch;
  global.fetch = async (_url, options = {}) =>
    options.method === 'POST'
      ? response({ status: 201, body: { status: 'queued' } })
      : response({ body: [{ commit: { sha: COMMIT_SHA }, status: 'errored', error: { message: 'Jekyll failed' } }] });

  try {
    await assert.rejects(
      requestPagesRebuild({
        token: 'token',
        repository: 'octo/widgets',
        commitSha: COMMIT_SHA
      }),
      new RegExp(`Pages build for pushed commit ${COMMIT_SHA} failed: Jekyll failed`)
    );
  } finally {
    global.fetch = originalFetch;
  }
});
