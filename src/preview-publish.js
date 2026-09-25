import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { resolveBaseDirectoryForRef } from './config.js';
import {
  decidePreviewAction,
  digestDirectory,
  PREVIEW_METADATA_FILENAME,
  PREVIEW_CONTENT_DIRNAME
} from './preview-metadata.js';
import { validateArtifactDirectory } from './validate-artifact.js';
import { publishDirectory } from './publish-directory.js';
import { buildCommentBody, upsertPreviewComment } from './preview-comment.js';
import { createDeployment, updateDeploymentStatus } from './github-deployments.js';
import { injectAuthGate } from './inject-auth-gate.js';
import { generateStatsGraph } from './generate-stats.js';

/**
 * Reads and parses the metadata file bundled inside the downloaded build
 * artifact. Throws with a clear message if it is missing or malformed -
 * this is the first line of defense against a build artifact that does not
 * conform to the expected schema.
 */
export function readBundleMetadata(bundleDir) {
  const metadataPath = path.join(bundleDir, PREVIEW_METADATA_FILENAME);
  if (!fs.existsSync(metadataPath)) {
    throw new Error(`Preview bundle is missing ${PREVIEW_METADATA_FILENAME} at "${metadataPath}"`);
  }
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
  } catch (error) {
    throw new Error(`Preview bundle metadata at "${metadataPath}" is not valid JSON: ${error.message}`);
  }
  return parsed;
}

/**
 * End-to-end trusted publish: validates the bundle metadata against the
 * trusted workflow_run context and the live PR head SHA, validates the
 * bundled static content, and only then publishes and comments. Every
 * rejection path (fork, stale run, provenance mismatch) is returned/thrown
 * before any write-capable operation runs.
 */
/**
 * Reads the exact "current PR" snapshot the untrusted build already wrote
 * into the artifact's own `<statsDirectory>/history.json` (a single entry,
 * computed by `generate-stats.js` against the real PR source tree - which
 * the trusted publisher must never check out or execute). Returns null when
 * absent/malformed so the caller can skip regeneration entirely rather than
 * recompute against the built static output, which lacks source files and
 * would silently misreport `totalComponents`/`coveragePercent`.
 */
export function readArtifactCurrentSnapshot(contentDir, statsDirectory = 'stats') {
  const historyPath = path.join(contentDir, statsDirectory, 'history.json');
  if (!fs.existsSync(historyPath)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(historyPath, 'utf8'));
    if (Array.isArray(raw) && raw.length > 0) return raw[raw.length - 1];
  } catch {
    // Malformed artifact stats file - treat as absent.
  }
  return null;
}

export function resolveBaseMetricsPath({
  pagesRepo,
  baseRef,
  targetDirectory = '',
  defaultBranch = 'main',
  refToDirectory = {}
} = {}) {
  if (!pagesRepo || typeof pagesRepo !== 'string') {
    throw new Error('pagesRepo is required to resolve the Pages base-metrics path');
  }

  const baseDirectory = resolveBaseDirectoryForRef(baseRef, {
    target_directory: targetDirectory,
    default_branch: defaultBranch,
    ref_to_directory: refToDirectory
  });

  return baseDirectory
    ? path.join(pagesRepo, baseDirectory, 'badges', 'overview.json')
    : path.join(pagesRepo, 'badges', 'overview.json');
}

export async function publishPreview({
  bundleDir,
  pagesRepo,
  trustedContext,
  currentHeadSha,
  pagesBranch = 'gh-pages',
  managedDirectories = [],
  siteUrl = '',
  basePath = '',
  triggerPagesRebuild = false,
  generateStatsGraph: generateStatsGraphEnabled = true,
  statsDirectory = 'stats',
  enablePasscodeGate = false,
  passcodeHash = '',
  passcodeSessionHours = 24,
  token,
  repository
}) {
  const metadata = readBundleMetadata(bundleDir);
  const decision = decidePreviewAction({ metadata, trustedContext, currentHeadSha });

  if (decision.action !== 'publish') {
    return { ...decision, metadata };
  }

  const shouldCreateDeployment = process.env.CREATE_DEPLOYMENT === 'true';
  const deploymentEnvironment =
    process.env.DEPLOYMENT_ENVIRONMENT ||
    process.env.ENVIRONMENT_NAME ||
    process.env.ENVIRONMENT ||
    `pr-preview-${metadata.prNumber}`;
  const deploymentDescription = `Storybook preview for PR #${metadata.prNumber}`;
  const deploymentLogUrl = trustedContext?.runId
    ? `https://github.com/${repository}/actions/runs/${trustedContext.runId}`
    : '';
  const explicitEnvironmentUrl = process.env.ENVIRONMENT_URL || '';

  let deploymentRecord = null;
  if (shouldCreateDeployment) {
    if (!token || !repository) {
      throw new Error(
        'create_deployment is enabled but no GitHub token/repository context was provided; cannot create the GitHub deployment record'
      );
    }
    deploymentRecord = await createDeployment({
      token,
      repository,
      ref: metadata.headSha,
      environmentName: deploymentEnvironment,
      environmentUrl: explicitEnvironmentUrl,
      logUrl: deploymentLogUrl,
      description: deploymentDescription,
      payload: {
        pr_number: metadata.prNumber,
        prNumber: metadata.prNumber,
        preview_root: metadata.previewRoot,
        target: metadata.target,
        repository: metadata.repository,
        base_ref: metadata.baseRef,
        head_sha: metadata.headSha,
        run_id: metadata.runId,
        action: 'publish'
      },
      productionEnvironment: false,
      transientEnvironment: true
    });
    if (!deploymentRecord || !deploymentRecord.id) {
      throw new Error('Failed to create the GitHub deployment record before publishing the preview');
    }
  }

  const contentDir = path.join(bundleDir, PREVIEW_CONTENT_DIRNAME);
  validateArtifactDirectory(PREVIEW_CONTENT_DIRNAME, bundleDir);
  const contentDigest = digestDirectory(contentDir);
  if (contentDigest !== metadata.contentDigest) {
    if (deploymentRecord && deploymentRecord.id && token && repository) {
      await updateDeploymentStatus({
        token,
        repository,
        deploymentId: deploymentRecord.id,
        state: 'failure',
        environmentUrl: '',
        logUrl: deploymentLogUrl,
        description: `${deploymentDescription} failed: content digest mismatch`
      });
    }
    throw new Error(`Preview content digest mismatch: expected ${metadata.contentDigest}, got ${contentDigest}`);
  }

  const baseRef = trustedContext?.baseRef ?? metadata.baseRef;
  const baseDirectory = resolveBaseDirectoryForRef(baseRef, { default_branch: 'main' });
  const basePagesRepo = baseDirectory ? path.join(pagesRepo, baseDirectory) : pagesRepo;
  const baseMetricsPath = pagesRepo ? resolveBaseMetricsPath({ pagesRepo, baseRef, defaultBranch: 'main' }) : null;

  let publishResult;
  try {
    if (enablePasscodeGate) {
      await injectAuthGate(contentDir, {
        passcodeHash,
        sessionHours: Number(passcodeSessionHours)
      });
    }
    if (generateStatsGraphEnabled) {
      // Use the exact current-PR snapshot the untrusted build already
      // computed against the real PR source tree; never recompute it here
      // against `contentDir`, which is only the built static output (no
      // source files), or against any checked-out branch content.
      const artifactSnapshot = readArtifactCurrentSnapshot(contentDir, statsDirectory);
      if (artifactSnapshot) {
        generateStatsGraph({
          staticDir: contentDir,
          pagesRepo: basePagesRepo,
          statsDirectory,
          siteUrl,
          basePath,
          commitSha: metadata.headSha,
          currentSnapshot: artifactSnapshot
        });
      }
    }
    publishResult = await publishDirectory({
      repo: pagesRepo,
      source: contentDir,
      branch: pagesBranch,
      targetDirectory: metadata.target,
      managedDirectories,
      siteUrl,
      basePath,
      triggerPagesRebuild,
      token,
      repository
    });
  } catch (error) {
    if (deploymentRecord && deploymentRecord.id && token && repository) {
      await updateDeploymentStatus({
        token,
        repository,
        deploymentId: deploymentRecord.id,
        state: 'failure',
        environmentUrl: '',
        logUrl: deploymentLogUrl,
        description: `${deploymentDescription} failed: ${error.message}`
      });
    }
    throw error;
  }

  const previewUrl =
    publishResult.url ||
    (() => {
      const [owner, repoName] = repository.split('/');
      if (!owner || !repoName) return '';
      const isUserPage = repoName.toLowerCase() === `${owner.toLowerCase()}.github.io`;
      const baseSiteUrl = isUserPage ? `https://${owner}.github.io` : `https://${owner}.github.io/${repoName}`;
      const targetPath = metadata.target ? `/${metadata.target}` : '';
      return `${baseSiteUrl}${targetPath}`;
    })();

  if (deploymentRecord && deploymentRecord.id && token && repository) {
    await updateDeploymentStatus({
      token,
      repository,
      deploymentId: deploymentRecord.id,
      state: 'success',
      environmentUrl: explicitEnvironmentUrl || previewUrl,
      logUrl: deploymentLogUrl,
      description: `${deploymentDescription} published successfully`
    });
  }

  let commentResult = null;
  let commentError = null;
  if (token && repository) {
    try {
      // Extract preview metrics and badges if present
      let metrics = null;
      const overviewPath = path.join(contentDir, 'badges', 'overview.json');
      if (fs.existsSync(overviewPath)) {
        try {
          metrics = JSON.parse(fs.readFileSync(overviewPath, 'utf8'));
        } catch {
          // ignore
        }
      }

      // Extract base metrics from the Pages branch at the PR's actual base
      // directory, falling back to the root when the base ref maps there.
      let baseMetrics = null;
      if (baseMetricsPath && fs.existsSync(baseMetricsPath)) {
        try {
          baseMetrics = JSON.parse(fs.readFileSync(baseMetricsPath, 'utf8'));
        } catch {
          // ignore
        }
      }

      const hasBadges =
        fs.existsSync(path.join(contentDir, 'badges', 'coverage.svg')) ||
        fs.existsSync(path.join(contentDir, 'badges', 'status.svg'));
      const hasStatsGraph = fs.existsSync(path.join(contentDir, 'stats', 'history.svg'));

      const body = buildCommentBody({
        prNumber: metadata.prNumber,
        previewUrl,
        headSha: metadata.headSha,
        runId: metadata.runId,
        repository: metadata.repository,
        metrics,
        baseMetrics,
        hasBadges,
        hasStatsGraph
      });
      commentResult = await upsertPreviewComment({ token, repository, prNumber: metadata.prNumber, body });
    } catch (error) {
      // The publish already succeeded and must not be rolled back; a comment
      // failure is surfaced independently so it is visible without masking a
      // successful publication as a failure of the deployment itself.
      commentError = error.message;
    }
  }

  return {
    action: 'published',
    reason: decision.reason,
    metadata,
    publishResult,
    commentResult,
    commentError,
    deploymentRecord,
    baseDirectory,
    baseMetricsPath
  };
}

if (process.argv[1] && process.argv[1].endsWith('preview-publish.js')) {
  const trustedContext = {
    repository: process.env.TRUSTED_REPOSITORY || undefined,
    runId: process.env.TRUSTED_RUN_ID ? Number(process.env.TRUSTED_RUN_ID) : undefined,
    prNumber: process.env.TRUSTED_PR_NUMBER ? Number(process.env.TRUSTED_PR_NUMBER) : undefined,
    headSha: process.env.TRUSTED_HEAD_SHA || undefined,
    headRepository: process.env.TRUSTED_HEAD_REPOSITORY || undefined,
    baseRef: process.env.TRUSTED_BASE_REF || undefined,
    artifactName: process.env.EXPECTED_ARTIFACT_NAME || undefined,
    previewRoot: process.env.PREVIEW_ROOT !== undefined ? process.env.PREVIEW_ROOT : 'pr-preview'
  };

  publishPreview({
    bundleDir: process.env.BUNDLE_DIR,
    pagesRepo: process.env.PAGES_REPO,
    trustedContext,
    currentHeadSha: process.env.CURRENT_HEAD_SHA,
    pagesBranch: process.env.PAGES_BRANCH || 'gh-pages',
    managedDirectories: process.env.MANAGED_DIRECTORIES
      ? process.env.MANAGED_DIRECTORIES.split(',')
          .map(v => v.trim())
          .filter(Boolean)
      : [],
    siteUrl: process.env.SITE_URL || '',
    basePath: process.env.BASE_PATH || '',
    triggerPagesRebuild: process.env.TRIGGER_PAGES_REBUILD === 'true',
    generateStatsGraph: process.env.GENERATE_STATS_GRAPH !== 'false',
    statsDirectory: process.env.SB_STATS_DIRECTORY || 'stats',
    enablePasscodeGate: process.env.ENABLE_PASSCODE_GATE === 'true',
    passcodeHash: process.env.PASSCODE_HASH || '',
    passcodeSessionHours: process.env.PASSCODE_SESSION_HOURS || 24,
    token: process.env.GITHUB_TOKEN,
    repository: process.env.GITHUB_REPOSITORY
  })
    .then(async result => {
      console.log(JSON.stringify({ action: result.action, reason: result.reason }, null, 2));
      if (result.action !== 'published') {
        if (process.env.GITHUB_STEP_SUMMARY) {
          await fsp.appendFile(process.env.GITHUB_STEP_SUMMARY, `### Storybook preview\n\n${result.reason}\n`);
        }
        if (process.env.GITHUB_OUTPUT) {
          await fsp.appendFile(process.env.GITHUB_OUTPUT, `action=${result.action}\n`);
        }
        return;
      }
      if (result.commentError) {
        console.error(
          `Preview published to ${result.publishResult.url}, but the PR comment failed: ${result.commentError}`
        );
      }
      if (process.env.GITHUB_OUTPUT) {
        await fsp.appendFile(
          process.env.GITHUB_OUTPUT,
          `page_url=${result.publishResult.url}\naction=${result.action}\n`
        );
      }
      if (process.env.GITHUB_STEP_SUMMARY) {
        await fsp.appendFile(
          process.env.GITHUB_STEP_SUMMARY,
          `### Storybook preview\n\nPublished PR #${result.metadata.prNumber} to ${result.publishResult.url}\n`
        );
      }
      if (result.commentError) {
        // Publishing succeeded; only the comment step is reported as failed so
        // this failure never appears to have skipped or reverted the publish.
        process.exit(1);
      }
    })
    .catch(error => {
      console.error(error.message);
      process.exit(1);
    });
}
