import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  roughLine,
  roughRect,
  roughCurve,
  compactHistoryForChart,
  renderHandDrawnChartSvg,
  updateHistoryLedger,
  generateStatsGraph
} from '../src/generate-stats.js';

test('roughLine generates valid SVG path with jitter and overshoot', () => {
  const d = roughLine(0, 0, 100, 100);
  assert.ok(d.startsWith('M'));
  assert.ok(d.includes('Q'));
});

test('roughRect generates valid SVG path for rectangle', () => {
  const d = roughRect(10, 10, 80, 50);
  assert.ok(d.startsWith('M'));
  assert.ok(d.includes('Q'));
});

test('roughCurve handles empty, single-point, and multi-point series', () => {
  assert.equal(roughCurve([]), '');

  const single = roughCurve([{ x: 50, y: 50 }]);
  assert.ok(single.startsWith('M'));

  const multi = roughCurve([
    { x: 0, y: 10 },
    { x: 50, y: 40 },
    { x: 100, y: 80 }
  ]);
  assert.ok(multi.startsWith('M'));
  assert.ok(multi.includes('C'));
});

test('renderHandDrawnChartSvg renders complete SVG with title, axes, and series', () => {
  const history = [
    { date: '2026-09-01', stories: 4, components: 2, totalComponents: 3, coveragePercent: 67, version: 'v10.0.0' },
    { date: '2026-09-08', stories: 10, components: 3, totalComponents: 4, coveragePercent: 75, version: 'v10.1.0' },
    { date: '2026-09-13', stories: 16, components: 4, totalComponents: 5, coveragePercent: 80, version: 'v10.6.0' }
  ];

  const svg = renderHandDrawnChartSvg({
    history,
    title: 'Custom Component Growth',
    theme: 'dark'
  });

  assert.ok(svg.includes('<svg'));
  assert.ok(svg.includes('Custom Component Growth'));
  assert.ok(!svg.includes('Stories (16)'));
  assert.ok(svg.includes('Covered Components (4 • 80%)'));
  assert.ok(svg.includes('Total Components (5)'));
  assert.ok(svg.includes('--components-color: #22c55e'));
  assert.ok(svg.includes('--total-color: #f87171'));
  assert.ok(svg.includes('2026-09-01'));
  assert.ok(svg.includes('2026-09-13'));
  assert.ok(svg.includes('</svg>'));
});

test('compactHistoryForChart keeps component metric changes and latest snapshot only', () => {
  const history = [
    { date: '2026-09-01', stories: 16, components: 4, totalComponents: 6, coveragePercent: 67 },
    { date: '2026-09-02', stories: 16, components: 4, totalComponents: 6, coveragePercent: 67 },
    { date: '2026-09-03', stories: 17, components: 4, totalComponents: 6, coveragePercent: 67 },
    { date: '2026-09-04', stories: 17, components: 5, totalComponents: 6, coveragePercent: 83 },
    { date: '2026-09-05', stories: 18, components: 5, totalComponents: 6, coveragePercent: 83 }
  ];

  assert.deepEqual(
    compactHistoryForChart(history).map(entry => entry.date),
    ['2026-09-01', '2026-09-04', '2026-09-05']
  );
});

test('renderHandDrawnChartSvg omits stories series and story-only publish dates from chart ticks', () => {
  const svg = renderHandDrawnChartSvg({
    history: [
      { date: '2026-09-01', stories: 16, components: 4, totalComponents: 6, coveragePercent: 67 },
      { date: '2026-09-02', stories: 16, components: 4, totalComponents: 6, coveragePercent: 67 },
      { date: '2026-09-03', stories: 17, components: 4, totalComponents: 6, coveragePercent: 67 },
      { date: '2026-09-04', stories: 17, components: 5, totalComponents: 6, coveragePercent: 83 },
      { date: '2026-09-05', stories: 18, components: 5, totalComponents: 6, coveragePercent: 83 }
    ]
  });

  assert.ok(svg.includes('2026-09-01'));
  assert.ok(!svg.includes('2026-09-02'));
  assert.ok(!svg.includes('2026-09-03'));
  assert.ok(svg.includes('2026-09-04'));
  assert.ok(svg.includes('2026-09-05'));
  assert.ok(!svg.includes('Stories (18)'));
  assert.ok(svg.includes('Covered Components (5 • 83%)'));
  assert.ok(svg.includes('Total Components (6)'));
});

test('updateHistoryLedger appends new snapshot and handles deduplication on same commit', () => {
  const initial = [{ date: '2026-09-01', commit: 'abc1234', stories: 4, components: 2 }];

  // Appending new commit
  const step1 = updateHistoryLedger({
    existingHistory: initial,
    currentSnapshot: {
      date: '2026-09-08',
      commit: 'def5678',
      stories: 10,
      components: 3
    }
  });
  assert.equal(step1.length, 2);
  assert.equal(step1[1].commit, 'def5678');

  // Re-running on same commit with same counts updates existing entry rather than duplicating
  const step2 = updateHistoryLedger({
    existingHistory: step1,
    currentSnapshot: {
      date: '2026-09-08',
      commit: 'def5678',
      stories: 10,
      components: 3
    }
  });
  assert.equal(step2.length, 2);
});

test('generateStatsGraph creates history.json and history.svg in static output directory', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-stats-test-'));
  const staticDir = path.join(tmpDir, 'storybook-static');
  fs.mkdirSync(staticDir, { recursive: true });

  // Mock storybook index.json
  const indexJson = {
    entries: {
      'button--primary': { id: 'button--primary', title: 'Components/Button', type: 'story' },
      'button--secondary': { id: 'button--secondary', title: 'Components/Button', type: 'story' },
      'badge--default': { id: 'badge--default', title: 'Components/Badge', type: 'story' },
      'button--docs': { id: 'button--docs', title: 'Components/Button', type: 'docs' }
    }
  };
  fs.writeFileSync(path.join(staticDir, 'index.json'), JSON.stringify(indexJson), 'utf8');

  const result = generateStatsGraph({
    staticDir,
    workspaceRoot: tmpDir,
    statsDirectory: 'stats',
    siteUrl: 'https://example.github.io/my-lib',
    commitSha: 'a1b2c3d4e5f6'
  });

  assert.equal(result.metrics.storiesCount, 3);
  assert.equal(result.metrics.componentsCount, 2);
  assert.equal(result.historyCount, 1);
  assert.ok(fs.existsSync(path.join(staticDir, '.nojekyll')), '.nojekyll must be created in static root');
  assert.ok(fs.existsSync(result.historyJsonPath));
  assert.ok(fs.existsSync(result.historySvgPath));

  const savedHistory = JSON.parse(fs.readFileSync(result.historyJsonPath, 'utf8'));
  assert.equal(savedHistory.length, 1);
  assert.equal(savedHistory[0].stories, 3);
  assert.equal(savedHistory[0].components, 2);
  assert.equal(savedHistory[0].commit, 'a1b2c3d');

  const svgContent = fs.readFileSync(result.historySvgPath, 'utf8');
  assert.ok(
    svgContent.includes('Storybook Component &amp; Story Growth') || svgContent.includes('Storybook Component')
  );
  assert.ok(!svgContent.includes('Stories (3)'));
  assert.ok(svgContent.includes('Covered Components (2'));

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('generateStatsGraph loads prior history from pagesRepo', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-stats-pages-test-'));
  const staticDir = path.join(tmpDir, 'storybook-static');
  const pagesRepo = path.join(tmpDir, 'pages-repo');
  fs.mkdirSync(staticDir, { recursive: true });
  fs.mkdirSync(path.join(pagesRepo, 'stats'), { recursive: true });

  const existingHistory = [
    { date: '2026-09-01', commit: '1111111', stories: 5, components: 2, version: 'v10.0.0' },
    { date: '2026-09-05', commit: '2222222', stories: 10, components: 3, version: 'v10.1.0' }
  ];
  fs.writeFileSync(path.join(pagesRepo, 'stats', 'history.json'), JSON.stringify(existingHistory), 'utf8');

  const indexJson = {
    entries: {
      'button--primary': { id: 'button--primary', title: 'Components/Button', type: 'story' },
      'card--default': { id: 'card--default', title: 'Components/Card', type: 'story' }
    }
  };
  fs.writeFileSync(path.join(staticDir, 'index.json'), JSON.stringify(indexJson), 'utf8');

  const result = generateStatsGraph({
    staticDir,
    workspaceRoot: tmpDir,
    pagesRepo,
    statsDirectory: 'stats',
    commitSha: '333333333333'
  });

  assert.equal(result.historyCount, 3);
  const savedHistory = JSON.parse(fs.readFileSync(result.historyJsonPath, 'utf8'));
  assert.equal(savedHistory.length, 3);
  assert.equal(savedHistory[0].commit, '1111111');
  assert.equal(savedHistory[1].commit, '2222222');
  assert.equal(savedHistory[2].commit, '3333333');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('generateStatsGraph rejects path traversal in statsDirectory', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-stats-sec-test-'));
  const staticDir = path.join(tmpDir, 'storybook-static');
  fs.mkdirSync(staticDir, { recursive: true });

  assert.throws(() => {
    generateStatsGraph({
      staticDir,
      statsDirectory: '../outside'
    });
  }, /escapes static output directory/);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
