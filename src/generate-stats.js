import fs from 'node:fs';
import path from 'node:path';
import { extractStorybookMetrics, escapeXml } from './generate-badges.js';

/**
 * Seedable pseudo-random number generator for consistent organic jitter.
 */
function createSeededRandom(seed = 1234567) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

/**
 * Generates an SVG path string for a hand-drawn / wobbly straight line with slight overshoot.
 */
export function roughLine(x1, y1, x2, y2, { roughness = 1.2, overshoot = 3, random = Math.random } = {}) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.hypot(dx, dy);
  if (length === 0) return `M ${x1} ${y1}`;

  const ux = dx / length;
  const uy = dy / length;
  const perpX = -uy;
  const perpY = ux;

  // Add subtle overshoot to ends
  const startX = x1 - ux * overshoot * (random() * 0.5 + 0.5);
  const startY = y1 - uy * overshoot * (random() * 0.5 + 0.5);
  const endX = x2 + ux * overshoot * (random() * 0.5 + 0.5);
  const endY = y2 + uy * overshoot * (random() * 0.5 + 0.5);

  const steps = Math.max(2, Math.floor(length / 25));
  let d = `M ${startX.toFixed(2)} ${startY.toFixed(2)}`;

  let prevX = startX;
  let prevY = startY;

  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const targetX = startX + (endX - startX) * t;
    const targetY = startY + (endY - startY) * t;

    // Jitter perpendicular to line
    const jitter = (random() - 0.5) * 2 * roughness;
    const curX = i === steps ? endX : targetX + perpX * jitter;
    const curY = i === steps ? endY : targetY + perpY * jitter;

    // Midpoint control point for subtle curvature
    const midX = (prevX + curX) / 2 + perpX * (random() - 0.5) * roughness * 0.5;
    const midY = (prevY + curY) / 2 + perpY * (random() - 0.5) * roughness * 0.5;

    d += ` Q ${midX.toFixed(2)} ${midY.toFixed(2)} ${curX.toFixed(2)} ${curY.toFixed(2)}`;
    prevX = curX;
    prevY = curY;
  }

  return d;
}

/**
 * Generates an SVG path for a hand-drawn rectangle.
 */
export function roughRect(x, y, w, h, { roughness = 1.0, overshoot = 2, random = Math.random } = {}) {
  const top = roughLine(x, y, x + w, y, { roughness, overshoot, random });
  const right = roughLine(x + w, y, x + w, y + h, { roughness, overshoot, random });
  const bottom = roughLine(x + w, y + h, x, y + h, { roughness, overshoot, random });
  const left = roughLine(x, y + h, x, y, { roughness, overshoot, random });
  return `${top} ${right} ${bottom} ${left}`;
}

/**
 * Generates an SVG path for a smooth hand-drawn curve through data points.
 */
export function roughCurve(points, { roughness = 0.8, random = Math.random } = {}) {
  if (!points || points.length === 0) return '';
  if (points.length === 1) {
    const [p] = points;
    return `M ${(p.x - 4).toFixed(2)} ${p.y.toFixed(2)} A 4 4 0 1 0 ${(p.x + 4).toFixed(2)} ${p.y.toFixed(2)}`;
  }

  // Draw smooth curve using Catmull-Rom or cubic beziers
  let d = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;

  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];

    // Catmull-Rom to Cubic Bezier control points
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;

    const j1x = cp1x + (random() - 0.5) * roughness;
    const j1y = cp1y + (random() - 0.5) * roughness;
    const j2x = cp2x + (random() - 0.5) * roughness;
    const j2y = cp2y + (random() - 0.5) * roughness;
    const endX = p2.x + (i === points.length - 2 ? 0 : (random() - 0.5) * roughness * 0.5);
    const endY = p2.y + (i === points.length - 2 ? 0 : (random() - 0.5) * roughness * 0.5);

    d += ` C ${j1x.toFixed(2)} ${j1y.toFixed(2)} ${j2x.toFixed(2)} ${j2y.toFixed(2)} ${endX.toFixed(2)} ${endY.toFixed(2)}`;
  }

  return d;
}

/**
 * Keeps the chart focused on metric changes while preserving the latest snapshot.
 */
export function compactHistoryForChart(history = []) {
  const compact = [];

  for (const entry of history) {
    const previous = compact[compact.length - 1];
    const changed =
      !previous ||
      previous.components !== entry.components ||
      previous.totalComponents !== entry.totalComponents ||
      previous.coveragePercent !== entry.coveragePercent;

    if (changed) compact.push(entry);
  }

  const latest = history[history.length - 1];
  if (latest && compact[compact.length - 1] !== latest) compact.push(latest);

  return compact;
}

/**
 * Renders a complete hand-drawn growth chart SVG.
 */
export function renderHandDrawnChartSvg({
  history = [],
  title = 'Storybook Growth History',
  width = 850,
  height = 460,
  theme = 'auto',
  seed = 42
} = {}) {
  const random = createSeededRandom(seed);

  const padding = { top: 75, right: 45, bottom: 65, left: 75 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  // Format data points
  const validHistory = (
    Array.isArray(history) && history.length > 0
      ? history
      : [
          {
            date: new Date().toISOString().slice(0, 10),
            stories: 0,
            components: 0,
            totalComponents: 0,
            coveragePercent: 100
          }
        ]
  ).map((entry, idx) => ({
    index: idx,
    date: entry.date || (entry.timestamp ? entry.timestamp.slice(0, 10) : `Run ${idx + 1}`),
    stories: Number(entry.stories || 0),
    components: Number(entry.components || 0),
    totalComponents: entry.totalComponents !== undefined ? Number(entry.totalComponents) : undefined,
    coveragePercent: entry.coveragePercent !== undefined ? Number(entry.coveragePercent) : undefined,
    version: entry.version || ''
  }));

  const chartHistory = compactHistoryForChart(validHistory);
  const hasTotalComponents = chartHistory.some(d => d.totalComponents !== undefined && d.totalComponents > 0);

  // Determine Y domain
  const maxVal = Math.max(5, ...chartHistory.map(d => Math.max(d.components, d.totalComponents || 0)));
  // Round maxVal up to nice round number
  const yMax = Math.ceil(maxVal * 1.15);

  const numYGridLines = 4;
  const yTicks = [];
  for (let i = 0; i <= numYGridLines; i++) {
    const val = Math.round((yMax / numYGridLines) * i);
    yTicks.push({
      value: val,
      y: padding.top + plotHeight - (val / yMax) * plotHeight
    });
  }

  // Calculate coordinates for series
  const n = chartHistory.length;
  const getX = idx => {
    if (n === 1) return padding.left + plotWidth / 2;
    return padding.left + (idx / (n - 1)) * plotWidth;
  };
  const getY = val => padding.top + plotHeight - (val / yMax) * plotHeight;

  const componentsPoints = chartHistory.map((d, i) => ({ x: getX(i), y: getY(d.components), ...d }));
  const totalComponentsPoints = hasTotalComponents
    ? chartHistory.map((d, i) => ({
        x: getX(i),
        y: getY(d.totalComponents !== undefined ? d.totalComponents : d.components),
        ...d
      }))
    : [];

  // Hand-drawn axes
  const axisYPath = roughLine(padding.left, padding.top - 10, padding.left, padding.top + plotHeight + 5, {
    roughness: 1.2,
    overshoot: 6,
    random
  });
  const axisXPath = roughLine(
    padding.left - 5,
    padding.top + plotHeight,
    padding.left + plotWidth + 15,
    padding.top + plotHeight,
    {
      roughness: 1.2,
      overshoot: 6,
      random
    }
  );

  // Hand-drawn grid lines
  const gridPaths = yTicks.slice(1).map(tick => ({
    d: roughLine(padding.left, tick.y, padding.left + plotWidth, tick.y, { roughness: 0.6, overshoot: 0, random }),
    value: tick.value,
    y: tick.y
  }));

  // X ticks
  const xTickIndices = [];
  if (n <= 6) {
    for (let i = 0; i < n; i++) xTickIndices.push(i);
  } else {
    const step = Math.ceil(n / 5);
    for (let i = 0; i < n; i += step) xTickIndices.push(i);
    if (xTickIndices[xTickIndices.length - 1] !== n - 1) xTickIndices.push(n - 1);
  }

  const xTicks = xTickIndices.map(idx => ({
    x: getX(idx),
    label: chartHistory[idx].date,
    tickD: roughLine(getX(idx), padding.top + plotHeight, getX(idx), padding.top + plotHeight + 6, {
      roughness: 0.8,
      overshoot: 1,
      random
    })
  }));

  // Curves
  const componentsPath1 = roughCurve(componentsPoints, { roughness: 1.0, random });
  const componentsPath2 = roughCurve(componentsPoints, { roughness: 0.7, random });
  const totalComponentsPath1 = hasTotalComponents ? roughCurve(totalComponentsPoints, { roughness: 1.0, random }) : '';
  const totalComponentsPath2 = hasTotalComponents ? roughCurve(totalComponentsPoints, { roughness: 0.7, random }) : '';

  // Legend box (top left of plot)
  const legendX = padding.left + 15;
  const legendY = padding.top + 12;
  const legendW = 300;
  const legendH = hasTotalComponents ? 58 : 38;
  const legendBoxPath = roughRect(legendX, legendY, legendW, legendH, { roughness: 0.9, overshoot: 2, random });

  const safeTitle = escapeXml(title);
  const latestEntry = validHistory[validHistory.length - 1];

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" height="100%" style="background-color: var(--bg-color, #ffffff); font-family: 'Comic Sans MS', 'Chalkboard SE', 'Virgil', 'Segoe Print', ui-sans-serif, system-ui, sans-serif;">
  <defs>
    <style>
      :root {
        --bg-color: #ffffff;
        --border-color: #1e293b;
        --text-primary: #0f172a;
        --text-secondary: #475569;
        --grid-color: #e2e8f0;
        --components-color: #16a34a;
        --total-color: #dc2626;
        --legend-bg: #ffffff;
      }
      @media (prefers-color-scheme: dark) {
        :root {
          --bg-color: #0d1117;
          --border-color: #e6edf3;
          --text-primary: #f0f6fc;
          --text-secondary: #8b949e;
          --grid-color: #21262d;
          --components-color: #22c55e;
          --total-color: #f87171;
          --legend-bg: #161b22;
        }
      }
      ${
        theme === 'dark'
          ? `
        :root {
          --bg-color: #0d1117;
          --border-color: #e6edf3;
          --text-primary: #f0f6fc;
          --text-secondary: #8b949e;
          --grid-color: #21262d;
          --components-color: #22c55e;
          --total-color: #f87171;
          --legend-bg: #161b22;
        }
      `
          : theme === 'light'
            ? `
        :root {
          --bg-color: #ffffff;
          --border-color: #1e293b;
          --text-primary: #0f172a;
          --text-secondary: #475569;
          --grid-color: #e2e8f0;
          --components-color: #16a34a;
          --total-color: #dc2626;
          --legend-bg: #ffffff;
        }
      `
            : ''
      }
      .axis { stroke: var(--border-color); stroke-width: 2.2; fill: none; stroke-linecap: round; stroke-linejoin: round; }
      .grid { stroke: var(--grid-color); stroke-width: 1.2; stroke-dasharray: 4,4; fill: none; }
      .components-line { stroke: var(--components-color); stroke-width: 2.8; fill: none; stroke-linecap: round; stroke-linejoin: round; }
      .total-line { stroke: var(--total-color); stroke-width: 2.8; fill: none; stroke-linecap: round; stroke-linejoin: round; }
      .legend-box { stroke: var(--border-color); stroke-width: 1.6; fill: var(--legend-bg); }
      .title-text { fill: var(--text-primary); font-size: 20px; font-weight: bold; text-anchor: middle; }
      .label-text { fill: var(--text-secondary); font-size: 13px; font-weight: 500; }
      .axis-label { fill: var(--text-primary); font-size: 14px; font-weight: 600; text-anchor: middle; }
      .watermark { fill: var(--text-secondary); font-size: 11px; text-anchor: end; opacity: 0.8; }
    </style>
  </defs>

  <!-- Background rect with soft corner -->
  <rect width="${width}" height="${height}" rx="10" fill="var(--bg-color)" />

  <!-- Title & Icon -->
  <g id="title-group">
    <text x="${width / 2}" y="38" class="title-text">✨ ${safeTitle}</text>
  </g>

  <!-- Grid lines -->
  <g id="grid-group">
    ${gridPaths.map(g => `<path d="${g.d}" class="grid" />`).join('\n    ')}
  </g>

  <!-- Axes -->
  <g id="axes-group">
    <path d="${axisYPath}" class="axis" />
    <path d="${axisXPath}" class="axis" />
  </g>

  <!-- Y Tick Labels -->
  <g id="y-labels">
    ${yTicks.map(t => `<text x="${padding.left - 12}" y="${(t.y + 4).toFixed(1)}" class="label-text" text-anchor="end">${t.value}</text>`).join('\n    ')}
    <text x="${padding.left - 48}" y="${(padding.top + plotHeight / 2).toFixed(1)}" class="axis-label" transform="rotate(-90 ${padding.left - 48} ${(padding.top + plotHeight / 2).toFixed(1)})">Count</text>
  </g>

  <!-- X Tick Labels -->
  <g id="x-labels">
    ${xTicks
      .map(
        t => `
      <path d="${t.tickD}" class="axis" />
      <text x="${t.x.toFixed(1)}" y="${(padding.top + plotHeight + 24).toFixed(1)}" class="label-text" text-anchor="middle">${escapeXml(t.label)}</text>
    `
      )
      .join('')}
    <text x="${(padding.left + plotWidth / 2).toFixed(1)}" y="${height - 14}" class="axis-label">Date</text>
  </g>

  <!-- Series Curves -->
  <g id="series-curves">
    ${
      hasTotalComponents
        ? `
    <!-- Total Components Curve -->
    <path d="${totalComponentsPath1}" class="total-line" />
    <path d="${totalComponentsPath2}" class="total-line" opacity="0.6" />
    `
        : ''
    }

    <!-- Covered Components Curve -->
    <path d="${componentsPath1}" class="components-line" />
    <path d="${componentsPath2}" class="components-line" opacity="0.6" />

  </g>

  <!-- Data Point Markers -->
  <g id="data-points">
    ${
      hasTotalComponents
        ? totalComponentsPoints
            .map(
              p => `
      <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="4" fill="var(--total-color)" stroke="var(--bg-color)" stroke-width="1.5" />
    `
            )
            .join('')
        : ''
    }
    ${componentsPoints
      .map(
        p => `
      <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="4.5" fill="var(--components-color)" stroke="var(--bg-color)" stroke-width="1.5" />
    `
      )
      .join('')}
  </g>

  <!-- Legend Box -->
  <g id="legend" transform="translate(0, 0)">
    <rect x="${legendX}" y="${legendY}" width="${legendW}" height="${legendH}" rx="4" fill="var(--legend-bg)" />
    <path d="${legendBoxPath}" class="legend-box" fill="none" />

    <!-- Covered Components Legend Item -->
    <rect x="${legendX + 14}" y="${legendY + 12}" width="14" height="10" rx="2" fill="var(--components-color)" />
    <text x="${legendX + 36}" y="${legendY + 21}" class="label-text" font-weight="bold">Covered Components (${latestEntry.components}${latestEntry.coveragePercent !== undefined ? ` • ${latestEntry.coveragePercent}%` : ''})</text>

    ${
      hasTotalComponents
        ? `
    <!-- Total Components Legend Item -->
    <rect x="${legendX + 14}" y="${legendY + 32}" width="14" height="10" rx="2" fill="var(--total-color)" />
    <text x="${legendX + 36}" y="${legendY + 41}" class="label-text" font-weight="bold">Total Components (${latestEntry.totalComponents || latestEntry.components})</text>
    `
        : ''
    }
  </g>

  <!-- Footer / Watermark -->
  <g id="watermark">
    <text x="${width - 20}" y="${height - 14}" class="watermark">storybook-github-pages</text>
  </g>
</svg>`;
}

/**
 * Updates or creates the history ledger file (history.json).
 */
export function updateHistoryLedger({ existingHistory = [], currentSnapshot, maxEntries = 150 } = {}) {
  const history = Array.isArray(existingHistory) ? [...existingHistory] : [];

  if (currentSnapshot) {
    const entry = {
      timestamp: currentSnapshot.timestamp || new Date().toISOString(),
      date: currentSnapshot.date || new Date().toISOString().slice(0, 10),
      commit: currentSnapshot.commit || '',
      version: currentSnapshot.version || '',
      components: Number(currentSnapshot.components || 0),
      totalComponents:
        currentSnapshot.totalComponents !== undefined ? Number(currentSnapshot.totalComponents) : undefined,
      coveragePercent:
        currentSnapshot.coveragePercent !== undefined ? Number(currentSnapshot.coveragePercent) : undefined,
      stories: Number(currentSnapshot.stories || 0),
      docs: Number(currentSnapshot.docs || 0)
    };

    // If latest entry is on the same commit and has same counts, update timestamp rather than duplicating
    const last = history[history.length - 1];
    if (
      last &&
      last.commit &&
      entry.commit &&
      last.commit === entry.commit &&
      last.components === entry.components &&
      last.totalComponents === entry.totalComponents &&
      last.stories === entry.stories
    ) {
      history[history.length - 1] = { ...last, ...entry };
    } else {
      history.push(entry);
    }
  }

  // Cap max entries
  if (history.length > maxEntries) {
    history.splice(0, history.length - maxEntries);
  }

  return history;
}

/**
 * Generates statistics graph (history.svg) and updates the ledger (history.json).
 */
export function generateStatsGraph({
  staticDir,
  workspaceRoot = process.cwd(),
  pagesRepo = '',
  statsDirectory = 'stats',
  siteUrl = '',
  basePath = '',
  commitSha = process.env.GITHUB_SHA || '',
  currentSnapshot = null,
  includePaths = [],
  ignorePaths = [],
  theme = 'auto'
} = {}) {
  if (!staticDir || typeof staticDir !== 'string') {
    throw new Error('generateStatsGraph requires a valid staticDir');
  }

  const staticAbs = path.resolve(staticDir);
  if (!fs.existsSync(staticAbs)) {
    throw new Error(`Static directory "${staticAbs}" does not exist`);
  }

  const statsDirName = statsDirectory && statsDirectory !== '.' ? statsDirectory : 'stats';
  const outDir = path.resolve(staticAbs, statsDirName);

  // Path containment guard
  const relative = path.relative(staticAbs, outDir);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Stats directory "${statsDirectory}" escapes static output directory "${staticAbs}"`);
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

  // 1. Read existing history from pagesRepo (if available) or staticDir
  let existingHistory = [];
  const candidateHistoryPaths = [];

  if (pagesRepo) {
    candidateHistoryPaths.push(path.join(path.resolve(pagesRepo), statsDirName, 'history.json'));
    candidateHistoryPaths.push(path.join(path.resolve(pagesRepo), 'history.json'));
  }
  candidateHistoryPaths.push(path.join(outDir, 'history.json'));

  for (const histPath of candidateHistoryPaths) {
    if (fs.existsSync(histPath)) {
      try {
        const raw = JSON.parse(fs.readFileSync(histPath, 'utf8'));
        if (Array.isArray(raw) && raw.length > 0) {
          existingHistory = raw;
          break;
        }
      } catch {
        // Continue fallback
      }
    }
  }

  // 2. Determine the current snapshot to append to history. When the caller
  // supplies `currentSnapshot` (the trusted publisher does, from the
  // artifact the untrusted build already computed against the real PR
  // source), use it verbatim instead of recomputing: at publish time
  // `staticDir`/`workspaceRoot` are only the built static output, not the
  // PR's source tree, so a fresh scan would silently undercount
  // `totalComponents`/`coveragePercent`.
  const metrics = currentSnapshot
    ? {
        storiesCount: Number(currentSnapshot.stories || 0),
        componentsCount: Number(currentSnapshot.components || 0),
        totalComponents: currentSnapshot.totalComponents,
        coveragePercent: currentSnapshot.coveragePercent,
        docsCount: Number(currentSnapshot.docs || 0),
        storybookVersion: currentSnapshot.version || ''
      }
    : extractStorybookMetrics(staticAbs, workspaceRoot, { includePaths, ignorePaths });

  const snapshotForLedger = currentSnapshot || {
    timestamp: new Date().toISOString(),
    date: new Date().toISOString().slice(0, 10),
    commit: commitSha ? commitSha.slice(0, 7) : '',
    version: metrics.storybookVersion,
    components: metrics.componentsCount,
    totalComponents: metrics.totalComponents,
    coveragePercent: metrics.coveragePercent,
    stories: metrics.storiesCount,
    docs: metrics.docsCount
  };

  const updatedHistory = updateHistoryLedger({
    existingHistory,
    currentSnapshot: snapshotForLedger
  });

  // 3. Write history.json
  const historyJsonPath = path.join(outDir, 'history.json');
  fs.writeFileSync(historyJsonPath, JSON.stringify(updatedHistory, null, 2), 'utf8');

  // 4. Render hand-drawn SVG graph
  const svgContent = renderHandDrawnChartSvg({
    history: updatedHistory,
    title: 'Storybook Component & Story Growth',
    theme
  });

  const historySvgPath = path.join(outDir, 'history.svg');
  fs.writeFileSync(historySvgPath, svgContent, 'utf8');

  // Calculate full URL for markdown snippets
  let derivedStatsUrl = '';
  if (siteUrl) {
    const cleanSite = siteUrl.replace(/\/$/, '');
    const cleanBase = basePath ? `/${basePath.replace(/^\/|\/$/g, '')}` : '';
    derivedStatsUrl = `${cleanSite}${cleanBase}/${statsDirName}`;
  } else {
    derivedStatsUrl = statsDirName;
  }

  const markdownSnippet = `[![Storybook Growth History](${derivedStatsUrl}/history.svg)](${siteUrl || derivedStatsUrl})`;

  return {
    metrics,
    outDir,
    statsDirectory: statsDirName,
    derivedStatsUrl,
    markdownSnippet,
    historyCount: updatedHistory.length,
    historyJsonPath,
    historySvgPath
  };
}

if (process.argv[1] && process.argv[1].endsWith('generate-stats.js')) {
  const staticDir = process.argv[2] || process.env.SB_PATH || 'storybook-static';
  const workspaceRoot = process.argv[3] || process.env.WORKSPACE_ROOT || process.cwd();
  const pagesRepo = process.env.PAGES_REPO || process.argv[4] || '';
  const statsDir = process.env.SB_STATS_DIRECTORY || 'stats';
  const siteUrl = process.env.SB_SITE_URL || '';
  const basePath = process.env.SB_BASE_PATH || '';
  const commitSha = process.env.GITHUB_SHA || '';
  const includePaths = process.env.SB_COVERAGE_INCLUDE_PATHS || '';
  const ignorePaths = process.env.SB_COVERAGE_IGNORE_PATHS || '';

  try {
    const result = generateStatsGraph({
      staticDir,
      workspaceRoot,
      pagesRepo,
      statsDirectory: statsDir,
      siteUrl,
      basePath,
      commitSha,
      includePaths,
      ignorePaths
    });

    console.log(`✅ Hand-drawn growth graph generated in "${result.outDir}":`);
    console.log(`   • Data points: ${result.historyCount}`);
    console.log(`   • SVG Chart: ${result.historySvgPath}`);
    console.log(`   • Ledger: ${result.historyJsonPath}`);
    console.log('');
    console.log('Markdown snippet:');
    console.log(result.markdownSnippet);

    if (process.env.GITHUB_STEP_SUMMARY) {
      const summaryContent = ['', '### 📈 Storybook Growth History', '', result.markdownSnippet, ''].join('\n');
      fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summaryContent);
    }
  } catch (err) {
    console.error('Stats generation error:', err.message);
    process.exit(1);
  }
}
