function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

export function isCustomDomain({ repository = '', siteUrl = '' } = {}) {
  const [owner, repoName] = String(repository).split('/');
  if (repoName && owner && repoName.toLowerCase() === `${owner.toLowerCase()}.github.io`) return true;
  if (!siteUrl) return false;
  try {
    const url = new URL(siteUrl);
    return !owner || url.hostname.toLowerCase() !== `${owner.toLowerCase()}.github.io`;
  } catch {
    throw new Error(`site_url must be a valid URL when auto_base_url is enabled: "${siteUrl}"`);
  }
}

export function computeBaseUrl({ repository = '', siteUrl = '', basePath = '', eventName = '', prNumber = '' } = {}) {
  if (basePath) {
    const normalized = String(basePath).startsWith('/') ? String(basePath) : `/${basePath}`;
    return normalized.endsWith('/') ? normalized : `${normalized}/`;
  }
  const [, repoName = ''] = String(repository).split('/');
  const customDomain = isCustomDomain({ repository, siteUrl });
  const isPreview = eventName === 'pull_request' && /^\d+$/.test(String(prNumber)) && Number(prNumber) > 0;
  const path = isPreview
    ? `${customDomain ? '' : `/${repoName}`}/pr-${Number(prNumber)}/`
    : customDomain
      ? '/'
      : `/${repoName}/`;
  if (path.startsWith('//')) return path.slice(1);
  return path;
}

export function hasExplicitBaseUrl(command = '') {
  return /(?:^|\s)(?:--base(?:-url)?|--public-path|--output-base|--output-dir|-o)(?:[=\s]|$)|(?:^|\s)(?:BASE_URL|PUBLIC_URL|STORYBOOK_BASE_HREF)=/i.test(
    command
  );
}

export function isStorybookBuildCommand(command = '') {
  return /(?:^|\s)(?:build-storybook|storybook\s+build)(?:\s|$)/i.test(command);
}

export function augmentBuildCommand(command, baseUrl, { autoBaseUrl = true } = {}) {
  if (!autoBaseUrl || !command || !baseUrl || hasExplicitBaseUrl(command) || !isStorybookBuildCommand(command)) {
    return command;
  }
  const separator = /^(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?/.test(command.trim()) ? ' -- ' : ' ';
  return `${command}${separator}--base-url ${shellQuote(baseUrl)}`;
}

export function buildEnvironment(baseUrl) {
  return {
    BASE_URL: baseUrl,
    PUBLIC_URL: baseUrl,
    STORYBOOK_BASE_HREF: baseUrl
  };
}
