import fs from 'node:fs/promises';
import path from 'node:path';
import { resolvePreviewTarget } from './preview-metadata.js';
import { resolveConfiguration } from './config.js';
import { withSerializedBranchWrite, requestPagesRebuild } from './git-branch-writer.js';
import { updatePreviewCommentStatus } from './preview-comment.js';
import { deactivateDeploymentsForPullRequest } from './github-deployments.js';

async function pathExists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

/**
 * Removes exactly one PR's preview directory from a checked-out Pages
 * branch. This is metadata-only: the caller supplies nothing but a PR
 * number and the (already validated) preview root, never any PR-controlled
 * file content. A missing directory is treated as a successful no-op so
 * cleanup remains idempotent across retries and duplicate close events.
 */
export async function removePreviewDirectory({ repo, branch = 'gh-pages', previewRoot = 'pr-preview', prNumber }) {
  const target = resolvePreviewTarget({ previewRoot, prNumber });
  if (!(await pathExists(repo))) {
    return { target, changed: false, skipped: true, reason: 'Pages repository directory does not exist' };
  }
  const result = await withSerializedBranchWrite({
    repo,
    branch,
    commitMessage: `Remove Storybook preview for closed PR #${Number(prNumber)}`,
    mutate: async repoPath => {
      const full = path.join(repoPath, target);
      if (!(await pathExists(full))) return false;
      await fs.rm(full, { recursive: true, force: true });
      return true;
    }
  });
  return { target, ...result };
}

export async function requestCleanupPagesRebuild({
  token,
  repository,
  commitSha,
  requestRebuild = requestPagesRebuild
}) {
  try {
    await requestRebuild({ token, repository, commitSha });
    return { ok: true };
  } catch (error) {
    const message = `Preview cleanup removed the directory, but the optional Pages rebuild failed: ${error.message}`;
    console.warn(message);
    return { ok: false, message };
  }
}

export async function requestCleanupCommentUpdate({
  token,
  repository,
  prNumber,
  updateStatus = updatePreviewCommentStatus
}) {
  try {
    await updateStatus({ token, repository, prNumber, expired: true });
    return { ok: true };
  } catch (error) {
    const message = `Preview cleanup removed the directory, but the optional preview comment update failed: ${error.message}`;
    console.warn(message);
    return { ok: false, message };
  }
}

if (process.argv[1] && process.argv[1].endsWith('preview-cleanup.js')) {
  const config = resolveConfiguration({
    inputs: {
      preview_root: process.env.PREVIEW_ROOT,
      pages_branch: process.env.PAGES_BRANCH
    }
  });

  removePreviewDirectory({
    repo: process.env.PAGES_REPO || process.cwd(),
    branch: config.pages_branch || process.env.PAGES_BRANCH || 'gh-pages',
    previewRoot: config.preview_root,
    prNumber: process.env.PR_NUMBER
  })
    .then(async result => {
      console.log(JSON.stringify(result));
      const prNumber = Number(process.env.PR_NUMBER || 0);
      if (
        result.changed &&
        process.env.GITHUB_TOKEN &&
        process.env.GITHUB_REPOSITORY &&
        Number.isFinite(prNumber) &&
        prNumber > 0
      ) {
        const deploymentEnvironment =
          process.env.DEPLOYMENT_ENVIRONMENT ||
          process.env.ENVIRONMENT_NAME ||
          process.env.ENVIRONMENT ||
          `pr-preview-${prNumber}`;
        await deactivateDeploymentsForPullRequest({
          token: process.env.GITHUB_TOKEN,
          repository: process.env.GITHUB_REPOSITORY,
          environmentName: deploymentEnvironment,
          prNumber,
          description: `Preview cleanup for PR #${prNumber}`
        });
        await requestCleanupPagesRebuild({
          token: process.env.GITHUB_TOKEN,
          repository: process.env.GITHUB_REPOSITORY,
          commitSha: result.commitSha
        });
        await requestCleanupCommentUpdate({
          token: process.env.GITHUB_TOKEN,
          repository: process.env.GITHUB_REPOSITORY,
          prNumber: process.env.PR_NUMBER
        });
      }
      if (process.env.GITHUB_STEP_SUMMARY) {
        const message = result.changed
          ? `### Storybook preview cleanup\n\nRemoved \`${result.target}\` for the closed pull request.\n`
          : result.skipped
            ? `### Storybook preview cleanup\n\nPages repository does not exist; skipped preview cleanup.\n`
            : `### Storybook preview cleanup\n\nNo preview directory existed at \`${result.target}\`; nothing to remove.\n`;
        await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, message);
      }
    })
    .catch(error => {
      console.error(error.message);
      process.exit(1);
    });
}
