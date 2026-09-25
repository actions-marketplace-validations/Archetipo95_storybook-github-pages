import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

export const WRITE_LOCK_NAME = '.storybook-pages-write.lock';
const RETRIES = 3;
const PAGES_BUILD_TIMEOUT_MS = 120000;
const PAGES_BUILD_POLL_INTERVAL_MS = 2000;

export function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', data => {
      stdout += data;
    });
    child.stderr.on('data', data => {
      stderr += data;
    });
    child.on('error', reject);
    child.on('close', code =>
      code === 0 ? resolve(stdout.trim()) : reject(new Error(`${command} ${args.join(' ')} failed: ${stderr.trim()}`))
    );
  });
}

export async function acquireLock(repo, timeoutMs = 120000) {
  const lock = path.join(repo, WRITE_LOCK_NAME);
  const started = Date.now();
  while (true) {
    try {
      await fs.mkdir(lock);
      return async () => fs.rm(lock, { recursive: true, force: true });
    } catch (error) {
      if (error.code !== 'EEXIST' || Date.now() - started > timeoutMs) {
        throw new Error(`Unable to acquire Pages branch write lock: ${error.message}`);
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
}

function pagesHeaders(token) {
  return {
    authorization: `token ${token}`,
    accept: 'application/vnd.github+json',
    'content-type': 'application/json'
  };
}

async function responseError(response) {
  const text = typeof response.text === 'function' ? await response.text() : '';
  return text ? `: ${text}` : '';
}

export async function requestPagesRebuild({
  token,
  repository,
  commitSha,
  timeoutMs = PAGES_BUILD_TIMEOUT_MS,
  pollIntervalMs = PAGES_BUILD_POLL_INTERVAL_MS
}) {
  if (!token || !repository || !commitSha) {
    throw new Error('Pages rebuild verification requires a GitHub token, repository, and pushed commit SHA');
  }

  const url = `https://api.github.com/repos/${repository}/pages/builds`;
  const headers = pagesHeaders(token);
  const response = await fetch(url, {
    method: 'POST',
    headers
  });
  if (!response.ok) {
    throw new Error(
      `Pages rebuild request failed (${response.status}) after pushing ${commitSha}${await responseError(response)}`
    );
  }

  const started = Date.now();
  while (true) {
    const buildsResponse = await fetch(`${url}?per_page=100`, { headers });
    if (!buildsResponse.ok) {
      throw new Error(
        `Pages build verification failed (${buildsResponse.status}) for pushed commit ${commitSha}${await responseError(buildsResponse)}`
      );
    }
    const builds = await buildsResponse.json();
    if (!Array.isArray(builds)) {
      throw new Error(`Pages build verification returned an invalid response for pushed commit ${commitSha}`);
    }
    const build = builds.find(item => item.commit === commitSha || item.commit?.sha === commitSha);
    if (build?.status === 'errored') {
      const detail = build.error?.message ? `: ${build.error.message}` : '';
      throw new Error(`Pages build for pushed commit ${commitSha} failed${detail}`);
    }
    if (build?.status === 'built') return build;
    if (Date.now() - started >= timeoutMs) {
      const status = build ? `; last status: ${build.status || 'unknown'}` : '';
      throw new Error(`Timed out waiting for a Pages build for pushed commit ${commitSha}${status}`);
    }
    await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
  }
}

/**
 * Serializes a mutate-commit-push cycle against a Pages branch, with bounded
 * fetch/rebase/push retries so concurrent writers (publish, cleanup,
 * janitor) never silently clobber each other's changes. `mutate` receives
 * the local repo path and must return `true` if it changed anything.
 */
export async function withSerializedBranchWrite({ repo, branch, mutate, commitMessage }) {
  const release = await acquireLock(repo);
  try {
    let lastError;
    for (let attempt = 0; attempt < RETRIES; attempt += 1) {
      try {
        await run('git', ['fetch', 'origin', branch], repo);
        await run('git', ['checkout', '-B', branch, `origin/${branch}`], repo);
        const changed = await mutate(repo);
        if (!changed) return { changed: false };
        await run('git', ['add', '-A'], repo);
        let committed = true;
        await run(
          'git',
          [
            '-c',
            'user.name=storybook-pages',
            '-c',
            'user.email=storybook-pages@users.noreply.github.com',
            'commit',
            '-m',
            commitMessage
          ],
          repo
        ).catch(error => {
          if (error.message.includes('nothing to commit')) {
            committed = false;
            return;
          }
          throw error;
        });
        if (!committed) return { changed: false };
        const commitSha = await run('git', ['rev-parse', 'HEAD'], repo);
        await run('git', ['push', 'origin', `HEAD:${branch}`], repo);
        return { changed: true, commitSha };
      } catch (error) {
        lastError = error;
        if (attempt + 1 < RETRIES) await run('git', ['rebase', `origin/${branch}`], repo).catch(() => {});
      }
    }
    throw new Error(`Pages branch write failed after ${RETRIES} attempts: ${lastError.message}`);
  } finally {
    await release();
  }
}
