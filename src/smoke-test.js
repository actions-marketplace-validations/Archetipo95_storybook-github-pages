import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
};
const REQUIRED_RESOURCE_TYPES = new Set(['document', 'script', 'stylesheet', 'xhr', 'fetch']);
const requireFromRunner = createRequire(import.meta.url);

export function storyMatches(storyId, pattern) {
  const escaped = String(pattern)
    .split('*')
    .map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${escaped}$`).test(storyId);
}

function storyIdsFromMetadata(staticDir) {
  for (const fileName of ['stories.json', 'index.json']) {
    const filePath = path.join(staticDir, fileName);
    if (!fs.existsSync(filePath)) continue;
    const metadata = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return Object.keys(metadata.stories || metadata.entries || {});
  }
  return [];
}

function resolveStaticDirectory(staticPath, workspaceRoot) {
  const root = fs.realpathSync(path.resolve(workspaceRoot));
  const target = path.resolve(root, staticPath);
  const relative = path.relative(root, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Smoke test failed: path "${staticPath}" escapes the workspace root.`);
  }
  if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) {
    throw new Error(`Smoke test failed: static directory "${staticPath}" does not exist.`);
  }
  const realTarget = fs.realpathSync(target);
  const realRelative = path.relative(root, realTarget);
  if (realRelative.startsWith('..') || path.isAbsolute(realRelative)) {
    throw new Error(`Smoke test failed: static directory "${staticPath}" resolves outside the workspace.`);
  }
  return realTarget;
}

function createStaticServer(staticDir) {
  const server = http.createServer((request, response) => {
    let requestPath;
    try {
      requestPath = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
    } catch {
      response.writeHead(400).end('Invalid request path');
      return;
    }

    const relativePath = requestPath === '/' ? 'index.html' : requestPath.replace(/^\/+/, '');
    const filePath = path.resolve(staticDir, relativePath);
    const relative = path.relative(staticDir, filePath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      response.writeHead(403).end('Forbidden');
      return;
    }

    fs.stat(filePath, (error, stat) => {
      if (error || !stat.isFile()) {
        response.writeHead(404).end('Not found');
        return;
      }
      response.writeHead(200, {
        'Content-Type': MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-store'
      });
      fs.createReadStream(filePath).pipe(response);
    });
  });
  return server;
}

// playwright ships a dual CJS/ESM build ("require" -> index.js, "import" ->
// index.mjs). Resolving or constructing a path to the package always lands on
// the CJS entry, but importing that file directly via its file:// URL bypasses
// package.json "exports" conditions and loses the top-level `chromium` export.
// Prefer the sibling ESM entry so the real package API is loaded either way.
export function toEsmEntryIfAvailable(resolvedPath) {
  const esmPath = resolvedPath.replace(/\.js$/, '.mjs');
  return fs.existsSync(esmPath) ? esmPath : resolvedPath;
}

async function loadPlaywright(workspaceRoot) {
  try {
    const installedPath = requireFromRunner.resolve('playwright', { paths: [workspaceRoot] });
    return { library: await import(pathToFileURL(toEsmEntryIfAvailable(installedPath)).href), cleanup: () => {} };
  } catch (error) {
    const installDir = fs.mkdtempSync(path.join(os.tmpdir(), 'storybook-playwright-'));
    try {
      execFileSync('npm', ['install', '--prefix', installDir, '--no-save', '--no-package-lock', 'playwright'], {
        stdio: 'inherit'
      });
      const playwrightPath = toEsmEntryIfAvailable(path.join(installDir, 'node_modules', 'playwright', 'index.js'));
      execFileSync(path.join(installDir, 'node_modules', '.bin', 'playwright'), ['install', 'chromium'], {
        stdio: 'inherit'
      });
      return {
        library: await import(pathToFileURL(playwrightPath).href),
        cleanup: () => fs.rmSync(installDir, { recursive: true, force: true })
      };
    } catch (installError) {
      fs.rmSync(installDir, { recursive: true, force: true });
      throw new Error(
        `Smoke test could not load Playwright. Install "playwright" in the consuming repository or allow npm to bootstrap it automatically. ${installError.message}`,
        { cause: error }
      );
    }
  }
}

async function checkPage(browser, url, timeout, { requireSidebar = false } = {}) {
  const page = await browser.newPage();
  const failures = [];
  page.on('console', message => {
    if (message.type() === 'error') failures.push(`console error: ${message.text()}`);
  });
  page.on('pageerror', error => failures.push(`page error: ${error.message}`));
  page.on('requestfailed', request =>
    failures.push(`request failed: ${request.url()} (${request.failure()?.errorText || 'unknown'})`)
  );
  page.on('response', response => {
    const resourceType = response.request?.().resourceType?.();
    if (response.status() >= 400 && REQUIRED_RESOURCE_TYPES.has(resourceType)) {
      failures.push(`HTTP ${response.status()}: ${response.url()}`);
    }
  });

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
    await page.waitForLoadState('networkidle', { timeout });
    if (requireSidebar) {
      const sidebar = page.locator('#storybook-explorer-tree, [data-testid="storybook-explorer-tree"], [role="tree"]');
      if ((await sidebar.count()) === 0) {
        throw new Error('Storybook manager loaded without a story sidebar.');
      }
    }
    if (failures.length > 0) throw new Error(failures.join('\n'));
  } finally {
    await page.close();
  }
}

export async function runSmokeTest({
  staticPath,
  workspaceRoot = process.cwd(),
  stories = 'all',
  timeoutMs = 30000,
  playwright = null,
  serverFactory = createStaticServer
} = {}) {
  const staticDir = resolveStaticDirectory(staticPath, workspaceRoot);
  const playwrightRuntime = playwright
    ? { library: playwright, cleanup: () => {} }
    : await loadPlaywright(workspaceRoot);
  const browserLibrary = playwrightRuntime.library;
  const server = serverFactory(staticDir);

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  try {
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;
    let browser;
    try {
      browser = await browserLibrary.chromium.launch({ headless: true });
    } catch (launchError) {
      try {
        execFileSync('npx', ['playwright', 'install', 'chromium'], { stdio: 'inherit' });
        browser = await browserLibrary.chromium.launch({ headless: true });
      } catch (retryError) {
        throw new Error(`Smoke test could not launch Chromium. ${retryError.message}`, { cause: launchError });
      }
    }
    try {
      await checkPage(browser, `${baseUrl}/index.html`, timeoutMs, { requireSidebar: true });
      await checkPage(browser, `${baseUrl}/iframe.html`, timeoutMs);

      if (stories !== 'all') {
        const patterns = String(stories)
          .split(',')
          .map(value => value.trim())
          .filter(Boolean);
        const selectedStories = storyIdsFromMetadata(staticDir).filter(storyId =>
          patterns.some(pattern => storyMatches(storyId, pattern))
        );
        if (selectedStories.length === 0) {
          throw new Error(`Smoke test found no stories matching "${stories}".`);
        }
        for (const storyId of selectedStories) {
          await checkPage(browser, `${baseUrl}/iframe.html?id=${encodeURIComponent(storyId)}`, timeoutMs);
        }
      }
    } finally {
      await browser.close();
    }
  } finally {
    await new Promise(resolve => server.close(resolve));
    playwrightRuntime.cleanup();
  }
}

if (process.argv[1] && process.argv[1].endsWith('smoke-test.js')) {
  const [staticPath = 'storybook-static', workspaceRoot = process.cwd(), stories = 'all', timeout = '30000'] =
    process.argv.slice(2);
  runSmokeTest({ staticPath, workspaceRoot, stories, timeoutMs: Number(timeout) })
    .then(() => console.log('✅ Storybook smoke test passed.'))
    .catch(error => {
      console.error(`❌ ${error.message}`);
      process.exitCode = 1;
    });
}
