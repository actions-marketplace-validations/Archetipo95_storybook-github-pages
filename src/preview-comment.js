// Idempotent bot-owned PR comment for published previews. A stable HTML
// comment marker (unique per PR) lets us find and update our own comment
// on every publish instead of accumulating a new comment per commit.

const MARKER_PREFIX = '<!-- storybook-pages-preview:pr-';
const MARKER_SUFFIX = ' -->';
const STATUS_MARKER = '<!-- storybook-pages-preview-status -->';
const STATUS_END_MARKER = '<!-- /storybook-pages-preview-status -->';
export const PREVIEW_COMMENT_AUTHOR = 'github-actions[bot]';

export function buildMarker(prNumber) {
  const number = Number(prNumber);
  if (!Number.isInteger(number) || number <= 0) {
    throw new Error(`Invalid PR number for preview comment marker: "${prNumber}"`);
  }
  return `${MARKER_PREFIX}${number}${MARKER_SUFFIX}`;
}

export function buildExpirationStatus({ expired = false, warningDays = 3 } = {}) {
  if (expired) {
    return `${STATUS_MARKER}
> ⚠️ **This Storybook preview has expired and was removed after being inactive.** Rerun the preview workflow or push a new commit to rebuild it.
${STATUS_END_MARKER}`;
  }
  return `${STATUS_MARKER}
> ⏳ **This Storybook preview will be removed in ${warningDays} day${warningDays === 1 ? '' : 's'} due to inactivity.** Push a new commit or rerun the preview workflow to keep it available.
${STATUS_END_MARKER}`;
}

function replaceExpirationStatus(body, status) {
  const block = `${STATUS_MARKER}[\\s\\S]*?${STATUS_END_MARKER}`;
  if (new RegExp(block).test(body)) return body.replace(new RegExp(block), status);
  const insertionPoint = body.indexOf('\n<sub>');
  return insertionPoint === -1
    ? `${body}\n\n${status}`
    : `${body.slice(0, insertionPoint)}\n\n${status}${body.slice(insertionPoint)}`;
}

function formatDiff(baseVal, prVal, isPercent = false) {
  if (typeof baseVal !== 'number' || typeof prVal !== 'number') return '-';
  const diff = prVal - baseVal;
  const unit = isPercent ? '%' : '';
  if (diff > 0) {
    return `+${diff}${unit} 📈`;
  } else if (diff < 0) {
    return `${diff}${unit} 📉`;
  }
  return `0${unit}`;
}

export function buildCommentBody({
  prNumber,
  previewUrl,
  headSha,
  runId,
  repository,
  metrics = null,
  baseMetrics = null,
  hasBadges = false,
  hasStatsGraph = false
}) {
  if (typeof previewUrl !== 'string' || previewUrl === '') {
    throw new Error('previewUrl is required to build a preview comment body');
  }
  if (typeof headSha !== 'string' || !/^[0-9a-f]{40}$/.test(headSha)) {
    throw new Error(`Invalid headSha "${headSha}" for preview comment body`);
  }
  const marker = buildMarker(prNumber);
  const shortSha = headSha.slice(0, 7);
  const runLink = repository && runId ? `https://github.com/${repository}/actions/runs/${runId}` : null;
  const runNote = runLink ? `[run ${runId}](${runLink})` : `run ${runId ?? 'unknown'}`;
  const cleanPreviewUrl = previewUrl.replace(/\/+$/, '');
  const vParam = `?v=${shortSha}`;

  const lines = [marker, '## 📖 Storybook preview', ''];

  // Badges row
  if (hasBadges || metrics) {
    const badges = [
      `[![Coverage](${cleanPreviewUrl}/badges/coverage.svg${vParam})](${cleanPreviewUrl})`,
      `[![Stories](${cleanPreviewUrl}/badges/stories.svg${vParam})](${cleanPreviewUrl})`,
      `[![Components](${cleanPreviewUrl}/badges/components.svg${vParam})](${cleanPreviewUrl})`,
      ...(metrics && metrics.tests
        ? [`[![Tests](${cleanPreviewUrl}/badges/tests.svg${vParam})](${cleanPreviewUrl})`]
        : []),
      `[![Status](${cleanPreviewUrl}/badges/status.svg${vParam})](${cleanPreviewUrl})`
    ];
    lines.push(badges.join(' '), '');
  }

  lines.push(`**Preview URL:** ${cleanPreviewUrl}`, '');

  if (metrics && metrics.tests && typeof metrics.tests.total === 'number') {
    const tests = metrics.tests;
    const passedRatio = tests.total > 0 ? `${tests.passed}/${tests.total} passed` : '0/0 passed';
    const failedRatio = tests.total > 0 ? `${tests.failed}/${tests.total} failed` : '0/0 failed';
    const ciLink = runLink ? `**CI run:** ${runNote}` : `**CI run:** ${runNote}`;
    lines.push(
      '### 🧪 Interaction Test Results',
      '',
      `- **Result:** ${tests.failed === 0 ? passedRatio : failedRatio}`
    );
    lines.push(`- **Passed:** ${tests.passed} / **Failed:** ${tests.failed} / **Total:** ${tests.total}`);
    lines.push(`${ciLink}`, '');
  }

  // Metrics comparison table
  if (metrics && typeof metrics.storiesCount === 'number') {
    const hasBase = baseMetrics && typeof baseMetrics.storiesCount === 'number';

    lines.push('### 📊 Metrics & Coverage Comparison', '');

    if (hasBase) {
      lines.push('| Metric | Base | PR Preview | Change |');
      lines.push('| :--- | :---: | :---: | :---: |');

      const baseCov = typeof baseMetrics.coveragePercent === 'number' ? baseMetrics.coveragePercent : null;
      const prCov = typeof metrics.coveragePercent === 'number' ? metrics.coveragePercent : null;

      let baseCompCov = '-';
      if (typeof baseMetrics.componentsCount === 'number' && typeof baseMetrics.totalComponents === 'number') {
        baseCompCov = `${baseCov !== null ? `${baseCov}% ` : ''}(${baseMetrics.componentsCount}/${baseMetrics.totalComponents})`;
      } else if (baseCov !== null) {
        baseCompCov = `${baseCov}%`;
      }

      let prCompCov = '-';
      if (typeof metrics.componentsCount === 'number' && typeof metrics.totalComponents === 'number') {
        prCompCov = `${prCov !== null ? `${prCov}% ` : ''}(${metrics.componentsCount}/${metrics.totalComponents})`;
      } else if (prCov !== null) {
        prCompCov = `${prCov}%`;
      }

      let covDiff = '-';
      if (baseCov !== null && prCov !== null) {
        const diff = prCov - baseCov;
        if (diff > 0) covDiff = `**+${diff}%** 🟢`;
        else if (diff < 0) covDiff = `**${diff}%** 🔴`;
        else covDiff = `0%`;
      }

      lines.push(`| 🎯 **Component Coverage** | \`${baseCompCov}\` | \`${prCompCov}\` | ${covDiff} |`);

      const storiesDiff = formatDiff(baseMetrics.storiesCount, metrics.storiesCount);
      lines.push(`| 📚 **Stories** | ${baseMetrics.storiesCount} | ${metrics.storiesCount} | ${storiesDiff} |`);

      const compDiff = formatDiff(baseMetrics.componentsCount, metrics.componentsCount);
      lines.push(
        `| 🧩 **Documented Components** | ${baseMetrics.componentsCount} | ${metrics.componentsCount} | ${compDiff} |`
      );
    } else {
      lines.push('| Metric | PR Preview |');
      lines.push('| :--- | :---: |');

      const prCov = typeof metrics.coveragePercent === 'number' ? metrics.coveragePercent : null;
      let prCompCov = '-';
      if (typeof metrics.componentsCount === 'number' && typeof metrics.totalComponents === 'number') {
        prCompCov = `${prCov !== null ? `${prCov}% ` : ''}(${metrics.componentsCount}/${metrics.totalComponents})`;
      } else if (prCov !== null) {
        prCompCov = `${prCov}%`;
      }

      lines.push(`| 🎯 **Component Coverage** | \`${prCompCov}\` |`);
      lines.push(`| 📚 **Stories** | ${metrics.storiesCount} |`);
      lines.push(`| 🧩 **Documented Components** | ${metrics.componentsCount} |`);
    }
    lines.push('');
  }

  // Growth / History Chart
  if (hasStatsGraph) {
    lines.push(
      '<details>',
      '<summary>📈 <b>Storybook Coverage & Growth Chart</b></summary>',
      '<br />',
      '',
      `<img src="${cleanPreviewUrl}/stats/history.svg${vParam}" alt="Storybook Coverage History" width="100%" />`,
      '',
      '</details>',
      ''
    );
  }

  lines.push(
    `<sub>Built from commit \`${shortSha}\` (${runNote}). This comment is updated automatically as new commits are published; it is not recreated.</sub>`
  );
  return lines.join('\n');
}

async function githubRequest(url, { token, method = 'GET', body } = {}) {
  if (!token) throw new Error('githubRequest requires a token');
  const response = await fetch(url, {
    method,
    headers: {
      authorization: `token ${token}`,
      accept: 'application/vnd.github+json',
      'content-type': 'application/json'
    },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`GitHub API request failed (${response.status} ${method} ${url}): ${text}`);
  }
  return response.status === 204 ? null : response.json();
}

export async function findExistingComment({ token, repository, prNumber, marker }) {
  const number = Number(prNumber);
  if (!Number.isInteger(number) || number <= 0) {
    throw new Error(`Invalid PR number "${prNumber}"`);
  }
  let page = 1;
  const maxPages = 20; // guard against runaway pagination on pathological threads
  while (page <= maxPages) {
    const comments = await githubRequest(
      `https://api.github.com/repos/${repository}/issues/${number}/comments?per_page=100&page=${page}`,
      { token }
    );
    const marked = comments.filter(comment => typeof comment.body === 'string' && comment.body.includes(marker));
    const conflicting = marked.find(
      comment => comment.user?.login !== PREVIEW_COMMENT_AUTHOR || comment.user?.type !== 'Bot'
    );
    if (conflicting) {
      throw new Error(
        `Refusing to update comment ${conflicting.id}: preview marker is owned by a non-${PREVIEW_COMMENT_AUTHOR} account`
      );
    }
    if (marked.length > 0) return marked[0];
    if (comments.length < 100) return null;
    page += 1;
  }
  return null;
}

/**
 * Creates the bot preview comment on first publish, or updates the existing
 * one (found via the stable marker) on subsequent publishes. Never creates a
 * second comment for the same PR.
 */
export async function upsertPreviewComment({ token, repository, prNumber, body }) {
  if (!token) throw new Error('upsertPreviewComment requires a token');
  if (!repository) throw new Error('upsertPreviewComment requires a repository');
  const number = Number(prNumber);
  if (!Number.isInteger(number) || number <= 0) {
    throw new Error(`Invalid PR number "${prNumber}"`);
  }

  const marker = buildMarker(number);
  if (!body.includes(marker)) {
    throw new Error('Comment body must include the stable preview marker');
  }

  const existing = await findExistingComment({ token, repository, prNumber: number, marker });
  if (existing) {
    await githubRequest(`https://api.github.com/repos/${repository}/issues/comments/${existing.id}`, {
      token,
      method: 'PATCH',
      body: { body }
    });
    return { action: 'updated', commentId: existing.id };
  }

  const created = await githubRequest(`https://api.github.com/repos/${repository}/issues/${number}/comments`, {
    token,
    method: 'POST',
    body: { body }
  });
  return { action: 'created', commentId: created.id };
}

export async function updatePreviewCommentStatus({ token, repository, prNumber, expired = false, warningDays = 3 }) {
  const number = Number(prNumber);
  const marker = buildMarker(number);
  const existing = await findExistingComment({ token, repository, prNumber: number, marker });
  if (!existing) return { action: 'missing' };
  const body = replaceExpirationStatus(existing.body, buildExpirationStatus({ expired, warningDays }));
  if (body !== existing.body) {
    await githubRequest(`https://api.github.com/repos/${repository}/issues/comments/${existing.id}`, {
      token,
      method: 'PATCH',
      body: { body }
    });
  }
  return { action: body === existing.body ? 'unchanged' : 'updated', commentId: existing.id };
}

if (process.argv[1] && process.argv[1].endsWith('preview-comment.js')) {
  const prNumber = process.env.PR_NUMBER;
  const previewUrl = process.env.PREVIEW_URL;
  const headSha = process.env.HEAD_SHA;
  const runId = process.env.RUN_ID;
  const repository = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;

  const body = buildCommentBody({ prNumber, previewUrl, headSha, runId, repository });
  upsertPreviewComment({ token, repository, prNumber, body })
    .then(result => {
      console.log(`Preview comment ${result.action} (id ${result.commentId}) on PR #${prNumber}`);
    })
    .catch(error => {
      console.error(`Preview comment update failed: ${error.message}`);
      process.exit(1);
    });
}
