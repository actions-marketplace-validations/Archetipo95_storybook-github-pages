import fs from 'node:fs';
import path from 'node:path';

/**
 * Estimates text width in pixels for standard Verdana 11px font rendering.
 */
export function estimateTextWidth(text) {
  if (!text) return 0;
  const str = String(text);
  let width = 0;
  for (const char of str) {
    if ("ilI1.,:;!|'".includes(char)) {
      width += 4.5;
    } else if ('mwMW@%#_'.includes(char)) {
      width += 10.5;
    } else if ('abcdeghknopqrstuvxyz023456789$-+/=?'.includes(char)) {
      width += 7.2;
    } else if ('ABCDEFGHJKLMNOPQRSTUVXYZ&'.includes(char)) {
      width += 8.2;
    } else {
      width += 6.5;
    }
  }
  return Math.round(width);
}

/**
 * Escapes XML special characters.
 */
export function escapeXml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Normalizes hex or standard color names to clean CSS/SVG hex/color string.
 */
export function normalizeColor(color) {
  if (!color) return '#007ec6';
  const c = String(color).trim();
  if (/^[0-9a-fA-F]{3,8}$/.test(c)) return `#${c}`;
  return c;
}

/**
 * Generates a standard flat Shields-style SVG badge.
 */
export function renderBadgeSvg({
  label = 'badge',
  message = 'ok',
  labelColor = '#555555',
  messageColor = '#ff4785',
  labelPadding = 12,
  messagePadding = 12
} = {}) {
  const cleanLabel = escapeXml(label);
  const cleanMessage = escapeXml(message);

  const labelTextWidth = estimateTextWidth(label);
  const messageTextWidth = estimateTextWidth(message);

  const leftWidth = labelTextWidth + labelPadding * 2;
  const rightWidth = messageTextWidth + messagePadding * 2;
  const totalWidth = leftWidth + rightWidth;

  const leftTextX = Math.round((leftWidth / 2) * 10);
  const rightTextX = Math.round((leftWidth + rightWidth / 2) * 10);
  const leftTextLength = labelTextWidth * 10;
  const rightTextLength = messageTextWidth * 10;

  const bgLeft = normalizeColor(labelColor);
  const bgRight = normalizeColor(messageColor);

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="20" role="img" aria-label="${cleanLabel}: ${cleanMessage}">`,
    `  <title>${cleanLabel}: ${cleanMessage}</title>`,
    '  <linearGradient id="s" x2="0" y2="100%">',
    '    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>',
    '    <stop offset="1" stop-opacity=".1"/>',
    '  </linearGradient>',
    '  <clipPath id="r">',
    `    <rect width="${totalWidth}" height="20" rx="3" fill="#fff"/>`,
    '  </clipPath>',
    '  <g clip-path="url(#r)">',
    `    <rect width="${leftWidth}" height="20" fill="${bgLeft}"/>`,
    `    <rect x="${leftWidth}" width="${rightWidth}" height="20" fill="${bgRight}"/>`,
    `    <rect width="${totalWidth}" height="20" fill="url(#s)"/>`,
    '  </g>',
    '  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" text-rendering="geometricPrecision" font-size="110">',
    `    <text aria-hidden="true" x="${leftTextX}" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)" textLength="${leftTextLength}">${cleanLabel}</text>`,
    `    <text x="${leftTextX}" y="140" transform="scale(.1)" fill="#fff" textLength="${leftTextLength}">${cleanLabel}</text>`,
    `    <text aria-hidden="true" x="${rightTextX}" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)" textLength="${rightTextLength}">${cleanMessage}</text>`,
    `    <text x="${rightTextX}" y="140" transform="scale(.1)" fill="#fff" textLength="${rightTextLength}">${cleanMessage}</text>`,
    '  </g>',
    '</svg>'
  ].join('\n');
}

/**
 * Reads Storybook version from package.json if available.
 */
export function extractStorybookVersion(workspaceRoot = process.cwd()) {
  const candidatePkgPaths = [path.join(workspaceRoot, 'package.json'), path.join(workspaceRoot, '..', 'package.json')];

  for (const pkgPath of candidatePkgPaths) {
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        const deps = { ...pkg.devDependencies, ...pkg.dependencies };
        const sbKey = Object.keys(deps).find(k => k === 'storybook' || k.startsWith('@storybook/'));
        if (sbKey && deps[sbKey]) {
          const rawVersion = deps[sbKey].replace(/^[\^~>=<]+/, '');
          return rawVersion.startsWith('v') ? rawVersion : `v${rawVersion}`;
        }
      } catch {
        // Ignore JSON read errors
      }
    }
  }
  return 'deployed';
}

const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  '.github',
  'storybook-static',
  'dist',
  'build',
  '.next',
  '.nuxt',
  '.output',
  'coverage',
  '.playwright',
  '.playwright-mcp',
  '.cache'
]);

const COMPONENT_EXTENSIONS = new Set(['.vue', '.jsx', '.tsx', '.svelte']);

export function normalizeRepoPathFilters(value) {
  if (value === undefined || value === null || value === '') return [];
  const candidates = Array.isArray(value) ? value : String(value).split(/\r?\n|,/);
  return candidates
    .map(item => String(item).trim())
    .filter(Boolean)
    .map(item => item.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\//, ''));
}

function escapeGlobPattern(value) {
  return String(value).replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
}

function globToRegExp(pattern) {
  const normalized = String(pattern).trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\//, '');
  if (!normalized) return /^$/;

  let regex = '';
  for (let index = 0; index < normalized.length; index++) {
    const char = normalized[index];

    if (char === '*') {
      if (normalized[index + 1] === '*') {
        if (normalized[index + 2] === '/') {
          regex += '(?:.*/)?';
          index += 2;
          continue;
        }
        regex += '.*';
        index += 1;
        continue;
      }
      regex += '[^/]*';
      continue;
    }

    if (char === '?') {
      regex += '[^/]';
      continue;
    }

    regex += escapeGlobPattern(char);
  }

  return new RegExp(`^${regex}$`);
}

export function matchesRepoPathFilter(relativePath, pattern) {
  if (!relativePath || !pattern) return false;
  const normalizedPath = String(relativePath).replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\//, '');
  const normalizedPattern = String(pattern).trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\//, '');
  if (!normalizedPattern) return false;
  return globToRegExp(normalizedPattern).test(normalizedPath);
}

export function matchesAnyRepoPathFilter(relativePath, patterns) {
  const normalizedPatterns = normalizeRepoPathFilters(patterns);
  return normalizedPatterns.some(pattern => matchesRepoPathFilter(relativePath, pattern));
}

/**
 * Counts total framework component files in workspace to compare against covered components.
 */
export function countWorkspaceComponents(
  workspaceRoot = process.cwd(),
  maxDepth = 6,
  includePaths = [],
  ignorePaths = []
) {
  if (!workspaceRoot || !fs.existsSync(workspaceRoot)) return 0;
  const includePatterns = normalizeRepoPathFilters(includePaths);
  const ignorePatterns = normalizeRepoPathFilters(ignorePaths);
  let count = 0;

  function scan(dir, depth) {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.name.startsWith('.') && entry.isDirectory()) continue;
      if (IGNORED_DIRS.has(entry.name)) continue;

      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        scan(fullPath, depth + 1);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (COMPONENT_EXTENSIONS.has(ext)) {
          const lowerName = entry.name.toLowerCase();
          if (
            !lowerName.includes('.stories.') &&
            !lowerName.includes('.story.') &&
            !lowerName.includes('.test.') &&
            !lowerName.includes('.spec.') &&
            !lowerName.endsWith('.d.ts')
          ) {
            const relativePath = path.relative(workspaceRoot, fullPath).replace(/\\/g, '/');
            const matchesInclude =
              includePatterns.length === 0 || matchesAnyRepoPathFilter(relativePath, includePatterns);
            const matchesIgnore = matchesAnyRepoPathFilter(relativePath, ignorePatterns);
            if (matchesInclude && !matchesIgnore) {
              count++;
            }
          }
        }
      }
    }
  }

  scan(path.resolve(workspaceRoot), 0);
  return count;
}

/**
 * Extracts story counts and component counts from static Storybook output.
 */
export function extractStorybookMetrics(
  staticDir,
  workspaceRoot = process.cwd(),
  { includePaths = [], ignorePaths = [] } = {}
) {
  let storiesCount = 0;
  let componentsCount = 0;
  let docsCount = 0;
  let hasStoriesData = false;

  const indexJsonPath = path.join(staticDir, 'index.json');
  const storiesJsonPath = path.join(staticDir, 'stories.json');

  if (fs.existsSync(indexJsonPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(indexJsonPath, 'utf8'));
      const entries = data.entries || data.stories || {};
      const components = new Set();

      for (const entry of Object.values(entries)) {
        if (!entry) continue;
        if (entry.type === 'docs') {
          docsCount++;
        } else {
          storiesCount++;
        }
        if (entry.title) {
          components.add(entry.title);
        } else if (entry.id) {
          const parts = entry.id.split('--');
          components.add(parts[0]);
        }
      }

      componentsCount = components.size;
      hasStoriesData = true;
    } catch {
      // Fallback
    }
  } else if (fs.existsSync(storiesJsonPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(storiesJsonPath, 'utf8'));
      const stories = data.stories || {};
      const components = new Set();

      for (const story of Object.values(stories)) {
        if (!story) continue;
        storiesCount++;
        if (story.title) {
          components.add(story.title);
        } else if (story.id) {
          const parts = story.id.split('--');
          components.add(parts[0]);
        }
      }

      componentsCount = components.size;
      hasStoriesData = true;
    } catch {
      // Fallback
    }
  }

  const storybookVersion = extractStorybookVersion(workspaceRoot);
  const workspaceTotal = countWorkspaceComponents(workspaceRoot, 6, includePaths, ignorePaths);
  const totalComponents = Math.max(componentsCount, workspaceTotal);
  const coveragePercent =
    totalComponents > 0 ? Math.min(100, Math.round((componentsCount / totalComponents) * 100)) : 100;

  return {
    storiesCount,
    componentsCount,
    totalComponents,
    coveragePercent,
    docsCount,
    storybookVersion,
    hasStoriesData
  };
}

/**
 * Builds markdown badge snippets for documentation and step summaries.
 */
export function buildBadgeMarkdown({ badgesUrl, siteUrl, includeTests = false }) {
  const cleanBadgesUrl = (badgesUrl || '').replace(/\/$/, '');
  const cleanSiteUrl = (siteUrl || cleanBadgesUrl || '#').replace(/\/$/, '');

  const badges = [
    `[![Storybook](${cleanBadgesUrl}/storybook.svg)](${cleanSiteUrl})`,
    `[![Status](${cleanBadgesUrl}/status.svg)](${cleanSiteUrl})`,
    `[![Coverage](${cleanBadgesUrl}/coverage.svg)](${cleanSiteUrl})`,
    `[![Stories](${cleanBadgesUrl}/stories.svg)](${cleanSiteUrl})`,
    `[![Components](${cleanBadgesUrl}/components.svg)](${cleanSiteUrl})`
  ];

  if (includeTests) {
    badges.push(`[![Tests](${cleanBadgesUrl}/tests.svg)](${cleanSiteUrl})`);
  }

  return badges.join(' ');
}

export function parseTestResultsData(data) {
  if (!data || typeof data !== 'object') return null;

  const nestedCandidate = data.counts || data.summary || data.totals || data.stats || data.results;
  if (nestedCandidate && typeof nestedCandidate === 'object' && nestedCandidate !== data) {
    const nested = parseTestResultsData(nestedCandidate);
    if (nested) return nested;
  }

  const readNumber = (...keys) => {
    for (const key of keys) {
      const value = data[key];
      if (typeof value === 'number' && Number.isFinite(value)) return value;
      if (typeof value === 'string' && value.trim() !== '') {
        const numeric = Number(value);
        if (Number.isFinite(numeric)) return numeric;
      }
    }
    return null;
  };

  const total = readNumber('total', 'totalTests', 'numTotalTests', 'tests');
  const passed = readNumber('passed', 'passedTests', 'numPassedTests');
  const failed = readNumber('failed', 'failedTests', 'numFailedTests');

  if (total === null && passed === null && failed === null) {
    return null;
  }

  const resolvedTotal =
    total !== null
      ? Math.max(0, Number(total))
      : passed !== null && failed !== null
        ? Math.max(0, Number(passed + failed))
        : null;
  const resolvedPassed =
    passed !== null
      ? Math.max(0, Number(passed))
      : resolvedTotal !== null && failed !== null
        ? Math.max(0, Number(resolvedTotal - failed))
        : null;
  const resolvedFailed =
    failed !== null
      ? Math.max(0, Number(failed))
      : resolvedTotal !== null && resolvedPassed !== null
        ? Math.max(0, Number(resolvedTotal - resolvedPassed))
        : null;

  if (resolvedTotal === null || resolvedPassed === null || resolvedFailed === null) {
    return null;
  }

  return {
    total: Math.round(resolvedTotal),
    passed: Math.round(resolvedPassed),
    failed: Math.round(resolvedFailed)
  };
}

export function readTestResultsFile(testResultsPath, workspaceRoot = process.cwd()) {
  if (!testResultsPath || typeof testResultsPath !== 'string') return null;
  const resolvedPath = path.resolve(workspaceRoot, testResultsPath);
  if (!fs.existsSync(resolvedPath)) return null;

  try {
    const raw = JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));
    const parsed = parseTestResultsData(raw);
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Resolves color for status/build messages based on state keyword.
 */
export function resolveBadgeStateColor(messageOrState, defaultColor = '4caf50') {
  if (!messageOrState) return defaultColor;
  const str = String(messageOrState).toLowerCase();
  if (str.includes('building') || str.includes('in progress') || str.includes('pending')) {
    return 'dfb317';
  }
  if (str.includes('fail') || str.includes('error')) {
    return 'e05d44';
  }
  if (str.includes('pass') || str.includes('published') || str.includes('success')) {
    return '4caf50';
  }
  return defaultColor;
}

/**
 * Generates badge SVG files and JSON endpoint files inside the static output directory.
 */
export function generateBadges({
  staticDir,
  workspaceRoot = process.cwd(),
  badgesDirectory = 'badges',
  siteUrl = '',
  basePath = '',
  commitSha = process.env.GITHUB_SHA || '',
  statusMessage = '',
  buildMessage = '',
  buildState = '',
  statusState = '',
  testResultsPath = '',
  coverageIncludePaths = [],
  coverageIgnorePaths = []
} = {}) {
  if (!staticDir || typeof staticDir !== 'string') {
    throw new Error('generateBadges requires a valid staticDir');
  }

  const staticAbs = path.resolve(staticDir);
  if (!fs.existsSync(staticAbs)) {
    throw new Error(`Static directory "${staticAbs}" does not exist`);
  }

  const badgesDirName = badgesDirectory && badgesDirectory !== '.' ? badgesDirectory : 'badges';
  const outDir = path.resolve(staticAbs, badgesDirName);

  // Path containment guard
  const relative = path.relative(staticAbs, outDir);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Badges directory "${badgesDirectory}" escapes static output directory "${staticAbs}"`);
  }

  fs.mkdirSync(outDir, { recursive: true });

  // Ensure .nojekyll exists in static output root so GitHub Pages serves underscore-prefixed assets (_plugin-vue...)
  try {
    const noJekyllPath = path.join(staticAbs, '.nojekyll');
    if (!fs.existsSync(noJekyllPath)) {
      fs.writeFileSync(noJekyllPath, '', 'utf8');
    }
  } catch {
    // Non-fatal
  }

  const metrics = extractStorybookMetrics(staticAbs, workspaceRoot, {
    includePaths: coverageIncludePaths,
    ignorePaths: coverageIgnorePaths
  });
  const testResults = testResultsPath ? readTestResultsFile(testResultsPath, workspaceRoot) : null;

  const shortSha = commitSha ? commitSha.slice(0, 7) : '';
  const storybookMsg = metrics.storybookVersion || 'deployed';
  const storiesMsg = metrics.hasStoriesData ? String(metrics.storiesCount) : 'active';
  const componentsMsg = metrics.hasStoriesData ? String(metrics.componentsCount) : 'active';
  const testsMessage = testResults
    ? testResults.failed === 0
      ? `${testResults.passed}/${testResults.total} passed`
      : `${testResults.failed}/${testResults.total} failed`
    : 'n/a';
  const testsColor = testResults ? (testResults.failed === 0 ? '#4caf50' : '#e05d44') : '#9e9e9e';

  // Determine status & build messages and colors
  let statusMsg = statusMessage;
  if (!statusMsg) {
    if (statusState === 'building' || buildState === 'building') {
      statusMsg = shortSha ? `building • ${shortSha}` : 'building';
    } else if (statusState === 'failed' || buildState === 'failed') {
      statusMsg = shortSha ? `failed • ${shortSha}` : 'failed';
    } else {
      statusMsg = shortSha ? `published • ${shortSha}` : 'published';
    }
  }

  let buildMsg = buildMessage;
  if (!buildMsg) {
    if (buildState === 'building' || statusState === 'building') {
      buildMsg = shortSha ? `building • ${shortSha}` : 'building';
    } else if (buildState === 'failed' || statusState === 'failed') {
      buildMsg = shortSha ? `failed • ${shortSha}` : 'failed';
    } else {
      buildMsg = shortSha ? `passed • ${shortSha}` : 'passed';
    }
  }

  const statusColor = resolveBadgeStateColor(statusMsg, '4caf50');
  const buildColor = resolveBadgeStateColor(buildMsg, '4caf50');

  // 1. Generate standard SVGs
  const svgStorybook = renderBadgeSvg({
    label: 'storybook',
    message: storybookMsg,
    labelColor: '#555555',
    messageColor: '#ff4785'
  });

  const svgStories = renderBadgeSvg({
    label: 'stories',
    message: storiesMsg,
    labelColor: '#555555',
    messageColor: '#0288d1'
  });

  const svgComponents = renderBadgeSvg({
    label: 'components',
    message: componentsMsg,
    labelColor: '#555555',
    messageColor: '#4caf50'
  });

  const svgStatus = renderBadgeSvg({
    label: 'storybook',
    message: statusMsg,
    labelColor: '#555555',
    messageColor: normalizeColor(statusColor)
  });

  const svgBuild = renderBadgeSvg({
    label: 'build',
    message: buildMsg,
    labelColor: '#555555',
    messageColor: normalizeColor(buildColor)
  });

  const svgCoverage = renderBadgeSvg({
    label: 'coverage',
    message: `${metrics.coveragePercent}% (${metrics.componentsCount}/${metrics.totalComponents})`,
    labelColor: '#555555',
    messageColor: metrics.coveragePercent >= 100 ? '#4caf50' : metrics.coveragePercent >= 75 ? '#0288d1' : '#ff9800'
  });

  const svgTests = renderBadgeSvg({
    label: 'tests',
    message: testsMessage,
    labelColor: '#555555',
    messageColor: normalizeColor(testsColor)
  });

  fs.writeFileSync(path.join(outDir, 'storybook.svg'), svgStorybook, 'utf8');
  fs.writeFileSync(path.join(outDir, 'stories.svg'), svgStories, 'utf8');
  fs.writeFileSync(path.join(outDir, 'components.svg'), svgComponents, 'utf8');
  fs.writeFileSync(path.join(outDir, 'status.svg'), svgStatus, 'utf8');
  fs.writeFileSync(path.join(outDir, 'build.svg'), svgBuild, 'utf8');
  fs.writeFileSync(path.join(outDir, 'coverage.svg'), svgCoverage, 'utf8');
  if (testResults) {
    fs.writeFileSync(path.join(outDir, 'tests.svg'), svgTests, 'utf8');
  }

  // 2. Generate Shields.io-compatible JSON endpoints
  const jsonStories = {
    schemaVersion: 1,
    label: 'stories',
    message: storiesMsg,
    color: '0288d1'
  };

  const jsonComponents = {
    schemaVersion: 1,
    label: 'components',
    message: componentsMsg,
    color: '4caf50'
  };

  const jsonCoverage = {
    schemaVersion: 1,
    label: 'coverage',
    message: `${metrics.coveragePercent}%`,
    color: metrics.coveragePercent >= 100 ? '4caf50' : metrics.coveragePercent >= 75 ? '0288d1' : 'ff9800'
  };

  const jsonStatus = {
    schemaVersion: 1,
    label: 'storybook',
    message: statusMsg,
    color: statusColor
  };

  const jsonBuild = {
    schemaVersion: 1,
    label: 'build',
    message: buildMsg,
    color: buildColor
  };

  const jsonStorybook = {
    schemaVersion: 1,
    label: 'storybook',
    message: storybookMsg,
    color: 'ff4785'
  };

  const jsonTests = testResults
    ? {
        schemaVersion: 1,
        label: 'tests',
        message: testsMessage,
        color: testResults.failed === 0 ? '4caf50' : 'e05d44'
      }
    : null;

  const jsonOverview = {
    schemaVersion: 1,
    status: statusMsg,
    build: buildMsg,
    commit: shortSha,
    storybookVersion: storybookMsg,
    storiesCount: metrics.storiesCount,
    componentsCount: metrics.componentsCount,
    totalComponents: metrics.totalComponents,
    coveragePercent: metrics.coveragePercent,
    docsCount: metrics.docsCount,
    hasStoriesData: metrics.hasStoriesData,
    tests: testResults
      ? {
          total: testResults.total,
          passed: testResults.passed,
          failed: testResults.failed,
          passedPercent: testResults.total > 0 ? Math.round((testResults.passed / testResults.total) * 100) : 0
        }
      : null,
    generatedAt: new Date().toISOString()
  };

  fs.writeFileSync(path.join(outDir, 'stories.json'), JSON.stringify(jsonStories, null, 2), 'utf8');
  fs.writeFileSync(path.join(outDir, 'components.json'), JSON.stringify(jsonComponents, null, 2), 'utf8');
  fs.writeFileSync(path.join(outDir, 'coverage.json'), JSON.stringify(jsonCoverage, null, 2), 'utf8');
  fs.writeFileSync(path.join(outDir, 'status.json'), JSON.stringify(jsonStatus, null, 2), 'utf8');
  fs.writeFileSync(path.join(outDir, 'build.json'), JSON.stringify(jsonBuild, null, 2), 'utf8');
  fs.writeFileSync(path.join(outDir, 'storybook.json'), JSON.stringify(jsonStorybook, null, 2), 'utf8');
  if (jsonTests) {
    fs.writeFileSync(path.join(outDir, 'tests.json'), JSON.stringify(jsonTests, null, 2), 'utf8');
  }
  fs.writeFileSync(path.join(outDir, 'overview.json'), JSON.stringify(jsonOverview, null, 2), 'utf8');

  // Calculate full URL for markdown snippets
  let derivedBadgesUrl = '';
  if (siteUrl) {
    const cleanSite = siteUrl.replace(/\/$/, '');
    const cleanBase = basePath ? `/${basePath.replace(/^\/|\/$/g, '')}` : '';
    derivedBadgesUrl = `${cleanSite}${cleanBase}/${badgesDirName}`;
  } else {
    derivedBadgesUrl = badgesDirName;
  }

  const markdownSnippets = buildBadgeMarkdown({
    badgesUrl: derivedBadgesUrl,
    siteUrl: siteUrl ? `${siteUrl.replace(/\/$/, '')}${basePath ? `/${basePath.replace(/^\/|\/$/g, '')}` : ''}` : '',
    includeTests: !!testResults
  });

  return {
    metrics,
    outDir,
    badgesDirectory: badgesDirName,
    derivedBadgesUrl,
    markdownSnippets,
    filesGenerated: [
      'storybook.svg',
      'stories.svg',
      'components.svg',
      'status.svg',
      'build.svg',
      'coverage.svg',
      ...(testResults ? ['tests.svg'] : []),
      'stories.json',
      'components.json',
      'coverage.json',
      'status.json',
      'build.json',
      'storybook.json',
      ...(testResults ? ['tests.json'] : []),
      'overview.json'
    ]
  };
}

if (process.argv[1] && process.argv[1].endsWith('generate-badges.js')) {
  const staticDir = process.argv[2] || process.env.SB_PATH || 'storybook-static';
  const workspaceRoot = process.argv[3] || process.env.WORKSPACE_ROOT || process.cwd();
  const badgesDir = process.env.SB_BADGES_DIRECTORY || 'badges';
  const siteUrl = process.env.SB_SITE_URL || '';
  const basePath = process.env.SB_BASE_PATH || '';
  const commitSha = process.env.GITHUB_SHA || '';
  const statusMessage = process.env.SB_STATUS_MESSAGE || '';
  const buildMessage = process.env.SB_BUILD_MESSAGE || '';
  const buildState = process.env.SB_BUILD_STATE || '';
  const statusState = process.env.SB_STATUS_STATE || '';
  const testResultsPath = process.env.SB_TEST_RESULTS_PATH || '';
  const coverageIncludePaths = process.env.SB_COVERAGE_INCLUDE_PATHS || '';
  const coverageIgnorePaths = process.env.SB_COVERAGE_IGNORE_PATHS || '';

  try {
    const result = generateBadges({
      staticDir,
      workspaceRoot,
      badgesDirectory: badgesDir,
      siteUrl,
      basePath,
      commitSha,
      statusMessage,
      buildMessage,
      buildState,
      statusState,
      testResultsPath,
      coverageIncludePaths: coverageIncludePaths ? coverageIncludePaths.split(/\r?\n|,/) : [],
      coverageIgnorePaths: coverageIgnorePaths ? coverageIgnorePaths.split(/\r?\n|,/) : []
    });

    console.log(`✅ Storybook badges generated in "${result.outDir}":`);
    console.log(`   • Stories: ${result.metrics.storiesCount}`);
    console.log(`   • Components: ${result.metrics.componentsCount}`);
    console.log(`   • Total Components: ${result.metrics.totalComponents}`);
    console.log(`   • Coverage: ${result.metrics.coveragePercent}%`);
    console.log(`   • Storybook: ${result.metrics.storybookVersion}`);
    console.log('');
    console.log('Markdown snippets:');
    console.log(result.markdownSnippets);

    if (process.env.GITHUB_STEP_SUMMARY) {
      const summaryContent = [
        '',
        '### 🏷️ Storybook Badges',
        '',
        result.markdownSnippets,
        '',
        '| Metric | Value |',
        '|---|---|',
        `| **Stories** | \`${result.metrics.storiesCount}\` |`,
        `| **Components** | \`${result.metrics.componentsCount}\` |`,
        `| **Storybook Version** | \`${result.metrics.storybookVersion}\` |`,
        ''
      ].join('\n');
      fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summaryContent);
    }
  } catch (err) {
    console.error('Badge generation error:', err.message);
    process.exit(1);
  }
}
