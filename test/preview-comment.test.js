import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMarker, buildCommentBody, buildExpirationStatus, upsertPreviewComment } from '../src/preview-comment.js';

const SHA = 'c'.repeat(40);

function mockFetchSequence(handlers) {
  const calls = [];
  const originalFetch = global.fetch;
  global.fetch = async (url, options) => {
    calls.push({ url, options });
    const handler = handlers.shift();
    if (!handler) throw new Error(`Unexpected fetch call: ${url}`);
    return handler(url, options);
  };
  return {
    calls,
    restore: () => {
      global.fetch = originalFetch;
    }
  };
}

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body)
  };
}

test('buildMarker embeds the PR number in a stable hidden marker', () => {
  assert.equal(buildMarker(42), '<!-- storybook-pages-preview:pr-42 -->');
  assert.throws(() => buildMarker('not-a-number'), /Invalid PR number/);
});

test('buildCommentBody includes the marker, preview URL, and short SHA', () => {
  const body = buildCommentBody({
    prNumber: 7,
    previewUrl: 'https://octo.github.io/widgets/pr-preview/pr-7',
    headSha: SHA,
    runId: 99,
    repository: 'octo/widgets'
  });

  assert.ok(body.startsWith(buildMarker(7)));
  assert.match(body, /https:\/\/octo\.github\.io\/widgets\/pr-preview\/pr-7/);
  assert.match(body, new RegExp(SHA.slice(0, 7)));
});

test('buildExpirationStatus is deterministic for warnings and expiry', () => {
  assert.match(buildExpirationStatus({ warningDays: 3 }), /will be removed in 3 days/);
  assert.match(buildExpirationStatus({ expired: true }), /has expired and was removed/);
});

test('buildCommentBody renders badges, test results, coverage delta, and growth chart when available', () => {
  const body = buildCommentBody({
    prNumber: 42,
    previewUrl: 'https://octo.github.io/widgets/pr-preview/pr-42',
    headSha: SHA,
    runId: 100,
    repository: 'octo/widgets',
    metrics: {
      storiesCount: 25,
      componentsCount: 6,
      totalComponents: 6,
      coveragePercent: 100,
      tests: { total: 12, passed: 12, failed: 0 }
    },
    baseMetrics: {
      storiesCount: 20,
      componentsCount: 4,
      totalComponents: 6,
      coveragePercent: 67,
      tests: { total: 10, passed: 8, failed: 2 }
    },
    hasBadges: true,
    hasStatsGraph: true
  });

  assert.ok(body.includes('badges/coverage.svg'));
  assert.ok(body.includes('badges/stories.svg'));
  assert.ok(body.includes('badges/components.svg'));
  assert.ok(body.includes('badges/tests.svg'));
  assert.ok(body.includes('badges/status.svg'));
  assert.ok(body.includes('### 🧪 Interaction Test Results'));
  assert.ok(body.includes('Passed:** 12 / **Failed:** 0 / **Total:** 12'));
  assert.ok(body.includes('| 🎯 **Component Coverage** | `67% (4/6)` | `100% (6/6)` | **+33%** 🟢 |'));
  assert.ok(body.includes('| 📚 **Stories** | 20 | 25 | +5 📈 |'));
  assert.ok(body.includes('| 🧩 **Documented Components** | 4 | 6 | +2 📈 |'));
  assert.ok(body.includes('stats/history.svg'));
});

test('upsertPreviewComment creates a new comment when none exists yet', async () => {
  const mock = mockFetchSequence([
    url => {
      assert.match(url, /\/issues\/7\/comments\?per_page=100&page=1$/);
      return jsonResponse(200, []);
    },
    (url, options) => {
      assert.match(url, /\/issues\/7\/comments$/);
      assert.equal(options.method, 'POST');
      return jsonResponse(201, { id: 555 });
    }
  ]);
  try {
    const result = await upsertPreviewComment({
      token: 't',
      repository: 'octo/widgets',
      prNumber: 7,
      body: `${buildMarker(7)}\nhello`
    });

    assert.deepEqual(result, { action: 'created', commentId: 555 });
    assert.equal(mock.calls.length, 2);
  } finally {
    mock.restore();
  }
});

test('upsertPreviewComment updates the existing bot comment instead of creating a duplicate (idempotency)', async () => {
  const marker = buildMarker(7);
  const mock = mockFetchSequence([
    () =>
      jsonResponse(200, [
        { id: 1, body: 'unrelated comment' },
        { id: 42, body: `${marker}\nold body`, user: { login: 'github-actions[bot]', type: 'Bot' } }
      ]),
    (url, options) => {
      assert.match(url, /\/issues\/comments\/42$/);
      assert.equal(options.method, 'PATCH');
      return jsonResponse(200, { id: 42 });
    }
  ]);
  try {
    const result = await upsertPreviewComment({
      token: 't',
      repository: 'octo/widgets',
      prNumber: 7,
      body: `${marker}\nnew body`
    });
    assert.deepEqual(result, { action: 'updated', commentId: 42 });
    assert.equal(mock.calls.length, 2, 'must not create a second comment when one already exists');
  } finally {
    mock.restore();
  }
});

test('upsertPreviewComment paginates through comment listings to find the marker', async () => {
  const marker = buildMarker(9);
  const fullPage = Array.from({ length: 100 }, (_, i) => ({ id: i, body: `comment ${i}` }));
  const mock = mockFetchSequence([
    url => {
      assert.match(url, /page=1$/);
      return jsonResponse(200, fullPage);
    },
    url => {
      assert.match(url, /page=2$/);
      return jsonResponse(200, [
        { id: 900, body: `${marker}\nfound`, user: { login: 'github-actions[bot]', type: 'Bot' } }
      ]);
    },
    (url, options) => {
      assert.equal(options.method, 'PATCH');
      return jsonResponse(200, { id: 900 });
    }
  ]);
  try {
    const result = await upsertPreviewComment({
      token: 't',
      repository: 'octo/widgets',
      prNumber: 9,
      body: `${marker}\nnew`
    });
    assert.equal(result.action, 'updated');
    assert.equal(result.commentId, 900);
  } finally {
    mock.restore();
  }
});

test('upsertPreviewComment fails closed when a user claims the preview marker', async () => {
  const marker = buildMarker(10);
  const mock = mockFetchSequence([
    () => jsonResponse(200, [{ id: 901, body: `${marker}\nmalicious`, user: { login: 'octocat', type: 'User' } }])
  ]);
  try {
    await assert.rejects(
      upsertPreviewComment({ token: 't', repository: 'octo/widgets', prNumber: 10, body: `${marker}\nnew` }),
      /Refusing to update comment 901: preview marker is owned by a non-github-actions\[bot\] account/
    );
    assert.equal(mock.calls.length, 1, 'must not patch or create after a marker conflict');
  } finally {
    mock.restore();
  }
});

test('upsertPreviewComment surfaces GitHub API errors with status and context', async () => {
  const mock = mockFetchSequence([() => jsonResponse(500, { message: 'boom' })]);
  try {
    await assert.rejects(
      upsertPreviewComment({ token: 't', repository: 'octo/widgets', prNumber: 3, body: `${buildMarker(3)}\nhi` }),
      /GitHub API request failed \(500/
    );
  } finally {
    mock.restore();
  }
});

test('upsertPreviewComment requires the body to include the stable marker', async () => {
  await assert.rejects(
    upsertPreviewComment({ token: 't', repository: 'octo/widgets', prNumber: 3, body: 'no marker here' }),
    /stable preview marker/
  );
});

test('upsertPreviewComment rejects invalid PR numbers before making any request', async () => {
  const mock = mockFetchSequence([]);
  try {
    await assert.rejects(
      upsertPreviewComment({ token: 't', repository: 'octo/widgets', prNumber: '3; rm -rf /', body: 'x' }),
      /Invalid PR number/
    );
    assert.equal(mock.calls.length, 0);
  } finally {
    mock.restore();
  }
});
