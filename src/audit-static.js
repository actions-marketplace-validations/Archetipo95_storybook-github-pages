import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

// Static bundle-size audit for a built Storybook directory. Zero runtime
// dependencies: walks the output, classifies assets, estimates gzip transfer
// size, and renders a markdown scorecard for $GITHUB_STEP_SUMMARY and the PR
// preview comment.

export const AUDIT_DIRECTORY = 'audit';
export const BUNDLE_REPORT_FILENAME = 'bundle-size.json';
const MB = 1024 * 1024;

const CATEGORY_BY_EXTENSION = {
  '.js': 'js',
  '.mjs': 'js',
  '.cjs': 'js',
  '.css': 'css',
  '.woff': 'font',
  '.woff2': 'font',
  '.ttf': 'font',
  '.otf': 'font',
  '.eot': 'font',
  '.png': 'image',
  '.jpg': 'image',
  '.jpeg': 'image',
  '.gif': 'image',
  '.webp': 'image',
  '.avif': 'image',
  '.svg': 'image',
  '.ico': 'image',
  '.html': 'html',
  '.htm': 'html',
  '.map': 'sourcemap',
  '.json': 'data'
};
// Already-compressed binary formats gain nothing from gzip; count them as-is.
const INCOMPRESSIBLE = new Set(['.woff', '.woff2', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.ico']);
export const CATEGORIES = ['js', 'css', 'font', 'image', 'html', 'data', 'sourcemap', 'other'];
const CATEGORY_LABELS = {
  js: 'JavaScript',
  css: 'CSS',
  font: 'Fonts',
  image: 'Images',
  html: 'HTML',
  data: 'JSON',
  sourcemap: 'Source maps',
  other: 'Other'
};

export function categorize(filePath) {
  return CATEGORY_BY_EXTENSION[path.extname(filePath).toLowerCase()] || 'other';
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '-';
  const sign = bytes < 0 ? '-' : '';
  const value = Math.abs(bytes);
  if (value < 1024) return `${sign}${value} B`;
  if (value < MB) return `${sign}${(value / 1024).toFixed(1)} KB`;
  return `${sign}${(value / MB).toFixed(2)} MB`;
}

export function parseBudgetMb(value) {
  if (value === undefined || value === null || value === '') return null;
  const mb = Number(value);
  if (!Number.isFinite(mb) || mb <= 0) {
    throw new Error(`bundle_size_max_mb must be a positive number, got "${value}"`);
  }
  return mb;
}

function walk(rootDir, currentDir, files, excluded) {
  for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
    const fullPath = path.join(currentDir, entry.name);
    const relative = path.relative(rootDir, fullPath).split(path.sep).join('/');
    if (entry.isDirectory()) {
      if (excluded.has(relative)) continue;
      walk(rootDir, fullPath, files, excluded);
    } else if (entry.isFile()) {
      files.push({ fullPath, relative });
    }
  }
}

/**
 * Computes the asset breakdown for a static Storybook directory. The
 * `audit/` output directory itself is always excluded so re-running the
 * audit is idempotent.
 */
export function auditBundleSize({ staticDir, maxMb = null, topN = 10, excludeDirectories = [] } = {}) {
  if (!staticDir || !fs.existsSync(staticDir) || !fs.statSync(staticDir).isDirectory()) {
    throw new Error(`Bundle audit failed: static directory "${staticDir}" does not exist.`);
  }
  const budgetMb = parseBudgetMb(maxMb);
  const files = [];
  walk(staticDir, staticDir, files, new Set([AUDIT_DIRECTORY, ...excludeDirectories]));

  const categories = Object.fromEntries(CATEGORIES.map(key => [key, { files: 0, bytes: 0, gzipBytes: 0 }]));
  const assets = files.map(({ fullPath, relative }) => {
    const content = fs.readFileSync(fullPath);
    const ext = path.extname(relative).toLowerCase();
    const gzipBytes = INCOMPRESSIBLE.has(ext) ? content.length : zlib.gzipSync(content, { level: 9 }).length;
    const category = categorize(relative);
    categories[category].files += 1;
    categories[category].bytes += content.length;
    categories[category].gzipBytes += gzipBytes;
    return { path: relative, category, bytes: content.length, gzipBytes };
  });

  const totalBytes = assets.reduce((sum, asset) => sum + asset.bytes, 0);
  const totalGzipBytes = assets.reduce((sum, asset) => sum + asset.gzipBytes, 0);
  const largest = [...assets].sort((a, b) => b.bytes - a.bytes || a.path.localeCompare(b.path)).slice(0, topN);
  const budget =
    budgetMb === null
      ? null
      : { maxMb: budgetMb, maxBytes: Math.round(budgetMb * MB), exceeded: totalBytes > budgetMb * MB };

  return {
    version: 1,
    totalFiles: assets.length,
    totalBytes,
    totalGzipBytes,
    categories,
    largest,
    budget
  };
}

/**
 * Normalizes a report read from disk (for example the base branch report on
 * the Pages branch) so only well-formed numeric fields are ever rendered.
 */
export function sanitizeBundleReport(report) {
  if (!report || typeof report !== 'object') return null;
  if (!Number.isFinite(report.totalBytes) || !Number.isFinite(report.totalGzipBytes)) return null;
  const categories = {};
  for (const key of CATEGORIES) {
    const value = report.categories?.[key];
    categories[key] = {
      files: Number.isFinite(value?.files) ? value.files : 0,
      bytes: Number.isFinite(value?.bytes) ? value.bytes : 0,
      gzipBytes: Number.isFinite(value?.gzipBytes) ? value.gzipBytes : 0
    };
  }
  return {
    totalFiles: Number.isFinite(report.totalFiles) ? report.totalFiles : 0,
    totalBytes: report.totalBytes,
    totalGzipBytes: report.totalGzipBytes,
    categories
  };
}

// Asset names come from build output (and, for PR previews, from untrusted
// pull requests). Keep them inert inside markdown tables and code spans.
export function safeAssetName(name, maxLength = 80) {
  const cleaned = String(name).replace(/[`|<>\r\n\t\\[\]]/g, '_');
  return cleaned.length > maxLength ? `…${cleaned.slice(-(maxLength - 1))}` : cleaned;
}

function formatDelta(base, current) {
  if (!Number.isFinite(base) || !Number.isFinite(current)) return '-';
  const diff = current - base;
  if (diff === 0) return '0 B';
  const percent = base > 0 ? ` (${diff > 0 ? '+' : ''}${((diff / base) * 100).toFixed(1)}%)` : '';
  return `${diff > 0 ? '+' : ''}${formatBytes(diff)}${percent} ${diff > 0 ? '📈' : '📉'}`;
}

export function formatBundleReport(report, { baseReport = null, heading = '### 📦 Bundle Size', topN = 10 } = {}) {
  const base = sanitizeBundleReport(baseReport);
  const lines = [heading, ''];

  if (base) {
    lines.push('| Payload | Base | Current | Change |', '| :--- | ---: | ---: | ---: |');
    lines.push(
      `| **Total** (${report.totalFiles} files) | ${formatBytes(base.totalBytes)} | ${formatBytes(report.totalBytes)} | ${formatDelta(base.totalBytes, report.totalBytes)} |`,
      `| **Total (gzip est.)** | ${formatBytes(base.totalGzipBytes)} | ${formatBytes(report.totalGzipBytes)} | ${formatDelta(base.totalGzipBytes, report.totalGzipBytes)} |`
    );
    for (const key of ['js', 'css', 'font']) {
      lines.push(
        `| ${CATEGORY_LABELS[key]} | ${formatBytes(base.categories[key].bytes)} | ${formatBytes(report.categories[key].bytes)} | ${formatDelta(base.categories[key].bytes, report.categories[key].bytes)} |`
      );
    }
  } else {
    lines.push('| Payload | Files | Size | Gzip (est.) |', '| :--- | ---: | ---: | ---: |');
    lines.push(
      `| **Total** | ${report.totalFiles} | ${formatBytes(report.totalBytes)} | ${formatBytes(report.totalGzipBytes)} |`
    );
    for (const key of CATEGORIES) {
      const category = report.categories[key];
      if (!category || category.files === 0) continue;
      lines.push(
        `| ${CATEGORY_LABELS[key]} | ${category.files} | ${formatBytes(category.bytes)} | ${formatBytes(category.gzipBytes)} |`
      );
    }
  }
  lines.push('');

  if (report.budget) {
    lines.push(
      report.budget.exceeded
        ? `> ❌ **Budget exceeded:** ${formatBytes(report.totalBytes)} is over the ${report.budget.maxMb} MB limit.`
        : `> ✅ Within the ${report.budget.maxMb} MB budget.`,
      ''
    );
  }

  const largest = (report.largest || []).slice(0, topN);
  if (largest.length > 0) {
    lines.push(
      '<details>',
      `<summary>Top ${largest.length} largest assets</summary>`,
      '',
      '| Asset | Size | Gzip (est.) |',
      '| :--- | ---: | ---: |'
    );
    for (const asset of largest) {
      lines.push(
        `| \`${safeAssetName(asset.path)}\` | ${formatBytes(asset.bytes)} | ${formatBytes(asset.gzipBytes)} |`
      );
    }
    lines.push('', '</details>', '');
  }

  return lines.join('\n');
}

export function writeBundleReport(staticDir, report) {
  const auditDir = path.join(staticDir, AUDIT_DIRECTORY);
  fs.mkdirSync(auditDir, { recursive: true });
  const reportPath = path.join(auditDir, BUNDLE_REPORT_FILENAME);
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  return reportPath;
}

export function readBundleReport(staticDir) {
  const reportPath = path.join(staticDir, AUDIT_DIRECTORY, BUNDLE_REPORT_FILENAME);
  if (!fs.existsSync(reportPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  } catch {
    return null;
  }
}

function resolveStaticDirectory(staticPath, workspaceRoot) {
  const root = path.resolve(workspaceRoot);
  const target = path.resolve(root, staticPath);
  const relative = path.relative(root, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Bundle audit failed: path "${staticPath}" escapes the workspace root.`);
  }
  return target;
}

export function runBundleAudit({
  staticPath,
  workspaceRoot = process.cwd(),
  maxMb = null,
  summaryPath = process.env.GITHUB_STEP_SUMMARY
} = {}) {
  const staticDir = resolveStaticDirectory(staticPath, workspaceRoot);
  const report = auditBundleSize({ staticDir, maxMb });
  writeBundleReport(staticDir, report);
  const markdown = formatBundleReport(report);
  if (summaryPath) fs.appendFileSync(summaryPath, `${markdown}\n`);
  return { report, markdown };
}

if (process.argv[1] && process.argv[1].endsWith('audit-static.js')) {
  const [staticPath = process.env.SB_PATH || 'storybook-static', workspaceRoot = process.cwd()] = process.argv.slice(2);
  try {
    const { report, markdown } = runBundleAudit({
      staticPath,
      workspaceRoot,
      maxMb: process.env.SB_BUNDLE_SIZE_MAX_MB || null
    });
    console.log(markdown);
    if (report.budget?.exceeded) {
      console.error(
        `❌ Bundle size ${formatBytes(report.totalBytes)} exceeds the ${report.budget.maxMb} MB budget (bundle_size_max_mb).`
      );
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(`❌ ${error.message}`);
    process.exitCode = 1;
  }
}
