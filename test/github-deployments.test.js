import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createDeployment,
  deactivateDeploymentsForPullRequest,
  normalizeEnvironmentName
} from '../src/github-deployments.js';

test('normalizeEnvironmentName falls back to github-pages and preserves custom names', () => {
  assert.equal(normalizeEnvironmentName('pr-preview', 'github-pages'), 'pr-preview');
  assert.equal(normalizeEnvironmentName('', 'github-pages'), 'github-pages');
});

test('createDeployment creates a pending deployment and status record', async () => {
  const originalFetch = global.fetch;
  const calls = [];

  global.fetch = async (url, options = {}) => {
    calls.push({ url, method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : undefined });

    if (url === 'https://api.github.com/repos/acme/app/deployments' && (options.method || 'GET') === 'POST') {
      return {
        ok: true,
        status: 201,
        text: async () => JSON.stringify({ id: 77, environment: 'pr-preview' })
      };
    }

    if (
      url === 'https://api.github.com/repos/acme/app/deployments/77/statuses' &&
      (options.method || 'GET') === 'POST'
    ) {
      return {
        ok: true,
        status: 201,
        text: async () => JSON.stringify({ id: 888, state: 'pending' })
      };
    }

    throw new Error(`Unexpected request: ${url}`);
  };

  try {
    const result = await createDeployment({
      token: 'tok',
      repository: 'acme/app',
      ref: 'abc123',
      environmentName: 'pr-preview',
      environmentUrl: 'https://example.test/pr-preview/pr-42',
      logUrl: 'https://github.com/acme/app/actions/runs/123',
      description: 'Storybook preview for PR #42',
      payload: { pr_number: 42 },
      productionEnvironment: false,
      transientEnvironment: true
    });

    assert.equal(result.id, 77);
    assert.equal(result.pendingStatus.id, 888);
    assert.equal(calls[0].body.environment, 'pr-preview');
    assert.equal(calls[1].body.state, 'pending');
    assert.equal(calls[1].body.environment_url, 'https://example.test/pr-preview/pr-42');
  } finally {
    global.fetch = originalFetch;
  }
});

test('deactivateDeploymentsForPullRequest marks matching preview deployments inactive', async () => {
  const originalFetch = global.fetch;
  const calls = [];

  global.fetch = async (url, options = {}) => {
    calls.push({ url, method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : undefined });

    if (url === 'https://api.github.com/repos/acme/app/deployments?per_page=100&environment=pr-preview') {
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify([
            { id: 11, environment: 'pr-preview', description: 'Storybook preview for PR #7' },
            {
              id: 22,
              environment: 'pr-preview',
              description: 'Storybook preview for PR #42',
              payload: { pr_number: 42 }
            },
            { id: 33, environment: 'pr-preview', description: 'Other deployment' }
          ])
      };
    }

    if (
      url === 'https://api.github.com/repos/acme/app/deployments/22/statuses' &&
      (options.method || 'GET') === 'POST'
    ) {
      return {
        ok: true,
        status: 201,
        text: async () => JSON.stringify({ id: 221, state: 'inactive' })
      };
    }

    throw new Error(`Unexpected request: ${url}`);
  };

  try {
    const result = await deactivateDeploymentsForPullRequest({
      token: 'tok',
      repository: 'acme/app',
      environmentName: 'pr-preview',
      prNumber: 42,
      description: 'Preview cleanup for PR #42'
    });

    assert.equal(result.length, 1);
    assert.equal(result[0].id, 22);
    assert.equal(calls[1].body.state, 'inactive');
    assert.equal(calls[1].body.description, 'Preview cleanup for PR #42');
  } finally {
    global.fetch = originalFetch;
  }
});

test('deactivateDeploymentsForPullRequest does not match a shorter PR number that is a prefix of a longer one', async () => {
  const originalFetch = global.fetch;
  const calls = [];

  global.fetch = async (url, options = {}) => {
    calls.push({ url, method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : undefined });

    if (url === 'https://api.github.com/repos/acme/app/deployments?per_page=100&environment=pr-preview') {
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify([
            // PR #4's cleanup must never match a deployment described for PR #42.
            { id: 22, environment: 'pr-preview', description: 'Storybook preview for PR #42' }
          ])
      };
    }

    throw new Error(`Unexpected request: ${url}`);
  };

  try {
    const result = await deactivateDeploymentsForPullRequest({
      token: 'tok',
      repository: 'acme/app',
      environmentName: 'pr-preview',
      prNumber: 4,
      description: 'Preview cleanup for PR #4'
    });

    assert.equal(result.length, 0);
    assert.equal(calls.length, 1, 'no status update request should have been made');
  } finally {
    global.fetch = originalFetch;
  }
});
