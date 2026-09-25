import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runSmokeTest, storyMatches, toEsmEntryIfAvailable } from '../src/smoke-test.js';

test('storyMatches supports exact ids and wildcard patterns', () => {
  assert.equal(storyMatches('button--primary', 'button--primary'), true);
  assert.equal(storyMatches('button--primary', 'button--*'), true);
  assert.equal(storyMatches('input--primary', 'button--*'), false);
});

test('toEsmEntryIfAvailable prefers a sibling .mjs entry so package.json "exports" conditions are not bypassed', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'esm-entry-'));
  try {
    const cjsPath = path.join(dir, 'index.js');
    fs.writeFileSync(cjsPath, 'module.exports = {};');

    // No sibling .mjs: falls back to the resolved (CJS) path.
    assert.equal(toEsmEntryIfAvailable(cjsPath), cjsPath);

    // Sibling .mjs present (as in playwright's dual CJS/ESM package): prefer it,
    // since importing the CJS entry's file:// URL directly bypasses "exports"
    // conditions and loses top-level named exports like `chromium`.
    const esmPath = path.join(dir, 'index.mjs');
    fs.writeFileSync(esmPath, 'export const chromium = {};');
    assert.equal(toEsmEntryIfAvailable(cjsPath), esmPath);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('runSmokeTest checks manager and iframe pages on loopback', async () => {
  const urls = [];
  const handlers = new Map();
  const page = {
    on(event, handler) {
      handlers.set(event, handler);
    },
    async goto(url) {
      urls.push(url);
    },
    async waitForLoadState() {},
    locator() {
      return { count: async () => 1 };
    },
    async close() {}
  };
  const browser = {
    async newPage() {
      return page;
    },
    async close() {}
  };

  await runSmokeTest({
    staticPath: 'test/fixtures/sample-storybook',
    workspaceRoot: process.cwd(),
    playwright: { chromium: { launch: async () => browser } },
    timeoutMs: 1000
  });

  assert.equal(urls.length, 2);
  assert.match(urls[0], /\/index\.html$/);
  assert.match(urls[1], /\/iframe\.html$/);
});

test('runSmokeTest opens only stories matching the requested metadata globs', async () => {
  const urls = [];
  const page = {
    on() {},
    async goto(url) {
      urls.push(url);
    },
    async waitForLoadState() {},
    locator() {
      return { count: async () => 1 };
    },
    async close() {}
  };
  const browser = {
    async newPage() {
      return page;
    },
    async close() {}
  };

  await runSmokeTest({
    staticPath: 'test/fixtures/sample-storybook',
    workspaceRoot: process.cwd(),
    stories: 'example-button--*',
    playwright: { chromium: { launch: async () => browser } },
    timeoutMs: 1000
  });

  assert.equal(urls.length, 3);
  assert.match(urls[2], /\/iframe\.html\?id=example-button--primary$/);
});

test('runSmokeTest fails clearly when requested stories do not exist in metadata', async () => {
  const page = {
    on() {},
    async goto() {},
    async waitForLoadState() {},
    locator() {
      return { count: async () => 1 };
    },
    async close() {}
  };
  const browser = {
    async newPage() {
      return page;
    },
    async close() {}
  };

  await assert.rejects(
    runSmokeTest({
      staticPath: 'test/fixtures/sample-storybook',
      workspaceRoot: process.cwd(),
      stories: 'missing-*',
      playwright: { chromium: { launch: async () => browser } },
      timeoutMs: 1000
    }),
    /found no stories matching "missing-\*"/
  );
});

test('runSmokeTest ignores missing optional assets but fails missing runtime resources', async () => {
  const response = (resourceType, status) => ({
    status: () => status,
    url: () => `http://127.0.0.1/${resourceType}`,
    request: () => ({ resourceType: () => resourceType })
  });
  const runWithResponse = resourceType => {
    const handlers = new Map();
    const page = {
      on(event, handler) {
        handlers.set(event, handler);
      },
      async goto() {
        handlers.get('response')(response(resourceType, 404));
      },
      async waitForLoadState() {},
      locator() {
        return { count: async () => 1 };
      },
      async close() {}
    };
    const browser = {
      async newPage() {
        return page;
      },
      async close() {}
    };
    return runSmokeTest({
      staticPath: 'test/fixtures/sample-storybook',
      workspaceRoot: process.cwd(),
      playwright: { chromium: { launch: async () => browser } },
      timeoutMs: 1000
    });
  };

  await runWithResponse('image');
  await assert.rejects(runWithResponse('script'), /HTTP 404/);
});

test('runSmokeTest rejects a static path outside the workspace', async () => {
  await assert.rejects(
    runSmokeTest({
      staticPath: path.join('test', 'fixtures', 'sample-storybook', '..', '..', '..', '..'),
      playwright: { chromium: { launch: async () => ({}) } }
    }),
    /escapes the workspace root/
  );
});

test('sample-storybook fixture includes a story sidebar element so the manager/sidebar smoke-test assertion has something to find', () => {
  const indexPath = path.join(process.cwd(), 'test', 'fixtures', 'sample-storybook', 'index.html');
  const content = fs.readFileSync(indexPath, 'utf8');
  assert.match(
    content,
    /id="storybook-explorer-tree"|data-testid="storybook-explorer-tree"|role="tree"/,
    "fixture index.html must expose a sidebar element matching the smoke test's manager locator"
  );
});
