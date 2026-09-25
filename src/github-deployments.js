export function normalizeEnvironmentName(environmentName, fallback = 'github-pages') {
  const value = typeof environmentName === 'string' ? environmentName.trim() : '';
  return value || fallback;
}

export function normalizeEnvironmentUrl(environmentUrl) {
  if (typeof environmentUrl !== 'string') return '';
  const trimmed = environmentUrl.trim();
  return trimmed;
}

export function hasGitHubDeploymentContext({ token, repository }) {
  return Boolean(token && repository && typeof repository === 'string' && repository.includes('/'));
}

async function githubApiRequest({ token, repository, path, method = 'GET', body, allowEmpty = false }) {
  if (!hasGitHubDeploymentContext({ token, repository })) {
    return null;
  }

  const options = {
    method,
    headers: {
      authorization: `token ${token}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28'
    }
  };

  if (body !== undefined) {
    options.headers['content-type'] = 'application/json';
    options.body = JSON.stringify(body);
  }

  const response = await fetch(`https://api.github.com${path}`, options);
  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }

  if (!response.ok) {
    const message =
      payload && typeof payload === 'object' && payload.message ? payload.message : text || `${response.status}`;
    throw new Error(`GitHub API request failed for ${method} ${path}: ${message}`);
  }

  if (allowEmpty && !text) {
    return null;
  }

  return payload;
}

export async function listDeployments({ token, repository, environmentName }) {
  if (!hasGitHubDeploymentContext({ token, repository })) {
    return [];
  }

  const params = new URLSearchParams({ per_page: '100' });
  if (environmentName) {
    params.set('environment', environmentName);
  }

  const deployments = await githubApiRequest({
    token,
    repository,
    path: `/repos/${repository}/deployments?${params.toString()}`,
    method: 'GET'
  });
  return Array.isArray(deployments) ? deployments : [];
}

export async function createDeployment({
  token,
  repository,
  ref,
  environmentName,
  environmentUrl = '',
  logUrl = '',
  description = 'Deployment',
  payload = {},
  productionEnvironment = true,
  transientEnvironment = false
}) {
  if (!hasGitHubDeploymentContext({ token, repository })) {
    return null;
  }

  const deployment = await githubApiRequest({
    token,
    repository,
    path: `/repos/${repository}/deployments`,
    method: 'POST',
    body: {
      ref: ref || 'HEAD',
      environment: normalizeEnvironmentName(environmentName),
      description,
      auto_merge: false,
      required_contexts: [],
      payload,
      transient_environment: transientEnvironment,
      production_environment: productionEnvironment
    }
  });

  if (!deployment || !deployment.id) {
    return deployment;
  }

  const status = await updateDeploymentStatus({
    token,
    repository,
    deploymentId: deployment.id,
    state: 'pending',
    environmentUrl: normalizeEnvironmentUrl(environmentUrl),
    logUrl,
    description: description || 'Deployment pending'
  });

  return { ...deployment, pendingStatus: status };
}

export async function updateDeploymentStatus({
  token,
  repository,
  deploymentId,
  state,
  environmentUrl = '',
  logUrl = '',
  description = '',
  targetUrl = ''
}) {
  if (!deploymentId || !hasGitHubDeploymentContext({ token, repository })) {
    return null;
  }

  const body = {
    state,
    ...(description ? { description } : {}),
    ...(normalizeEnvironmentUrl(environmentUrl) ? { environment_url: normalizeEnvironmentUrl(environmentUrl) } : {}),
    ...(logUrl ? { log_url: logUrl } : {}),
    ...(targetUrl ? { target_url: targetUrl } : {})
  };

  return githubApiRequest({
    token,
    repository,
    path: `/repos/${repository}/deployments/${deploymentId}/statuses`,
    method: 'POST',
    body
  });
}

export async function deactivateDeploymentsForPullRequest({
  token,
  repository,
  environmentName,
  prNumber,
  description = 'PR preview cleaned up'
}) {
  const normalizedName = normalizeEnvironmentName(environmentName, 'github-pages');
  const normalizedPrNumber = Number(prNumber);
  const descriptionBoundaryPattern = new RegExp(`#${normalizedPrNumber}(?!\\d)`);
  const deployments = await listDeployments({ token, repository, environmentName: normalizedName });
  const matches = deployments.filter(deployment => {
    const payload = deployment.payload && typeof deployment.payload === 'object' ? deployment.payload : {};
    const numericValues = [payload.pr_number, payload.prNumber, payload.preview_pr_number, payload.previewPrNumber];
    const numericMatch = numericValues.some(
      value => value !== undefined && value !== null && value !== '' && Number(value) === normalizedPrNumber
    );
    const descriptionMatch =
      typeof deployment.description === 'string' && descriptionBoundaryPattern.test(deployment.description);
    return numericMatch || descriptionMatch;
  });

  for (const deployment of matches) {
    await updateDeploymentStatus({
      token,
      repository,
      deploymentId: deployment.id,
      state: 'inactive',
      description: description || `Deployment closed for PR #${prNumber}`
    });
  }

  return matches;
}

async function runCli() {
  const operation = (process.env.ACTION || 'create').toLowerCase();
  const token = process.env.GITHUB_TOKEN || process.env.GITHUB_DEPLOYMENT_TOKEN;
  const repository = process.env.GITHUB_REPOSITORY || process.env.GITHUB_DEPLOYMENT_REPOSITORY;

  if (operation === 'create') {
    const deployment = await createDeployment({
      token,
      repository,
      ref: process.env.DEPLOY_REF || process.env.GITHUB_SHA || 'HEAD',
      environmentName: process.env.DEPLOYMENT_ENVIRONMENT || process.env.ENVIRONMENT_NAME || process.env.ENVIRONMENT,
      environmentUrl: process.env.ENVIRONMENT_URL || '',
      logUrl: process.env.LOG_URL || '',
      description: process.env.DEPLOYMENT_DESCRIPTION || 'Storybook deployment',
      payload: process.env.DEPLOYMENT_PAYLOAD ? JSON.parse(process.env.DEPLOYMENT_PAYLOAD) : {},
      productionEnvironment: process.env.PRODUCTION_ENVIRONMENT !== 'false',
      transientEnvironment: process.env.TRANSIENT_ENVIRONMENT === 'true'
    });

    if (deployment && deployment.id) {
      process.stdout.write(`deployment_id=${deployment.id}\n`);
      if (process.env.GITHUB_OUTPUT) {
        const fs = await import('node:fs/promises');
        await fs.appendFile(process.env.GITHUB_OUTPUT, `deployment_id=${deployment.id}\n`);
      }
    }
    return;
  }

  if (operation === 'update') {
    const deployment = await updateDeploymentStatus({
      token,
      repository,
      deploymentId: process.env.DEPLOYMENT_ID,
      state: process.env.DEPLOYMENT_STATE || 'success',
      environmentUrl: process.env.ENVIRONMENT_URL || '',
      logUrl: process.env.LOG_URL || '',
      description: process.env.DEPLOYMENT_DESCRIPTION || '',
      targetUrl: process.env.TARGET_URL || ''
    });
    if (deployment && deployment.id) {
      process.stdout.write(`deployment_status_id=${deployment.id}\n`);
    }
    return;
  }

  if (operation === 'deactivate-preview') {
    const matches = await deactivateDeploymentsForPullRequest({
      token,
      repository,
      environmentName: process.env.DEPLOYMENT_ENVIRONMENT || process.env.ENVIRONMENT_NAME || process.env.ENVIRONMENT,
      prNumber: Number(process.env.PR_NUMBER),
      description: process.env.DEPLOYMENT_DESCRIPTION || 'PR preview cleaned up'
    });
    process.stdout.write(`deactivated=${matches.length}\n`);
    return;
  }

  throw new Error(`Unsupported GitHub deployment action: ${operation}`);
}

if (process.argv[1] && process.argv[1].endsWith('github-deployments.js')) {
  runCli().catch(error => {
    console.error(error.message);
    process.exit(1);
  });
}
