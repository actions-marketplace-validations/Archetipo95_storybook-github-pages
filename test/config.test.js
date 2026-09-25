import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  COMPOSITE_PACKAGE_MANAGERS,
  validateConfig,
  parseSimpleYaml,
  resolveConfiguration,
  resolveDeploymentTarget,
  resolveBaseDirectoryForRef
} from '../src/config.js';
import { augmentBuildCommand, computeBaseUrl, hasExplicitBaseUrl } from '../src/base-url.js';

test('automatic base URL computation handles repository, custom-domain, and PR preview paths', () => {
  assert.equal(computeBaseUrl({ repository: 'acme/design-system' }), '/design-system/');
  assert.equal(
    computeBaseUrl({ repository: 'acme/design-system', eventName: 'pull_request', prNumber: 123 }),
    '/design-system/pr-123/'
  );
  assert.equal(computeBaseUrl({ repository: 'acme/design-system', siteUrl: 'https://storybook.example.com' }), '/');
  assert.equal(computeBaseUrl({ repository: 'acme/design-system', basePath: 'docs' }), '/docs/');
  assert.equal(
    computeBaseUrl({
      repository: 'acme/design-system',
      siteUrl: 'https://storybook.example.com',
      eventName: 'pull_request',
      prNumber: 123
    }),
    '/pr-123/'
  );
});

test('automatic base URL augmentation preserves explicit base configuration', () => {
  assert.equal(hasExplicitBaseUrl('npm run build-storybook -- --base /custom/'), true);
  assert.equal(hasExplicitBaseUrl('storybook build -o dist'), true);
  assert.equal(hasExplicitBaseUrl('storybook build --output-dir=dist'), true);
  assert.equal(
    augmentBuildCommand('npm run build-storybook -- --base /custom/', '/repo/'),
    'npm run build-storybook -- --base /custom/'
  );
  assert.equal(
    augmentBuildCommand('npm run build-storybook', '/repo/'),
    "npm run build-storybook -- --base-url '/repo/'"
  );
  assert.equal(augmentBuildCommand('npm run build', '/repo/'), 'npm run build');
  assert.equal(augmentBuildCommand('vite build', '/repo/'), 'vite build');
  assert.equal(
    augmentBuildCommand('npm run build-storybook', '/repo/', { autoBaseUrl: false }),
    'npm run build-storybook'
  );
});

test('resolveConfiguration - auto_base_url defaults on and honors false overrides', () => {
  const configFilePath = path.join(os.tmpdir(), 'missing-auto-base-url.yml');
  assert.equal(resolveConfiguration({ inputs: {}, configFilePath }).auto_base_url, true);
  assert.equal(resolveConfiguration({ inputs: { auto_base_url: 'false' }, configFilePath }).auto_base_url, false);
});

test('validateConfig - default valid config', () => {
  const valid = {
    version: 1,
    mode: 'artifact',
    path: 'storybook-static',
    package_manager: 'npm'
  };
  assert.equal(validateConfig(valid), true);
});

test('validateConfig - rejects invalid version', () => {
  assert.throws(() => {
    validateConfig({ version: 2 });
  }, /Unsupported configuration version: 2/);
});

test('validateConfig - rejects invalid mode', () => {
  assert.throws(() => {
    validateConfig({ mode: 'invalid-mode' });
  }, /Unsupported mode: "invalid-mode"/);
});

test('validateConfig - rejects invalid package_manager', () => {
  assert.throws(() => {
    validateConfig({ package_manager: 'pip' });
  }, /Unsupported package_manager: "pip"/);
});

test('validateConfig - accepts bun package_manager', () => {
  assert.equal(validateConfig({ package_manager: 'bun' }), true);
});

test('resolveConfiguration - applies Bun defaults after explicit and file commands', () => {
  const missingConfigPath = path.join(os.tmpdir(), 'sb-config-bun-missing.yml');
  const defaults = resolveConfiguration({ inputs: { package_manager: 'bun' }, configFilePath: missingConfigPath });
  assert.deepEqual(defaults.build, {
    install_command: 'bun install --frozen-lockfile',
    build_command: 'bun run build-storybook'
  });

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-config-bun-'));
  const configPath = path.join(tmpDir, '.storybook-pages.yml');
  fs.writeFileSync(
    configPath,
    'package_manager: bun\nbuild:\n  install_command: bun install\n  build_command: bun run build\n'
  );
  const fromFile = resolveConfiguration({ inputs: {}, configFilePath: configPath });
  assert.deepEqual(fromFile.build, { install_command: 'bun install', build_command: 'bun run build' });

  const fromInputs = resolveConfiguration({
    inputs: { install_command: 'bun install --exact', build_command: 'bun run build:ci' },
    configFilePath: configPath
  });
  assert.deepEqual(fromInputs.build, {
    install_command: 'bun install --exact',
    build_command: 'bun run build:ci'
  });
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('resolveConfiguration - rejects Bun from the deploy-capable composite action', () => {
  assert.throws(
    () =>
      resolveConfiguration({
        inputs: { package_manager: 'bun' },
        configFilePath: path.join(os.tmpdir(), 'sb-config-bun-composite.yml'),
        allowedPackageManagers: COMPOSITE_PACKAGE_MANAGERS
      }),
    /Unsupported package_manager: "bun"\. Allowed options: npm, yarn, pnpm\./
  );
});

test('validateConfig - rejects path traversal', () => {
  assert.throws(() => {
    validateConfig({ path: '../outside' });
  }, /Config path "\.\.\/outside" is unsafe/);
});

test('validateConfig - accepts directory mode and rejects protected targets', () => {
  assert.equal(validateConfig({ mode: 'directory', pages_branch: 'gh-pages', target_directory: 'en/preview' }), true);
  assert.throws(() => validateConfig({ mode: 'directory', target_directory: '../outside' }), /target_directory/);
  assert.throws(() => validateConfig({ mode: 'directory', target_directory: '.git/hooks' }), /target_directory/);
});

test('validateConfig - accepts a safe preview_root and rejects an unsafe one', () => {
  assert.equal(validateConfig({ preview_root: 'pr-preview' }), true);
  assert.equal(
    validateConfig({ preview_root: '' }),
    true,
    'empty preview_root must be accepted for repository-root layout'
  );
  assert.throws(() => validateConfig({ preview_root: '../outside' }), /preview_root/);
  assert.throws(() => validateConfig({ preview_root: '.git' }), /preview_root/);
});

test('validateConfig - accepts 0 or positive preview_retention_days and rejects invalid values', () => {
  assert.equal(validateConfig({ preview_retention_days: 14 }), true);
  assert.equal(
    validateConfig({ preview_retention_days: 0 }),
    true,
    'retention 0 must be accepted to disable age-based pruning'
  );
  assert.throws(() => validateConfig({ preview_retention_days: -1 }), /preview_retention_days/);
  assert.throws(() => validateConfig({ preview_retention_days: 'many' }), /preview_retention_days/);
});

test('validateConfig - validates smoke test settings', () => {
  assert.equal(
    validateConfig({ smoke_test: true, smoke_test_stories: 'button--*', smoke_test_timeout_ms: 5000 }),
    true
  );
  assert.throws(() => validateConfig({ smoke_test: 'yes' }), /Config smoke_test must be a boolean/);
  assert.throws(
    () => validateConfig({ smoke_test_stories: '' }),
    /Config smoke_test_stories must be a non-empty string/
  );
  assert.throws(
    () => validateConfig({ smoke_test_timeout_ms: 0 }),
    /Config smoke_test_timeout_ms must be a positive integer/
  );
});

test('resolveConfiguration - applies smoke test defaults and overrides', () => {
  const resolved = resolveConfiguration({
    inputs: { smoke_test: 'true', smoke_test_stories: 'button--*', smoke_test_timeout_ms: '5000' },
    configFilePath: path.join(os.tmpdir(), 'missing-smoke-test.yml')
  });
  assert.equal(resolved.smoke_test, true);
  assert.equal(resolved.smoke_test_stories, 'button--*');
  assert.equal(resolved.smoke_test_timeout_ms, 5000);
});

test('validateConfig - accepts warning_days_before_cleanup and rejects invalid values', () => {
  assert.equal(validateConfig({ warning_days_before_cleanup: 3 }), true);
  assert.equal(validateConfig({ warning_days_before_cleanup: 0 }), true);
  assert.throws(() => validateConfig({ warning_days_before_cleanup: -1 }), /warning_days_before_cleanup/);
  assert.throws(() => validateConfig({ warning_days_before_cleanup: 'many' }), /warning_days_before_cleanup/);
});

test('resolveDeploymentTarget - derives URL metadata for named environments', () => {
  assert.deepEqual(
    resolveDeploymentTarget({
      mode: 'directory',
      target_directory: 'staging',
      site_url: 'https://example.github.io/storybook'
    }),
    {
      directory: 'staging',
      basePath: '/staging',
      url: 'https://example.github.io/storybook/staging'
    }
  );
  assert.equal(resolveDeploymentTarget({ mode: 'artifact' }).directory, null);
});

test('resolveBaseDirectoryForRef resolves base refs against the Pages root and explicit target directories', () => {
  assert.equal(resolveBaseDirectoryForRef('main', { default_branch: 'main' }), '');
  assert.equal(resolveBaseDirectoryForRef('preprod', { default_branch: 'main' }), 'preprod');
  assert.equal(resolveBaseDirectoryForRef('refs/heads/preprod', { default_branch: 'main' }), 'preprod');
  assert.equal(
    resolveBaseDirectoryForRef('preprod', { target_directory: 'staging', default_branch: 'main' }),
    'staging'
  );
  assert.equal(resolveBaseDirectoryForRef('feature/x', { default_branch: 'main' }), 'feature/x');
  assert.equal(
    resolveBaseDirectoryForRef('preprod', {
      default_branch: 'main',
      ref_to_directory: { preprod: 'staging', main: '' }
    }),
    'staging'
  );
});

test('resolveDeploymentTarget - uses base_ref mapping when target_directory is omitted', () => {
  assert.deepEqual(
    resolveDeploymentTarget({
      mode: 'directory',
      base_ref: 'preprod',
      default_branch: 'main',
      site_url: 'https://example.github.io/storybook'
    }),
    {
      directory: 'preprod',
      basePath: '/preprod',
      url: 'https://example.github.io/storybook/preprod'
    }
  );
});

test('parseSimpleYaml - parses simple key-value YAML', () => {
  const yaml = `
version: 1
mode: artifact
path: build-output
package_manager: pnpm
build:
  install_command: pnpm install
  build_command: pnpm build-storybook
`;
  const parsed = parseSimpleYaml(yaml);
  assert.deepEqual(parsed, {
    version: 1,
    mode: 'artifact',
    path: 'build-output',
    package_manager: 'pnpm',
    build: {
      install_command: 'pnpm install',
      build_command: 'pnpm build-storybook'
    }
  });
});

test('resolveConfiguration - merges inputs over config file and defaults', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-config-test-'));
  const configPath = path.join(tmpDir, '.storybook-pages.yml');

  fs.writeFileSync(
    configPath,
    `
version: 1
mode: artifact
path: custom-static
package_manager: yarn
`
  );

  const resolved = resolveConfiguration({
    inputs: { path: 'override-static' },
    configFilePath: configPath
  });

  assert.equal(resolved.path, 'override-static');
  assert.equal(resolved.package_manager, 'yarn');
  assert.equal(resolved.version, 1);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('resolveConfiguration - empty workflow inputs do not mask file settings', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-config-precedence-'));
  const configPath = path.join(tmpDir, '.storybook-pages.yml');
  fs.writeFileSync(configPath, 'mode: directory\npath: docs\npages_branch: pages\ntarget_directory: staging\n');
  const resolved = resolveConfiguration({
    inputs: { mode: '', path: '', pages_branch: '', target_directory: '' },
    configFilePath: configPath
  });
  assert.equal(resolved.mode, 'directory');
  assert.equal(resolved.path, 'docs');
  assert.equal(resolved.pages_branch, 'pages');
  assert.equal(resolved.target_directory, 'staging');
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('resolveConfiguration - defaults preview_root and preview_retention_days, and honors file overrides', () => {
  const defaults = resolveConfiguration({
    inputs: {},
    configFilePath: path.join(os.tmpdir(), 'sb-config-nonexistent.yml')
  });
  assert.equal(defaults.preview_root, 'pr-preview');
  assert.equal(defaults.preview_retention_days, 30);
  assert.equal(defaults.warning_days_before_cleanup, 3);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-config-preview-'));
  const configPath = path.join(tmpDir, '.storybook-pages.yml');
  fs.writeFileSync(configPath, 'preview_root: previews\npreview_retention_days: 10\n');
  const resolved = resolveConfiguration({ inputs: {}, configFilePath: configPath });
  assert.equal(resolved.preview_root, 'previews');
  assert.equal(resolved.preview_retention_days, 10);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('resolveConfiguration - preserves preview_retention_days 0 from input or config file', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-config-retention-zero-'));
  const configPath = path.join(tmpDir, '.storybook-pages.yml');

  // Test retention_days: 0 in config file
  fs.writeFileSync(configPath, 'preview_retention_days: 0\n');
  const fromFile = resolveConfiguration({ inputs: {}, configFilePath: configPath });
  assert.equal(fromFile.preview_retention_days, 0, 'preview_retention_days 0 in config file must be preserved');

  // Test string "0" in workflow input over config file
  const fromInputString = resolveConfiguration({ inputs: { preview_retention_days: '0' }, configFilePath: configPath });
  assert.equal(fromInputString.preview_retention_days, 0, 'preview_retention_days "0" from input must be preserved');

  // Test numeric 0 in workflow input
  const fromInputNumber = resolveConfiguration({ inputs: { preview_retention_days: 0 }, configFilePath: configPath });
  assert.equal(fromInputNumber.preview_retention_days, 0, 'preview_retention_days 0 from input must be preserved');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('resolveConfiguration - supports repository-root layout preview_root: "" and "."', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-config-root-layout-'));
  const configPath = path.join(tmpDir, '.storybook-pages.yml');

  // Test preview_root: "" in config file
  fs.writeFileSync(configPath, 'preview_root: ""\n');
  const fromFile = resolveConfiguration({ inputs: {}, configFilePath: configPath });
  assert.equal(fromFile.preview_root, '', 'preview_root "" in config file must resolve to empty string');

  // Test preview_root: "." in config file
  fs.writeFileSync(configPath, 'preview_root: "."\n');
  const fromFileDot = resolveConfiguration({ inputs: {}, configFilePath: configPath });
  assert.equal(fromFileDot.preview_root, '', 'preview_root "." in config file must resolve to empty string');

  // Test preview_root: "custom" in input
  const fromInput = resolveConfiguration({ inputs: { preview_root: 'previews' }, configFilePath: configPath });
  assert.equal(fromInput.preview_root, 'previews', 'explicit preview_root input overrides config file');

  // Test preview_root: "." in input overriding non-empty config file
  fs.writeFileSync(configPath, 'preview_root: "custom-previews"\n');
  const fromInputDot = resolveConfiguration({ inputs: { preview_root: '.' }, configFilePath: configPath });
  assert.equal(fromInputDot.preview_root, '', 'explicit preview_root "." input overrides config file to root layout');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('validateConfig - accepts valid generate_badges and badges_directory', () => {
  assert.equal(validateConfig({ generate_badges: true, badges_directory: 'badges' }), true);
  assert.equal(validateConfig({ generate_badges: false, badges_directory: 'assets/badges' }), true);
  assert.throws(() => validateConfig({ generate_badges: 'yes' }), /generate_badges must be a boolean/);
  assert.throws(() => validateConfig({ badges_directory: '../outside' }), /badges_directory/);
  assert.throws(() => validateConfig({ badges_directory: '.git' }), /badges_directory/);
});

test('resolveConfiguration - defaults generate_badges and badges_directory, and honors overrides', () => {
  const defaults = resolveConfiguration({
    inputs: {},
    configFilePath: path.join(os.tmpdir(), 'sb-config-nonexistent-badges.yml')
  });
  assert.equal(defaults.generate_badges, true);
  assert.equal(defaults.badges_directory, 'badges');
  assert.equal(defaults.test_results_path, '');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-config-badges-'));
  const configPath = path.join(tmpDir, '.storybook-pages.yml');
  fs.writeFileSync(
    configPath,
    'generate_badges: false\nbadges_directory: custom-badges\ntest_results_path: .storybook/test-results.json\n'
  );

  const fromFile = resolveConfiguration({ inputs: {}, configFilePath: configPath });
  assert.equal(fromFile.generate_badges, false);
  assert.equal(fromFile.badges_directory, 'custom-badges');
  assert.equal(fromFile.test_results_path, '.storybook/test-results.json');

  const fromInput = resolveConfiguration({
    inputs: {
      generate_badges: 'true',
      badges_directory: 'doc-badges',
      test_results_path: 'artifacts/test-results.json'
    },
    configFilePath: configPath
  });
  assert.equal(fromInput.generate_badges, true);
  assert.equal(fromInput.badges_directory, 'doc-badges');
  assert.equal(fromInput.test_results_path, 'artifacts/test-results.json');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('validateConfig - accepts safe test_results_path values and rejects unsafe ones', () => {
  assert.equal(validateConfig({ test_results_path: 'artifacts/storybook-results.json' }), true);
  assert.equal(validateConfig({ test_results_path: '' }), true);
  assert.throws(() => validateConfig({ test_results_path: '../outside.json' }), /test_results_path/);
  assert.throws(() => validateConfig({ test_results_path: '/absolute/path.json' }), /test_results_path/);
});

test('validateConfig - accepts valid generate_stats_graph and stats_directory', () => {
  assert.equal(validateConfig({ generate_stats_graph: true, stats_directory: 'stats' }), true);
  assert.equal(validateConfig({ generate_stats_graph: false, stats_directory: 'assets/stats' }), true);
  assert.throws(() => validateConfig({ generate_stats_graph: 'yes' }), /generate_stats_graph must be a boolean/);
  assert.throws(() => validateConfig({ stats_directory: '../outside' }), /stats_directory/);
  assert.throws(() => validateConfig({ stats_directory: '.git' }), /stats_directory/);
});

test('resolveConfiguration - defaults generate_stats_graph and stats_directory, and honors overrides', () => {
  const defaults = resolveConfiguration({
    inputs: {},
    configFilePath: path.join(os.tmpdir(), 'sb-config-nonexistent-stats.yml')
  });
  assert.equal(defaults.generate_stats_graph, true);
  assert.equal(defaults.stats_directory, 'stats');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-config-stats-'));
  const configPath = path.join(tmpDir, '.storybook-pages.yml');
  fs.writeFileSync(configPath, 'generate_stats_graph: false\nstats_directory: custom-stats\n');

  const fromFile = resolveConfiguration({ inputs: {}, configFilePath: configPath });
  assert.equal(fromFile.generate_stats_graph, false);
  assert.equal(fromFile.stats_directory, 'custom-stats');

  const fromInput = resolveConfiguration({
    inputs: { generate_stats_graph: 'true', stats_directory: 'doc-stats' },
    configFilePath: configPath
  });
  assert.equal(fromInput.generate_stats_graph, true);
  assert.equal(fromInput.stats_directory, 'doc-stats');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
