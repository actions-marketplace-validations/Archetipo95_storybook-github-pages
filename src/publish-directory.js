import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveDeploymentTarget, validateConfig, validateRelativeDirectory } from './config.js';
import { CNAME_FILE, normalizeCname, readCnameFile, writeCnameFile } from './cname.js';
import { requestPagesRebuild, withSerializedBranchWrite, WRITE_LOCK_NAME } from './git-branch-writer.js';

export async function replaceDirectory(
  repo,
  targetDirectory,
  sourceDirectory,
  managedDirectories = [],
  { cname = '', preserveCname = true } = {}
) {
  validateRelativeDirectory(targetDirectory, 'target_directory', { allowEmpty: true });
  const hostname = normalizeCname(cname);
  if (!targetDirectory) {
    // Keep the branch's existing custom domain when the new build does not ship one,
    // otherwise a root replacement would drop it and GitHub Pages would reset the domain.
    const existingCname = preserveCname ? await readCnameFile(repo) : null;
    const staging = `${repo}.staging-${process.pid}`;
    await fs.rm(staging, { recursive: true, force: true });
    await fs.cp(sourceDirectory, staging, { recursive: true, preserveTimestamps: true });
    for (const entry of await fs.readdir(repo)) {
      if (entry !== '.git' && entry !== WRITE_LOCK_NAME && !managedDirectories.includes(entry))
        await fs.rm(path.join(repo, entry), { recursive: true, force: true });
    }
    for (const entry of await fs.readdir(staging)) {
      await fs.rename(path.join(staging, entry), path.join(repo, entry));
    }
    await fs.rm(staging, { recursive: true, force: true });
    if (hostname) {
      await writeCnameFile(repo, hostname);
    } else if (existingCname !== null && (await readCnameFile(repo)) === null) {
      await fs.writeFile(path.join(repo, CNAME_FILE), existingCname, 'utf8');
    }
    // Ensure .nojekyll exists at root so GitHub Pages doesn't ignore underscore files (_plugin-vue...)
    await fs.writeFile(path.join(repo, '.nojekyll'), '', 'utf8');
    return;
  }
  // When deploying to a subdirectory (like pr-preview/pr-1), ensure root .nojekyll exists
  const rootNoJekyll = path.join(repo, '.nojekyll');
  try {
    await fs.access(rootNoJekyll);
  } catch {
    await fs.writeFile(rootNoJekyll, '', 'utf8');
  }
  // The custom domain is site-wide, so it always lives at the branch root; subdirectory
  // publishes never touch an existing root CNAME.
  await writeCnameFile(repo, hostname);
  const target = path.join(repo, targetDirectory);
  const staging = `${target}.staging-${process.pid}`;
  const backup = `${target}.previous-${process.pid}`;
  await fs.rm(staging, { recursive: true, force: true });
  await fs.cp(sourceDirectory, staging, { recursive: true, preserveTimestamps: true });
  try {
    await fs.rename(target, backup);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  try {
    await fs.rename(staging, target);
    await fs.rm(backup, { recursive: true, force: true });
  } catch (error) {
    await fs.rm(staging, { recursive: true, force: true });
    try {
      await fs.rename(backup, target);
    } catch {
      /* preserve original error */
    }
    throw error;
  }
}

export async function publishDirectory({
  repo,
  source,
  branch = 'gh-pages',
  targetDirectory = '',
  managedDirectories = [],
  siteUrl = '',
  basePath = '',
  cname = '',
  preserveCname = true,
  triggerPagesRebuild = false,
  token,
  repository
}) {
  validateConfig({
    mode: 'directory',
    pages_branch: branch,
    target_directory: targetDirectory,
    managed_directories: managedDirectories,
    site_url: siteUrl,
    base_path: basePath,
    cname,
    preserve_cname: preserveCname
  });
  const writeResult = await withSerializedBranchWrite({
    repo,
    branch,
    commitMessage: `Deploy Storybook${targetDirectory ? ` to ${targetDirectory}` : ''}`,
    mutate: async repoPath => {
      await replaceDirectory(repoPath, targetDirectory, source, managedDirectories, { cname, preserveCname });
      return true;
    }
  });
  if (triggerPagesRebuild && writeResult.changed) {
    await requestPagesRebuild({ token, repository, commitSha: writeResult.commitSha });
  }
  const resolvedTarget = resolveDeploymentTarget({
    mode: 'directory',
    target_directory: targetDirectory,
    site_url: siteUrl,
    base_path: basePath
  });
  let finalUrl = resolvedTarget.url;
  if (!finalUrl && repository) {
    const [owner, repoName] = repository.split('/');
    if (owner && repoName) {
      const isUserPage = repoName.toLowerCase() === `${owner.toLowerCase()}.github.io`;
      const baseSiteUrl = isUserPage ? `https://${owner}.github.io` : `https://${owner}.github.io/${repoName}`;
      finalUrl = `${baseSiteUrl}${resolvedTarget.basePath === '/' ? '' : resolvedTarget.basePath}`;
    }
  }
  return {
    branch,
    directory: targetDirectory,
    commitSha: writeResult.commitSha,
    ...resolvedTarget,
    url: finalUrl
  };
}

if (process.argv[1]?.endsWith('publish-directory.js')) {
  publishDirectory({
    repo: process.env.PAGES_REPO || process.cwd(),
    source: process.env.SOURCE_DIRECTORY,
    branch: process.env.PAGES_BRANCH || 'gh-pages',
    targetDirectory: process.env.TARGET_DIRECTORY || '',
    siteUrl: process.env.SITE_URL || '',
    basePath: process.env.BASE_PATH || '',
    cname: process.env.CNAME || '',
    preserveCname: process.env.PRESERVE_CNAME !== 'false',
    triggerPagesRebuild: process.env.TRIGGER_PAGES_REBUILD === 'true',
    managedDirectories: process.env.MANAGED_DIRECTORIES
      ? process.env.MANAGED_DIRECTORIES.split(',')
          .map(value => value.trim())
          .filter(Boolean)
      : [],
    token: process.env.GITHUB_TOKEN,
    repository: process.env.GITHUB_REPOSITORY
  })
    .then(result => {
      console.log(JSON.stringify(result));
      if (process.env.GITHUB_OUTPUT) {
        const output = `page_url=${result.url}\nbase_path=${result.basePath}\n`;
        return fs.appendFile(process.env.GITHUB_OUTPUT, output);
      }
    })
    .catch(error => {
      console.error(error.message);
      process.exit(1);
    });
}
