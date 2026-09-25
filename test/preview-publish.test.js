import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { readBundleMetadata, publishPreview, resolveBaseMetricsPath } from '../src/preview-publish.js';
import { buildPreviewMetadata, digestDirectory } from '../src/preview-metadata.js';
import { buildMarker } from '../src/preview-comment.js';

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    .toString()
    .trim();
}

function initBarePagesRepo() {
  const bareDir = makeTempDir('storybook-pages-bare-');
  git(bareDir, 'init', '--bare', '-q', '.');

  const seedDir = makeTempDir('storybook-pages-seed-');
  git(seedDir, 'init', '-q', '.');
  git(seedDir, 'config', 'user.email', 'seed@example.com');
  git(seedDir, 'config', 'user.name', 'seed');
  fs.writeFileSync(path.join(seedDir, 'index.html'), '<html>root</html>');
  git(seedDir, 'add', '-A');
  git(seedDir, 'commit', '-q', '-m', 'seed');
  git(seedDir, 'branch', '-M', 'gh-pages');
  git(seedDir, 'remote', 'add', 'origin', bareDir);
  git(seedDir, 'push', '-q', 'origin', 'gh-pages');

  const cloneDir = makeTempDir('storybook-pages-clone-');
  git(cloneDir, 'clone', '-q', bareDir, '.');
  git(cloneDir, 'config', 'user.email', 'clone@example.com');
  git(cloneDir, 'config', 'user.name', 'clone');
  git(cloneDir, 'checkout', '-q', 'gh-pages');
  return cloneDir;
}

function makeBundle({ isForkOverride, headSha = SHA_A, target, baseRef = 'main' } = {}) {
  const bundleDir = makeTempDir('storybook-preview-bundle-');
  const metadata = buildPreviewMetadata({
    repository: 'octo/widgets',
    runId: 55,
    runAttempt: 1,
    prNumber: 42,
    baseRef,
    headRepository: isForkOverride ? 'fork/widgets' : 'octo/widgets',
    headSha,
    artifactName: 'storybook-preview-pr-42-run-55',
    contentDigest: '0'.repeat(64),
    previewRoot: 'pr-preview'
  });
  if (target !== undefined) metadata.target = target;
  const contentDir = path.join(bundleDir, 'storybook');
  fs.mkdirSync(contentDir, { recursive: true });
  fs.writeFileSync(path.join(contentDir, 'index.html'), '<html>preview</html>');
  metadata.contentDigest = digestDirectory(contentDir);
  fs.writeFileSync(path.join(bundleDir, 'preview-metadata.json'), JSON.stringify(metadata, null, 2));
  return { bundleDir, metadata };
}

function trustedContextFor(metadata) {
  return {
    repository: metadata.repository,
    runId: metadata.runId,
    prNumber: metadata.prNumber,
    headSha: metadata.headSha,
    headRepository: metadata.headRepository,
    baseRef: metadata.baseRef,
    artifactName: metadata.artifactName
  };
}

test('readBundleMetadata throws a clear error when the metadata file is missing', () => {
  const bundleDir = makeTempDir('storybook-preview-empty-');
  assert.throws(() => readBundleMetadata(bundleDir), /missing preview-metadata\.json/);
});

test('resolveBaseMetricsPath resolves the correct Pages directory for the PR base ref', () => {
  const pagesRepo = '/tmp/storybook-pages';

  assert.equal(
    resolveBaseMetricsPath({ pagesRepo, baseRef: 'main', defaultBranch: 'main' }),
    path.join(pagesRepo, 'badges', 'overview.json')
  );
  assert.equal(
    resolveBaseMetricsPath({ pagesRepo, baseRef: 'preprod', defaultBranch: 'main' }),
    path.join(pagesRepo, 'preprod', 'badges', 'overview.json')
  );
  assert.equal(
    resolveBaseMetricsPath({ pagesRepo, baseRef: 'preprod', targetDirectory: 'staging', defaultBranch: 'main' }),
    path.join(pagesRepo, 'staging', 'badges', 'overview.json')
  );
});

test('publishPreview skips fork pull requests without touching the Pages branch', async () => {
  const { bundleDir, metadata } = makeBundle({ isForkOverride: true });
  const pagesRepo = initBarePagesRepo();
  const beforeHead = git(pagesRepo, 'rev-parse', 'HEAD');

  const result = await publishPreview({
    bundleDir,
    pagesRepo,
    trustedContext: trustedContextFor(metadata),
    currentHeadSha: SHA_A
  });

  assert.equal(result.action, 'skip-fork');
  assert.equal(git(pagesRepo, 'rev-parse', 'HEAD'), beforeHead, 'fork skip must not create any commit');
});

test('publishPreview skips a stale run when the live PR head has moved on', async () => {
  const { bundleDir, metadata } = makeBundle({ headSha: SHA_A });
  const pagesRepo = initBarePagesRepo();
  const beforeHead = git(pagesRepo, 'rev-parse', 'HEAD');

  const result = await publishPreview({
    bundleDir,
    pagesRepo,
    trustedContext: trustedContextFor(metadata),
    currentHeadSha: SHA_B
  });

  assert.equal(result.action, 'skip-stale');
  assert.equal(git(pagesRepo, 'rev-parse', 'HEAD'), beforeHead, 'stale skip must not create any commit');
});

test('publishPreview rejects a provenance mismatch or malicious metadata target', async () => {
  const { bundleDir, metadata } = makeBundle();
  const pagesRepo = initBarePagesRepo();

  await assert.rejects(
    publishPreview({
      bundleDir,
      pagesRepo,
      trustedContext: { ...trustedContextFor(metadata), repository: 'someone-else/widgets' },
      currentHeadSha: SHA_A
    }),
    /does not match trusted workflow_run context/
  );

  // Test malicious metadata target attempting root/production overwrite
  const malicious = makeBundle({ target: 'production-root-overwrite' });
  await assert.rejects(
    publishPreview({
      bundleDir: malicious.bundleDir,
      pagesRepo,
      trustedContext: { ...trustedContextFor(malicious.metadata), previewRoot: 'pr-preview' },
      currentHeadSha: SHA_A
    }),
    /does not match trusted workflow_run context for field\(s\): target/
  );
});

test('publishPreview publishes a same-repo, current-head preview and posts an idempotent comment', async () => {
  const { bundleDir, metadata } = makeBundle();
  const pagesRepo = initBarePagesRepo();

  const originalFetch = global.fetch;
  const requests = [];
  global.fetch = async (url, options) => {
    requests.push({ url, options });
    if (url.includes('/comments') && (!options || options.method === undefined || options.method === 'GET')) {
      return { ok: true, status: 200, json: async () => [] };
    }
    if (url.includes('/comments') && options.method === 'POST') {
      return { ok: true, status: 201, json: async () => ({ id: 1 }) };
    }
    if (url.includes('/pages/builds')) {
      return { ok: true, status: 201, json: async () => ({}) };
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  try {
    const result = await publishPreview({
      bundleDir,
      pagesRepo,
      trustedContext: trustedContextFor(metadata),
      currentHeadSha: SHA_A,
      token: 'tok',
      repository: 'octo/widgets',
      siteUrl: 'https://octo.github.io/widgets'
    });

    assert.equal(result.action, 'published');
    assert.equal(result.commentError, null);
    assert.equal(result.commentResult.action, 'created');
    assert.ok(fs.existsSync(path.join(pagesRepo, 'pr-preview', 'pr-42', 'index.html')));

    const commentPost = requests.find(r => r.options && r.options.method === 'POST' && r.url.includes('/comments'));
    assert.ok(commentPost.options.body.includes(buildMarker(42)), 'comment body must include the stable bot marker');
  } finally {
    global.fetch = originalFetch;
  }
});

test("publishPreview merges trusted base Pages history with the artifact's own current-PR snapshot instead of recomputing it", async () => {
  const { bundleDir, metadata } = makeBundle({ baseRef: 'preprod' });
  const contentDir = path.join(bundleDir, 'storybook');
  // The built static output only reflects 2 stories/2 components here - if
  // the trusted publisher ever recomputed metrics from this directory (as it
  // wrongly did before this fix), it would misreport totals relative to what
  // the untrusted build actually measured against the real PR source tree.
  fs.writeFileSync(
    path.join(contentDir, 'index.json'),
    JSON.stringify({
      entries: {
        'button--primary': { id: 'button--primary', title: 'Components/Button', type: 'story' },
        'card--default': { id: 'card--default', title: 'Components/Card', type: 'story' }
      }
    })
  );
  fs.mkdirSync(path.join(contentDir, 'stats'), { recursive: true });
  // This is the artifact's own one-point snapshot the untrusted build wrote
  // from the real PR source tree (see preview-build/action.yml): 6 covered
  // components out of 7 total (86%), 26 stories, 6 docs.
  fs.writeFileSync(
    path.join(contentDir, 'stats', 'history.json'),
    JSON.stringify([
      {
        date: '2026-09-20',
        commit: SHA_A.slice(0, 7),
        version: 'v9.0.0',
        components: 6,
        totalComponents: 7,
        coveragePercent: 86,
        stories: 26,
        docs: 6
      }
    ])
  );
  fs.writeFileSync(path.join(contentDir, 'stats', 'history.svg'), '<svg>artifact-only</svg>');
  metadata.contentDigest = digestDirectory(contentDir);
  fs.writeFileSync(path.join(bundleDir, 'preview-metadata.json'), JSON.stringify(metadata, null, 2));

  const pagesRepo = initBarePagesRepo();
  fs.mkdirSync(path.join(pagesRepo, 'stats'), { recursive: true });
  fs.writeFileSync(
    path.join(pagesRepo, 'stats', 'history.json'),
    JSON.stringify([{ date: '2026-09-01', commit: 'rootwrong', stories: 99, components: 99 }])
  );
  fs.mkdirSync(path.join(pagesRepo, 'preprod', 'stats'), { recursive: true });
  fs.writeFileSync(
    path.join(pagesRepo, 'preprod', 'stats', 'history.json'),
    JSON.stringify([
      { date: '2026-09-01', commit: '1111111', stories: 10, components: 3, totalComponents: 6, coveragePercent: 50 },
      { date: '2026-09-10', commit: '2222222', stories: 18, components: 4, totalComponents: 6, coveragePercent: 67 }
    ])
  );

  const result = await publishPreview({
    bundleDir,
    pagesRepo,
    trustedContext: trustedContextFor(metadata),
    currentHeadSha: SHA_A,
    siteUrl: 'https://octo.github.io/widgets'
  });

  assert.equal(result.action, 'published');
  assert.equal(result.baseDirectory, 'preprod');

  const publishedHistory = JSON.parse(
    fs.readFileSync(path.join(pagesRepo, 'pr-preview', 'pr-42', 'stats', 'history.json'), 'utf8')
  );
  assert.deepEqual(
    publishedHistory.map(entry => entry.commit),
    ['1111111', '2222222', SHA_A.slice(0, 7)]
  );
  assert.notEqual(publishedHistory[0].commit, 'rootwrong');

  const latest = publishedHistory[publishedHistory.length - 1];
  // Must match the artifact's exact snapshot (6/7, 86%), not a recompute
  // from the built output's index.json (which would have yielded 2/2, 100%).
  assert.equal(latest.components, 6);
  assert.equal(latest.totalComponents, 7);
  assert.equal(latest.coveragePercent, 86);
  assert.equal(latest.stories, 26);
  assert.equal(latest.docs, 6);
  assert.ok(fs.existsSync(path.join(pagesRepo, 'pr-preview', 'pr-42', 'stats', 'history.svg')));
});

test('publishPreview uses the artifact current-PR snapshot verbatim even when its stamped commit differs from the trusted head SHA', async () => {
  // Regression for a hypothesis raised while diagnosing the live v1.9.3
  // regression: selection of the artifact's current-PR snapshot must not
  // depend on its `commit` field matching the trusted head SHA in any way -
  // it is read positionally (the artifact's own last history entry) and
  // used as-is. Stamp the snapshot with a commit that is unrelated to both
  // `currentHeadSha` and `metadata.headSha` (SHA_A) to prove this.
  const { bundleDir, metadata } = makeBundle({ baseRef: 'main' });
  const contentDir = path.join(bundleDir, 'storybook');
  fs.mkdirSync(path.join(contentDir, 'stats'), { recursive: true });
  fs.writeFileSync(
    path.join(contentDir, 'stats', 'history.json'),
    JSON.stringify([
      {
        date: '2026-09-22',
        commit: 'deadbee', // deliberately unrelated to SHA_A / metadata.headSha
        version: 'v10.6.0',
        components: 6,
        totalComponents: 7,
        coveragePercent: 86,
        stories: 26,
        docs: 6
      }
    ])
  );
  fs.writeFileSync(path.join(contentDir, 'stats', 'history.svg'), '<svg>artifact-only</svg>');
  metadata.contentDigest = digestDirectory(contentDir);
  fs.writeFileSync(path.join(bundleDir, 'preview-metadata.json'), JSON.stringify(metadata, null, 2));

  const pagesRepo = initBarePagesRepo();
  fs.mkdirSync(path.join(pagesRepo, 'stats'), { recursive: true });
  fs.writeFileSync(
    path.join(pagesRepo, 'stats', 'history.json'),
    JSON.stringify([
      { date: '2026-09-10', commit: '3333333', stories: 20, components: 3, totalComponents: 6, coveragePercent: 50 },
      { date: '2026-09-18', commit: '4444444', stories: 24, components: 4, totalComponents: 6, coveragePercent: 67 }
    ])
  );

  const result = await publishPreview({
    bundleDir,
    pagesRepo,
    trustedContext: trustedContextFor(metadata),
    currentHeadSha: SHA_A,
    siteUrl: 'https://octo.github.io/widgets'
  });

  assert.equal(result.action, 'published');

  const publishedHistory = JSON.parse(
    fs.readFileSync(path.join(pagesRepo, 'pr-preview', 'pr-42', 'stats', 'history.json'), 'utf8')
  );
  const latest = publishedHistory[publishedHistory.length - 1];
  assert.equal(latest.commit, 'deadbee', 'the artifact snapshot commit must be preserved verbatim, unmodified');
  assert.equal(latest.components, 6);
  assert.equal(latest.totalComponents, 7);
  assert.equal(latest.coveragePercent, 86);
  assert.equal(latest.stories, 26);
  assert.equal(latest.docs, 6);
  assert.deepEqual(
    publishedHistory.map(entry => entry.commit),
    ['3333333', '4444444', 'deadbee']
  );
});

test('publishPreview skips stats regeneration when the artifact has no current-PR snapshot, rather than fabricating one', async () => {
  const { bundleDir, metadata } = makeBundle({ baseRef: 'main' });
  const contentDir = path.join(bundleDir, 'storybook');
  fs.writeFileSync(path.join(contentDir, 'index.json'), JSON.stringify({ entries: {} }));
  metadata.contentDigest = digestDirectory(contentDir);
  fs.writeFileSync(path.join(bundleDir, 'preview-metadata.json'), JSON.stringify(metadata, null, 2));

  const pagesRepo = initBarePagesRepo();
  fs.mkdirSync(path.join(pagesRepo, 'stats'), { recursive: true });
  fs.writeFileSync(
    path.join(pagesRepo, 'stats', 'history.json'),
    JSON.stringify([{ date: '2026-09-01', commit: '1111111', stories: 5, components: 2 }])
  );

  const result = await publishPreview({
    bundleDir,
    pagesRepo,
    trustedContext: trustedContextFor(metadata),
    currentHeadSha: SHA_A,
    siteUrl: 'https://octo.github.io/widgets'
  });

  assert.equal(result.action, 'published');
  assert.ok(
    !fs.existsSync(path.join(pagesRepo, 'pr-preview', 'pr-42', 'stats', 'history.json')),
    'stats must not be regenerated when there is no trusted current-PR snapshot to merge'
  );
});

test('publishPreview includes badges, coverage diff, and stats graph in PR comment when generated', async () => {
  const { bundleDir, metadata } = makeBundle();
  const contentDir = path.join(bundleDir, 'storybook');
  fs.mkdirSync(path.join(contentDir, 'badges'), { recursive: true });
  fs.mkdirSync(path.join(contentDir, 'stats'), { recursive: true });
  fs.writeFileSync(path.join(contentDir, 'badges', 'coverage.svg'), '<svg>coverage</svg>');
  fs.writeFileSync(
    path.join(contentDir, 'badges', 'overview.json'),
    JSON.stringify({ storiesCount: 30, componentsCount: 8, totalComponents: 8, coveragePercent: 100 })
  );
  fs.writeFileSync(path.join(contentDir, 'stats', 'history.svg'), '<svg>graph</svg>');

  // Update content digest after adding files
  metadata.contentDigest = digestDirectory(contentDir);
  fs.writeFileSync(path.join(bundleDir, 'preview-metadata.json'), JSON.stringify(metadata, null, 2));

  const pagesRepo = initBarePagesRepo();
  fs.mkdirSync(path.join(pagesRepo, 'badges'), { recursive: true });
  fs.writeFileSync(
    path.join(pagesRepo, 'badges', 'overview.json'),
    JSON.stringify({ storiesCount: 20, componentsCount: 5, totalComponents: 8, coveragePercent: 63 })
  );

  const originalFetch = global.fetch;
  const requests = [];
  global.fetch = async (url, options) => {
    requests.push({ url, options });
    if (url.includes('/comments') && (!options || options.method === undefined || options.method === 'GET')) {
      return { ok: true, status: 200, json: async () => [] };
    }
    if (url.includes('/comments') && options.method === 'POST') {
      return { ok: true, status: 201, json: async () => ({ id: 1 }) };
    }
    if (url.includes('/pages/builds')) {
      return { ok: true, status: 201, json: async () => ({}) };
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  try {
    const result = await publishPreview({
      bundleDir,
      pagesRepo,
      trustedContext: trustedContextFor(metadata),
      currentHeadSha: SHA_A,
      token: 'tok',
      repository: 'octo/widgets',
      siteUrl: 'https://octo.github.io/widgets'
    });

    assert.equal(result.action, 'published');
    const commentPost = requests.find(r => r.options && r.options.method === 'POST' && r.url.includes('/comments'));
    const commentBody = commentPost.options.body;
    assert.ok(commentBody.includes('badges/coverage.svg'));
    assert.ok(commentBody.includes('| 🎯 **Component Coverage** | `63% (5/8)` | `100% (8/8)` | **+37%** 🟢 |'));
    assert.ok(commentBody.includes('| 📚 **Stories** | 20 | 30 | +10 📈 |'));
    assert.ok(commentBody.includes('stats/history.svg'));
  } finally {
    global.fetch = originalFetch;
  }
});

test('publishPreview surfaces a comment failure independently without treating the publish as failed', async () => {
  const { bundleDir, metadata } = makeBundle();
  const pagesRepo = initBarePagesRepo();

  const originalFetch = global.fetch;
  global.fetch = async url => {
    if (url.includes('/comments')) {
      return { ok: false, status: 403, text: async () => 'forbidden' };
    }
    if (url.includes('/pages/builds')) {
      return { ok: true, status: 201, json: async () => ({}) };
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  try {
    const result = await publishPreview({
      bundleDir,
      pagesRepo,
      trustedContext: trustedContextFor(metadata),
      currentHeadSha: SHA_A,
      token: 'tok',
      repository: 'octo/widgets',
      siteUrl: 'https://octo.github.io/widgets'
    });

    assert.equal(result.action, 'published', 'publish must succeed even though the comment step failed');
    assert.ok(fs.existsSync(path.join(pagesRepo, 'pr-preview', 'pr-42', 'index.html')));
    assert.match(result.commentError, /403/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('publishPreview fails loudly when create_deployment is enabled but no token/repository is available', async () => {
  const { bundleDir, metadata } = makeBundle();
  const pagesRepo = initBarePagesRepo();

  const originalCreateDeployment = process.env.CREATE_DEPLOYMENT;
  process.env.CREATE_DEPLOYMENT = 'true';

  try {
    await assert.rejects(
      publishPreview({
        bundleDir,
        pagesRepo,
        trustedContext: trustedContextFor(metadata),
        currentHeadSha: SHA_A,
        // No token/repository provided: this must be a loud failure, not a
        // silent skip of deployment creation followed by a successful publish.
        siteUrl: 'https://octo.github.io/widgets'
      }),
      /create_deployment is enabled but no GitHub token\/repository context was provided/
    );
    assert.ok(
      !fs.existsSync(path.join(pagesRepo, 'pr-preview', 'pr-42', 'index.html')),
      'preview must not be published when the required deployment cannot be created'
    );
  } finally {
    if (originalCreateDeployment === undefined) delete process.env.CREATE_DEPLOYMENT;
    else process.env.CREATE_DEPLOYMENT = originalCreateDeployment;
  }
});

test('publishPreview creates a pending deployment and marks it successful with the preview URL and run log URL', async () => {
  const { bundleDir, metadata } = makeBundle();
  const pagesRepo = initBarePagesRepo();

  const originalCreateDeployment = process.env.CREATE_DEPLOYMENT;
  process.env.CREATE_DEPLOYMENT = 'true';

  const originalFetch = global.fetch;
  const requests = [];
  global.fetch = async (url, options = {}) => {
    requests.push({ url, method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : undefined });
    if (url.includes('/comments') && (!options.method || options.method === 'GET')) {
      return { ok: true, status: 200, json: async () => [] };
    }
    if (url.includes('/comments') && options.method === 'POST') {
      return { ok: true, status: 201, json: async () => ({ id: 1 }) };
    }
    if (url.includes('/pages/builds')) {
      return { ok: true, status: 201, json: async () => ({}) };
    }
    if (url === 'https://api.github.com/repos/octo/widgets/deployments' && options.method === 'POST') {
      return { ok: true, status: 201, text: async () => JSON.stringify({ id: 501 }) };
    }
    if (url === 'https://api.github.com/repos/octo/widgets/deployments/501/statuses' && options.method === 'POST') {
      return { ok: true, status: 201, text: async () => JSON.stringify({ id: 5010 }) };
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  try {
    const result = await publishPreview({
      bundleDir,
      pagesRepo,
      trustedContext: trustedContextFor(metadata),
      currentHeadSha: SHA_A,
      token: 'tok',
      repository: 'octo/widgets',
      siteUrl: 'https://octo.github.io/widgets'
    });

    assert.equal(result.action, 'published');
    assert.equal(result.deploymentRecord.id, 501);

    const createCall = requests.find(r => r.url === 'https://api.github.com/repos/octo/widgets/deployments');
    assert.equal(createCall.body.environment, 'pr-preview-42', 'defaults to a per-PR environment, not a shared one');

    const statusCalls = requests.filter(
      r => r.url === 'https://api.github.com/repos/octo/widgets/deployments/501/statuses'
    );
    const successCall = statusCalls.find(r => r.body.state === 'success');
    assert.ok(successCall, 'expected a success status update after publishing');
    assert.equal(successCall.body.environment_url, 'https://octo.github.io/widgets/pr-preview/pr-42');
    assert.match(successCall.body.log_url, /\/actions\/runs\/55$/);
  } finally {
    if (originalCreateDeployment === undefined) delete process.env.CREATE_DEPLOYMENT;
    else process.env.CREATE_DEPLOYMENT = originalCreateDeployment;
    global.fetch = originalFetch;
  }
});

test('publishPreview honors an explicit ENVIRONMENT_URL override for both pending and success deployment statuses', async () => {
  const { bundleDir, metadata } = makeBundle();
  const pagesRepo = initBarePagesRepo();

  const originalCreateDeployment = process.env.CREATE_DEPLOYMENT;
  const originalEnvironmentUrl = process.env.ENVIRONMENT_URL;
  process.env.CREATE_DEPLOYMENT = 'true';
  process.env.ENVIRONMENT_URL = 'https://custom.example.com/preview';

  const originalFetch = global.fetch;
  const requests = [];
  global.fetch = async (url, options = {}) => {
    requests.push({ url, method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : undefined });
    if (url.includes('/comments') && (!options.method || options.method === 'GET')) {
      return { ok: true, status: 200, json: async () => [] };
    }
    if (url.includes('/comments') && options.method === 'POST') {
      return { ok: true, status: 201, json: async () => ({ id: 1 }) };
    }
    if (url.includes('/pages/builds')) {
      return { ok: true, status: 201, json: async () => ({}) };
    }
    if (url === 'https://api.github.com/repos/octo/widgets/deployments' && options.method === 'POST') {
      return { ok: true, status: 201, text: async () => JSON.stringify({ id: 501 }) };
    }
    if (url === 'https://api.github.com/repos/octo/widgets/deployments/501/statuses' && options.method === 'POST') {
      return { ok: true, status: 201, text: async () => JSON.stringify({ id: 5010 }) };
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  try {
    const result = await publishPreview({
      bundleDir,
      pagesRepo,
      trustedContext: trustedContextFor(metadata),
      currentHeadSha: SHA_A,
      token: 'tok',
      repository: 'octo/widgets',
      siteUrl: 'https://octo.github.io/widgets'
    });

    assert.equal(result.action, 'published');

    const statusCalls = requests.filter(
      r => r.url === 'https://api.github.com/repos/octo/widgets/deployments/501/statuses'
    );
    const pendingCall = statusCalls.find(r => r.body.state === 'pending');
    assert.ok(pendingCall, 'expected a pending status update when creating the deployment');
    assert.equal(
      pendingCall.body.environment_url,
      'https://custom.example.com/preview',
      'the pending deployment status must use the explicit environment_url override'
    );

    const successCall = statusCalls.find(r => r.body.state === 'success');
    assert.ok(successCall, 'expected a success status update after publishing');
    assert.equal(
      successCall.body.environment_url,
      'https://custom.example.com/preview',
      'the success status must use the explicit environment_url override rather than the computed preview URL'
    );
  } finally {
    if (originalCreateDeployment === undefined) delete process.env.CREATE_DEPLOYMENT;
    else process.env.CREATE_DEPLOYMENT = originalCreateDeployment;
    if (originalEnvironmentUrl === undefined) delete process.env.ENVIRONMENT_URL;
    else process.env.ENVIRONMENT_URL = originalEnvironmentUrl;
    global.fetch = originalFetch;
  }
});
