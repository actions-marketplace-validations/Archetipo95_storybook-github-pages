// Resolves the trusted pull request identity for a completed `PR Preview
// Build` run.
//
// The naive approach - trusting `workflow_run.pull_requests[0]` - is
// ambiguous whenever the same head branch/SHA is associated with more than
// one open pull request (e.g. one PR targeting `main` and another targeting
// a release branch from the same commit). GitHub does not guarantee any
// particular ordering of `pull_requests[]`, so `[0]` can silently resolve to
// a *different* pull request than the one the untrusted build job actually
// ran for, causing the publisher to look for an artifact name that was
// never uploaded (or, worse, one uploaded for an unrelated PR).
//
// The build job stamps the artifact name with the exact PR number it was
// triggered for (`storybook-preview-pr-<PR>-run-<run>`, derived from
// `github.event.pull_request.number` - an immutable identity assigned by
// GitHub, never attacker-influenced). That artifact name, as reported by
// GitHub's own "list artifacts for a run" API, is therefore strictly more
// trustworthy than picking an arbitrary entry out of `pull_requests[]`. This
// module cross-checks the two: the PR number is taken from the uploaded
// artifact, then validated against `pull_requests[]` to confirm it really is
// a same-repository pull request GitHub associated with this run.

export const PREVIEW_ARTIFACT_NAME_PATTERN = /^storybook-preview-pr-(\d+)-run-(\d+)$/;

/**
 * Extracts the PR number embedded in a `storybook-preview-pr-<PR>-run-<run>`
 * artifact name, requiring the embedded run id to match `runId`. Returns
 * `null` if the name does not conform to the contract.
 */
export function matchArtifactPrNumber(artifactName, runId) {
  if (typeof artifactName !== 'string') return null;
  const match = PREVIEW_ARTIFACT_NAME_PATTERN.exec(artifactName);
  if (!match) return null;
  const [, prNumber, artifactRunId] = match;
  if (String(runId) !== artifactRunId) return null;
  return Number(prNumber);
}

/**
 * Resolves the trusted pull request context (number, base ref, head SHA,
 * head repository) for a completed workflow run, using the run's uploaded
 * artifacts as the source of truth for *which* pull request the build ran
 * for, rather than `pull_requests[0]`.
 *
 * @param {object} params
 * @param {object} params.runData - The workflow run object (from the
 *   `workflow_run` event payload or the Get a workflow run API).
 * @param {Array<{name: string}>} params.artifacts - Artifacts listed for
 *   this run (from the List workflow run artifacts API).
 * @param {string} [params.expectedArtifactName] - Optional caller-supplied
 *   override (`workflow_call` `artifact_name` input). When set, resolution
 *   is anchored to this exact artifact name instead of pattern-matching.
 * @returns {{prNumber: number, baseRef: string, headSha: string, headRepository: string}}
 */
export function resolveTrustedPullRequestContext({ runData, artifacts, expectedArtifactName }) {
  if (!runData || typeof runData !== 'object') {
    throw new Error('resolveTrustedPullRequestContext requires a workflow run object');
  }
  const prs = Array.isArray(runData.pull_requests) ? runData.pull_requests : [];
  if (prs.length === 0) {
    throw new Error('No same-repository pull request associated with workflow run');
  }

  const artifactList = Array.isArray(artifacts) ? artifacts : [];
  const runId = runData.id;

  let candidates;
  if (expectedArtifactName) {
    const match = artifactList.find(a => a && a.name === expectedArtifactName);
    if (!match) {
      throw new Error(`No artifact named "${expectedArtifactName}" was found on workflow run ${runId}`);
    }
    const prNumber = matchArtifactPrNumber(match.name, runId);
    candidates = prNumber !== null ? [prNumber] : [];
    if (candidates.length === 0) {
      throw new Error(
        `Artifact "${expectedArtifactName}" does not conform to the "storybook-preview-pr-<PR>-run-${runId}" naming contract; cannot determine pull request identity`
      );
    }
  } else {
    const prNumbers = new Set();
    for (const artifact of artifactList) {
      const prNumber = matchArtifactPrNumber(artifact?.name, runId);
      if (prNumber !== null) prNumbers.add(prNumber);
    }
    candidates = [...prNumbers];
    if (candidates.length === 0) {
      throw new Error(
        `No "storybook-preview-pr-<PR>-run-${runId}" artifact was found on workflow run ${runId}; cannot determine pull request identity`
      );
    }
    if (candidates.length > 1) {
      throw new Error(
        `Workflow run ${runId} uploaded preview artifacts for multiple pull requests (${candidates.sort((a, b) => a - b).join(', ')}); cannot determine a single trusted pull request identity`
      );
    }
  }

  const [prNumber] = candidates;
  const pr = prs.find(p => p && p.number === prNumber);
  if (!pr) {
    throw new Error(
      `Preview artifact declares pull request #${prNumber}, which is not among the pull requests GitHub associated with workflow run ${runId} (${prs.map(p => p?.number).join(', ')}); refusing to publish`
    );
  }
  if (!Number.isInteger(pr.number) || pr.number <= 0) {
    throw new Error('Invalid pull request number in workflow run context');
  }

  return {
    prNumber: pr.number,
    baseRef: pr.base?.ref || '',
    headSha: runData.head_sha,
    headRepository: runData.head_repository?.full_name || runData.repository?.full_name || ''
  };
}
