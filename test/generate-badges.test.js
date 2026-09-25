import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  estimateTextWidth,
  escapeXml,
  normalizeColor,
  renderBadgeSvg,
  extractStorybookVersion,
  extractStorybookMetrics,
  countWorkspaceComponents,
  buildBadgeMarkdown,
  generateBadges,
  parseTestResultsData
} from '../src/generate-badges.js';
import { parseSimpleYaml } from '../src/config.js';

test('estimateTextWidth returns reasonable widths for various character sets', () => {
  assert.equal(estimateTextWidth(''), 0);
  assert.ok(estimateTextWidth('storybook') > estimateTextWidth('sb'));
  assert.ok(estimateTextWidth('MMMM') > estimateTextWidth('iiii'));
});

test('escapeXml correctly escapes XML entities', () => {
  assert.equal(escapeXml('<script>&"\'</script>'), '&lt;script&gt;&amp;&quot;&apos;&lt;/script&gt;');
  assert.equal(escapeXml(null), '');
  assert.equal(escapeXml(undefined), '');
  assert.equal(escapeXml(123), '123');
});

test('normalizeColor formats colors into valid SVG fill strings', () => {
  assert.equal(normalizeColor('ff4785'), '#ff4785');
  assert.equal(normalizeColor('#0288d1'), '#0288d1');
  assert.equal(normalizeColor('blue'), 'blue');
  assert.equal(normalizeColor(''), '#007ec6');
});

test('renderBadgeSvg renders a well-formed SVG with title, dimensions, and text', () => {
  const svg = renderBadgeSvg({
    label: 'stories',
    message: '42',
    labelColor: '#555555',
    messageColor: '#ff4785'
  });

  assert.ok(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'));
  assert.ok(svg.endsWith('</svg>'));
  assert.match(svg, /<title>stories: 42<\/title>/);
  assert.match(svg, /fill="#555555"/);
  assert.match(svg, /fill="#ff4785"/);
  assert.match(svg, />stories<\/text>/);
  assert.match(svg, />42<\/text>/);
});

test('renderBadgeSvg escapes special characters inside XML tags and attributes', () => {
  const svg = renderBadgeSvg({
    label: 'components <v1>',
    message: '10 & 20'
  });

  assert.match(svg, /components &lt;v1&gt;/);
  assert.match(svg, /10 &amp; 20/);
  assert.ok(!svg.includes('components <v1>'));
});

test('extractStorybookVersion reads version from package.json devDependencies', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-badge-pkg-'));
  fs.writeFileSync(
    path.join(tmpDir, 'package.json'),
    JSON.stringify({
      devDependencies: {
        storybook: '^8.6.0'
      }
    })
  );

  const version = extractStorybookVersion(tmpDir);
  assert.equal(version, 'v8.6.0');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('extractStorybookVersion falls back to "deployed" when not found', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-badge-nopkg-'));
  const version = extractStorybookVersion(tmpDir);
  assert.equal(version, 'deployed');
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('extractStorybookMetrics parses Storybook v7/v8 index.json', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-badge-index-'));
  const indexData = {
    v: 4,
    entries: {
      'button--primary': { type: 'story', id: 'button--primary', title: 'Components/Button' },
      'button--secondary': { type: 'story', id: 'button--secondary', title: 'Components/Button' },
      'card--default': { type: 'story', id: 'card--default', title: 'Components/Card' },
      'button--docs': { type: 'docs', id: 'button--docs', title: 'Components/Button' }
    }
  };
  fs.writeFileSync(path.join(tmpDir, 'index.json'), JSON.stringify(indexData));

  const metrics = extractStorybookMetrics(tmpDir, tmpDir);
  assert.equal(metrics.storiesCount, 3);
  assert.equal(metrics.componentsCount, 2);
  assert.equal(metrics.docsCount, 1);
  assert.equal(metrics.hasStoriesData, true);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('extractStorybookMetrics parses Storybook v6/v7 stories.json', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-badge-stories-'));
  const storiesData = {
    v: 3,
    stories: {
      'header--logged-in': { id: 'header--logged-in', title: 'UI/Header' },
      'header--logged-out': { id: 'header--logged-out', title: 'UI/Header' },
      'modal--open': { id: 'modal--open', title: 'UI/Modal' }
    }
  };
  fs.writeFileSync(path.join(tmpDir, 'stories.json'), JSON.stringify(storiesData));

  const metrics = extractStorybookMetrics(tmpDir, tmpDir);
  assert.equal(metrics.storiesCount, 3);
  assert.equal(metrics.componentsCount, 2);
  assert.equal(metrics.docsCount, 0);
  assert.equal(metrics.hasStoriesData, true);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('extractStorybookMetrics handles directory with no index.json or stories.json', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-badge-empty-'));
  const metrics = extractStorybookMetrics(tmpDir, tmpDir);
  assert.equal(metrics.storiesCount, 0);
  assert.equal(metrics.componentsCount, 0);
  assert.equal(metrics.hasStoriesData, false);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('parseSimpleYaml reads block scalar values for coverage path filters', () => {
  const yaml = `coverage_include_paths: |\n  src/components/**\n  packages/*/src/components/**\ncoverage_ignore_paths: |\n  **/generated/**\n  **/vendor/**\n`;
  assert.deepEqual(parseSimpleYaml(yaml), {
    coverage_include_paths: 'src/components/**\npackages/*/src/components/**',
    coverage_ignore_paths: '**/generated/**\n**/vendor/**'
  });
});

test('countWorkspaceComponents honors include and ignore repository-root glob filters', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-badge-coverage-filters-'));
  fs.mkdirSync(path.join(tmpDir, 'src', 'components'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, 'packages', 'app', 'src', 'components'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, 'generated', 'vendor'), { recursive: true });

  const files = [
    'src/components/Button.tsx',
    'src/components/Card.tsx',
    'packages/app/src/components/Header.tsx',
    'generated/vendor/Widget.tsx',
    'generated/vendor/Widget.stories.tsx',
    'src/components/Legend.spec.tsx'
  ];

  for (const file of files) {
    const full = path.join(tmpDir, file);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, 'export const x = 1;');
  }

  assert.equal(countWorkspaceComponents(tmpDir), 4);
  assert.equal(countWorkspaceComponents(tmpDir, 6, ['src/components/**']), 2);
  assert.equal(countWorkspaceComponents(tmpDir, 6, ['**/src/components/**', 'generated/**'], ['**/vendor/**']), 3);

  const metrics = extractStorybookMetrics(tmpDir, tmpDir, {
    includePaths: ['**/src/components/**'],
    ignorePaths: ['**/vendor/**']
  });

  assert.equal(metrics.totalComponents, 3);
  assert.equal(metrics.coveragePercent, 0);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('parseTestResultsData accepts common pass/fail totals and nested result objects', () => {
  assert.deepEqual(parseTestResultsData({ total: 546, passed: 546, failed: 0 }), {
    total: 546,
    passed: 546,
    failed: 0
  });
  assert.deepEqual(parseTestResultsData({ totalTests: 10, passedTests: 9, failedTests: 1 }), {
    total: 10,
    passed: 9,
    failed: 1
  });
  assert.deepEqual(parseTestResultsData({ counts: { total: 7, passed: 5, failed: 2 } }), {
    total: 7,
    passed: 5,
    failed: 2
  });
  assert.equal(parseTestResultsData({ weird: 'value' }), null);
});

test('buildBadgeMarkdown constructs markdown links correctly', () => {
  const markdown = buildBadgeMarkdown({
    badgesUrl: 'https://example.github.io/my-repo/badges',
    siteUrl: 'https://example.github.io/my-repo',
    includeTests: true
  });
  assert.match(markdown, /\[!\[Storybook\]\(https:\/\/example\.github\.io\/my-repo\/badges\/storybook\.svg\)\]/);
  assert.match(markdown, /\[!\[Stories\]\(https:\/\/example\.github\.io\/my-repo\/badges\/stories\.svg\)\]/);
  assert.match(markdown, /\[!\[Components\]\(https:\/\/example\.github\.io\/my-repo\/badges\/components\.svg\)\]/);
  assert.match(markdown, /\[!\[Tests\]\(https:\/\/example\.github\.io\/my-repo\/badges\/tests\.svg\)\]/);
});

test('generateBadges creates SVG badges and Shields.io JSON endpoints', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-badge-gen-'));
  const storiesData = {
    v: 3,
    stories: {
      'button--primary': { id: 'button--primary', title: 'Components/Button' },
      'card--default': { id: 'card--default', title: 'Components/Card' }
    }
  };
  fs.writeFileSync(path.join(tmpDir, 'stories.json'), JSON.stringify(storiesData));

  const testResultsPath = path.join(tmpDir, 'test-results.json');
  fs.writeFileSync(testResultsPath, JSON.stringify({ total: 2, passed: 2, failed: 0 }));

  const result = generateBadges({
    staticDir: tmpDir,
    workspaceRoot: tmpDir,
    badgesDirectory: 'badges',
    siteUrl: 'https://example.github.io/test-project',
    commitSha: 'a1b2c3d4e5f6',
    testResultsPath
  });

  assert.equal(result.metrics.storiesCount, 2);
  assert.equal(result.metrics.componentsCount, 2);
  assert.ok(fs.existsSync(path.join(tmpDir, '.nojekyll')), '.nojekyll must be created in static root');

  const badgesDir = path.join(tmpDir, 'badges');
  assert.ok(fs.existsSync(path.join(badgesDir, 'storybook.svg')));
  assert.ok(fs.existsSync(path.join(badgesDir, 'stories.svg')));
  assert.ok(fs.existsSync(path.join(badgesDir, 'components.svg')));
  assert.ok(fs.existsSync(path.join(badgesDir, 'status.svg')));
  assert.ok(fs.existsSync(path.join(badgesDir, 'build.svg')));
  assert.ok(fs.existsSync(path.join(badgesDir, 'coverage.svg')));
  assert.ok(fs.existsSync(path.join(badgesDir, 'tests.svg')));

  // Check JSON endpoints
  assert.ok(fs.existsSync(path.join(badgesDir, 'stories.json')));
  assert.ok(fs.existsSync(path.join(badgesDir, 'components.json')));
  assert.ok(fs.existsSync(path.join(badgesDir, 'coverage.json')));
  assert.ok(fs.existsSync(path.join(badgesDir, 'status.json')));
  assert.ok(fs.existsSync(path.join(badgesDir, 'build.json')));
  assert.ok(fs.existsSync(path.join(badgesDir, 'storybook.json')));
  assert.ok(fs.existsSync(path.join(badgesDir, 'tests.json')));
  assert.ok(fs.existsSync(path.join(badgesDir, 'overview.json')));

  const storiesJson = JSON.parse(fs.readFileSync(path.join(badgesDir, 'stories.json'), 'utf8'));
  assert.equal(storiesJson.schemaVersion, 1);
  assert.equal(storiesJson.label, 'stories');
  assert.equal(storiesJson.message, '2');

  const statusJson = JSON.parse(fs.readFileSync(path.join(badgesDir, 'status.json'), 'utf8'));
  assert.equal(statusJson.schemaVersion, 1);
  assert.equal(statusJson.label, 'storybook');
  assert.equal(statusJson.message, 'published • a1b2c3d');

  const buildJson = JSON.parse(fs.readFileSync(path.join(badgesDir, 'build.json'), 'utf8'));
  assert.equal(buildJson.schemaVersion, 1);
  assert.equal(buildJson.label, 'build');
  assert.equal(buildJson.message, 'passed • a1b2c3d');

  const componentsJson = JSON.parse(fs.readFileSync(path.join(badgesDir, 'components.json'), 'utf8'));
  assert.equal(componentsJson.schemaVersion, 1);
  assert.equal(componentsJson.label, 'components');
  assert.equal(componentsJson.message, '2');

  const testsJson = JSON.parse(fs.readFileSync(path.join(badgesDir, 'tests.json'), 'utf8'));
  assert.equal(testsJson.label, 'tests');
  assert.equal(testsJson.message, '2/2 passed');

  const overviewJson = JSON.parse(fs.readFileSync(path.join(badgesDir, 'overview.json'), 'utf8'));
  assert.equal(overviewJson.storiesCount, 2);
  assert.equal(overviewJson.componentsCount, 2);
  assert.equal(overviewJson.status, 'published • a1b2c3d');
  assert.equal(overviewJson.commit, 'a1b2c3d');
  assert.deepEqual(overviewJson.tests, { total: 2, passed: 2, failed: 0, passedPercent: 100 });

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('generateBadges renders building state with yellow color', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-badge-building-'));
  const storiesData = {
    v: 3,
    stories: {
      'button--primary': { id: 'button--primary', title: 'Components/Button' }
    }
  };
  fs.writeFileSync(path.join(tmpDir, 'stories.json'), JSON.stringify(storiesData));

  const _result = generateBadges({
    staticDir: tmpDir,
    workspaceRoot: tmpDir,
    badgesDirectory: 'badges',
    commitSha: 'fedcba987654',
    buildState: 'building'
  });

  const badgesDir = path.join(tmpDir, 'badges');
  const statusSvg = fs.readFileSync(path.join(badgesDir, 'status.svg'), 'utf8');
  assert.match(statusSvg, /building • fedcba9/);
  assert.match(statusSvg, /#dfb317/);

  const buildJson = JSON.parse(fs.readFileSync(path.join(badgesDir, 'build.json'), 'utf8'));
  assert.equal(buildJson.message, 'building • fedcba9');
  assert.equal(buildJson.color, 'dfb317');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('generateBadges renders failed state with red color', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-badge-failed-'));
  const _result = generateBadges({
    staticDir: tmpDir,
    workspaceRoot: tmpDir,
    badgesDirectory: 'badges',
    commitSha: 'fedcba987654',
    buildState: 'failed'
  });

  const badgesDir = path.join(tmpDir, 'badges');
  const statusSvg = fs.readFileSync(path.join(badgesDir, 'status.svg'), 'utf8');
  assert.match(statusSvg, /failed • fedcba9/);
  assert.match(statusSvg, /#e05d44/);

  const buildJson = JSON.parse(fs.readFileSync(path.join(badgesDir, 'build.json'), 'utf8'));
  assert.equal(buildJson.message, 'failed • fedcba9');
  assert.equal(buildJson.color, 'e05d44');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('generateBadges rejects path traversal in badgesDirectory', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-badge-sec-'));
  assert.throws(() => {
    generateBadges({
      staticDir: tmpDir,
      badgesDirectory: '../outside-badges'
    });
  }, /escapes static output directory/);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
