import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_CONFIG = {
  version: 1,
  mode: 'artifact',
  path: 'storybook-static',
  pages_branch: 'gh-pages',
  target_directory: '',
  environment: '',
  environment_name: '',
  environment_url: '',
  create_deployment: false,
  site_url: '',
  base_path: '',
  artifact_name: 'github-pages',
  managed_directories: [],
  package_manager: 'npm',
  preview_root: 'pr-preview',
  preview_retention_days: 30,
  warning_days_before_cleanup: 3,
  generate_badges: true,
  badges_directory: 'badges',
  test_results_path: '',
  coverage_include_paths: '',
  coverage_ignore_paths: '',
  generate_stats_graph: true,
  stats_directory: 'stats',
  enable_passcode_gate: false,
  passcode_session_hours: 24,
  smoke_test: false,
  smoke_test_stories: 'all',
  smoke_test_timeout_ms: 30000,
  auto_base_url: true,
  build: {
    install_command: null,
    build_command: null
  }
};

export const ALLOWED_PACKAGE_MANAGERS = new Set(['npm', 'yarn', 'pnpm', 'bun']);
export const COMPOSITE_PACKAGE_MANAGERS = new Set(['npm', 'yarn', 'pnpm']);
export const ALLOWED_MODES = new Set(['artifact', 'directory']);

const PROTECTED_DIRECTORIES = new Set(['.git', '.github']);
const BUN_DEFAULT_BUILD = {
  install_command: 'bun install --frozen-lockfile',
  build_command: 'bun run build-storybook'
};

export function validateRelativeDirectory(value, field = 'target_directory', { allowEmpty = false } = {}) {
  if (allowEmpty && (value === undefined || value === '' || value === '.' || value === './')) return true;
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${field} must be a non-empty relative directory`);
  }
  const normalized = path.posix.normalize(value.replaceAll('\\', '/'));
  if (
    normalized === '.' ||
    normalized.startsWith('../') ||
    normalized.includes('/../') ||
    normalized.startsWith('/') ||
    normalized.includes(':') ||
    PROTECTED_DIRECTORIES.has(normalized.split('/')[0])
  ) {
    throw new Error(`${field} "${value}" is unsafe. It must remain within the Pages branch.`);
  }
  return true;
}

export function validateConfig(config, { allowedPackageManagers = ALLOWED_PACKAGE_MANAGERS } = {}) {
  if (typeof config !== 'object' || config === null) {
    throw new Error('Configuration must be a non-null object');
  }

  if (config.version !== undefined) {
    if (typeof config.version !== 'number' || config.version !== 1) {
      throw new Error(`Unsupported configuration version: ${config.version}. Only version 1 is supported.`);
    }
  }

  if (config.mode !== undefined) {
    if (!ALLOWED_MODES.has(config.mode)) {
      throw new Error(`Unsupported mode: "${config.mode}". Supported modes: artifact, directory.`);
    }
  }

  if (config.package_manager !== undefined) {
    if (!allowedPackageManagers.has(config.package_manager)) {
      throw new Error(
        `Unsupported package_manager: "${config.package_manager}". Allowed options: ${[...allowedPackageManagers].join(', ')}.`
      );
    }
  }

  if (config.path !== undefined) {
    if (typeof config.path !== 'string' || config.path.trim() === '') {
      throw new Error('Config path must be a non-empty string');
    }

    const normalized = path.normalize(config.path);
    if (normalized.startsWith('..') || path.isAbsolute(normalized)) {
      throw new Error(
        `Config path "${config.path}" is unsafe. Path must be relative and contained within the repository root.`
      );
    }
  }

  if (config.pages_branch !== undefined) {
    if (
      typeof config.pages_branch !== 'string' ||
      !/^[A-Za-z0-9._/-]+$/.test(config.pages_branch) ||
      config.pages_branch.startsWith('/') ||
      config.pages_branch.includes('..')
    ) {
      throw new Error(`Invalid pages_branch: "${config.pages_branch}"`);
    }
  }
  if (config.target_directory !== undefined)
    validateRelativeDirectory(config.target_directory, 'target_directory', { allowEmpty: true });
  if (config.environment !== undefined)
    validateRelativeDirectory(config.environment, 'environment', { allowEmpty: true });
  if (config.environment_name !== undefined)
    validateRelativeDirectory(config.environment_name, 'environment_name', { allowEmpty: true });
  for (const field of ['environment_url', 'site_url', 'base_path']) {
    if (config[field] !== undefined && typeof config[field] !== 'string') {
      throw new Error(`Config ${field} must be a string`);
    }
  }
  if (config.create_deployment !== undefined && typeof config.create_deployment !== 'boolean') {
    throw new Error('Config create_deployment must be a boolean');
  }
  if (config.managed_directories !== undefined) {
    const values = Array.isArray(config.managed_directories)
      ? config.managed_directories
      : String(config.managed_directories)
          .split(',')
          .map(value => value.trim())
          .filter(Boolean);
    values.forEach(value => validateRelativeDirectory(value, 'managed_directories'));
  }

  if (config.preview_root !== undefined) {
    validateRelativeDirectory(config.preview_root, 'preview_root', { allowEmpty: true });
  }

  if (config.preview_retention_days !== undefined) {
    const days = Number(config.preview_retention_days);
    if (!Number.isInteger(days) || days < 0) {
      throw new Error(
        `Config preview_retention_days must be a non-negative integer, got "${config.preview_retention_days}"`
      );
    }
  }

  if (config.warning_days_before_cleanup !== undefined) {
    const days = Number(config.warning_days_before_cleanup);
    if (!Number.isInteger(days) || days < 0) {
      throw new Error(
        `Config warning_days_before_cleanup must be a non-negative integer, got "${config.warning_days_before_cleanup}"`
      );
    }
  }

  if (config.generate_badges !== undefined && typeof config.generate_badges !== 'boolean') {
    throw new Error('Config generate_badges must be a boolean');
  }

  if (config.badges_directory !== undefined) {
    validateRelativeDirectory(config.badges_directory, 'badges_directory', { allowEmpty: false });
  }

  if (config.test_results_path !== undefined) {
    if (typeof config.test_results_path !== 'string') {
      throw new Error('Config test_results_path must be a string');
    }
    if (config.test_results_path.trim() !== '') {
      const normalized = path.normalize(config.test_results_path);
      if (normalized === '.' || normalized === '..' || path.isAbsolute(normalized) || normalized.startsWith('../')) {
        throw new Error(
          `Config test_results_path "${config.test_results_path}" is unsafe. Use a repository-relative path.`
        );
      }
    }
  }

  for (const [field, value] of [
    ['coverage_include_paths', config.coverage_include_paths],
    ['coverage_ignore_paths', config.coverage_ignore_paths]
  ]) {
    if (value === undefined || value === null || value === '') continue;
    const values = Array.isArray(value) ? value : String(value).split(/\r?\n|,/);
    values.forEach(item => {
      const pattern = String(item).trim();
      if (!pattern) return;
      const normalized = pattern.replace(/\\/g, '/').replace(/^\//, '');
      if (
        normalized.startsWith('../') ||
        normalized.includes('/../') ||
        normalized.startsWith('/') ||
        normalized.includes('://')
      ) {
        throw new Error(`Config ${field} pattern "${pattern}" must be a repository-root-relative glob.`);
      }
    });
  }

  if (config.generate_stats_graph !== undefined && typeof config.generate_stats_graph !== 'boolean') {
    throw new Error('Config generate_stats_graph must be a boolean');
  }

  if (config.stats_directory !== undefined) {
    validateRelativeDirectory(config.stats_directory, 'stats_directory', { allowEmpty: false });
  }
  if (config.enable_passcode_gate !== undefined && typeof config.enable_passcode_gate !== 'boolean') {
    throw new Error('Config enable_passcode_gate must be a boolean');
  }
  if (config.auto_base_url !== undefined && typeof config.auto_base_url !== 'boolean') {
    throw new Error('Config auto_base_url must be a boolean');
  }
  if (config.passcode_session_hours !== undefined) {
    const hours = Number(config.passcode_session_hours);
    if (!Number.isFinite(hours) || hours <= 0) {
      throw new Error('Config passcode_session_hours must be a positive number');
    }
  }
  if (config.smoke_test !== undefined && typeof config.smoke_test !== 'boolean') {
    throw new Error('Config smoke_test must be a boolean');
  }
  if (config.smoke_test_stories !== undefined) {
    if (typeof config.smoke_test_stories !== 'string' || config.smoke_test_stories.trim() === '') {
      throw new Error('Config smoke_test_stories must be a non-empty string');
    }
  }
  if (config.smoke_test_timeout_ms !== undefined) {
    const timeout = Number(config.smoke_test_timeout_ms);
    if (!Number.isInteger(timeout) || timeout <= 0) {
      throw new Error('Config smoke_test_timeout_ms must be a positive integer');
    }
  }

  if (config.build !== undefined && config.build !== null) {
    if (typeof config.build !== 'object') {
      throw new Error('Config "build" must be an object');
    }
    if (config.build.install_command !== undefined && config.build.install_command !== null) {
      if (typeof config.build.install_command !== 'string') {
        throw new Error('Config build.install_command must be a string');
      }
    }
    if (config.build.build_command !== undefined && config.build.build_command !== null) {
      if (typeof config.build.build_command !== 'string') {
        throw new Error('Config build.build_command must be a string');
      }
    }
  }

  return true;
}

export function parseSimpleYaml(content) {
  const result = {};
  let currentSection = null;

  const lines = content.split(/\r?\n/);
  const parseBlockScalar = (startIndex, { allowNested = false } = {}) => {
    const block = [];
    let index = startIndex + 1;

    while (index < lines.length) {
      const rawLine = lines[index];
      if (!rawLine || !rawLine.trim()) {
        block.push('');
        index += 1;
        continue;
      }

      const indent = rawLine.search(/\S/);
      if (allowNested ? indent > 0 : indent >= 0) {
        if (indent === 0) break;
        block.push(rawLine.slice(indent));
        index += 1;
        continue;
      }
      break;
    }

    return { value: block.join('\n').replace(/\n$/, ''), nextIndex: index };
  };

  for (let index = 0; index < lines.length; index++) {
    let line = lines[index];
    const commentIdx = line.indexOf('#');
    if (commentIdx !== -1) {
      line = line.slice(0, commentIdx);
    }
    if (!line.trim()) continue;

    const indent = line.search(/\S/);
    const trimmed = line.trim();

    if (indent === 0) {
      currentSection = null;
      const colonIdx = trimmed.indexOf(':');
      if (colonIdx !== -1) {
        const key = trimmed.slice(0, colonIdx).trim();
        let val = trimmed.slice(colonIdx + 1).trim();
        if (val === '|' || val === '>' || /^([|>])([+-]?)$/.test(val)) {
          const { value, nextIndex } = parseBlockScalar(index, { allowNested: false });
          result[key] = value;
          index = nextIndex - 1;
          continue;
        }
        if (val) {
          result[key] = parseValue(val);
        } else {
          result[key] = {};
          currentSection = key;
        }
      }
    } else if (indent > 0 && currentSection) {
      const colonIdx = trimmed.indexOf(':');
      if (colonIdx !== -1) {
        const key = trimmed.slice(0, colonIdx).trim();
        let val = trimmed.slice(colonIdx + 1).trim();
        if (val === '|' || val === '>' || /^([|>])([+-]?)$/.test(val)) {
          const { value, nextIndex } = parseBlockScalar(index, { allowNested: true });
          result[currentSection][key] = value;
          index = nextIndex - 1;
          continue;
        }
        result[currentSection][key] = parseValue(val);
      }
    }
  }

  return result;
}

function parseValue(val) {
  if (val === 'true') return true;
  if (val === 'false') return false;
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
    return val.slice(1, -1);
  }
  if (val !== '' && !isNaN(Number(val))) return Number(val);
  return val;
}

export function loadConfigFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const content = fs.readFileSync(filePath, 'utf8');
  const parsed = parseSimpleYaml(content);
  validateConfig(parsed);
  return parsed;
}

export function resolveConfiguration({
  inputs = {},
  configFilePath = '.storybook-pages.yml',
  allowedPackageManagers = ALLOWED_PACKAGE_MANAGERS
} = {}) {
  let fileConfig = null;
  if (fs.existsSync(configFilePath)) {
    fileConfig = loadConfigFile(configFilePath);
  }

  const packageManager = inputs.package_manager || fileConfig?.package_manager || DEFAULT_CONFIG.package_manager;
  const defaultBuild = packageManager === 'bun' ? BUN_DEFAULT_BUILD : DEFAULT_CONFIG.build;
  const merged = {
    version: fileConfig?.version ?? DEFAULT_CONFIG.version,
    mode: inputs.mode || fileConfig?.mode || DEFAULT_CONFIG.mode,
    path: inputs.path || fileConfig?.path || DEFAULT_CONFIG.path,
    pages_branch: inputs.pages_branch || fileConfig?.pages_branch || DEFAULT_CONFIG.pages_branch,
    target_directory: inputs.target_directory || fileConfig?.target_directory || DEFAULT_CONFIG.target_directory,
    environment: inputs.environment || fileConfig?.environment || DEFAULT_CONFIG.environment,
    environment_name:
      inputs.environment_name ||
      inputs.environment ||
      fileConfig?.environment_name ||
      fileConfig?.environment ||
      DEFAULT_CONFIG.environment_name,
    environment_url: inputs.environment_url || fileConfig?.environment_url || DEFAULT_CONFIG.environment_url,
    create_deployment:
      inputs.create_deployment !== undefined && inputs.create_deployment !== ''
        ? String(inputs.create_deployment) === 'true'
        : fileConfig?.create_deployment !== undefined
          ? Boolean(fileConfig.create_deployment)
          : DEFAULT_CONFIG.create_deployment,
    site_url: inputs.site_url || fileConfig?.site_url || DEFAULT_CONFIG.site_url,
    base_path: inputs.base_path || fileConfig?.base_path || DEFAULT_CONFIG.base_path,
    artifact_name: inputs.artifact_name || fileConfig?.artifact_name || DEFAULT_CONFIG.artifact_name,
    managed_directories:
      inputs.managed_directories || fileConfig?.managed_directories || DEFAULT_CONFIG.managed_directories,
    package_manager: packageManager,
    preview_root:
      inputs.preview_root !== undefined && inputs.preview_root !== ''
        ? inputs.preview_root === '.' || inputs.preview_root === './'
          ? ''
          : inputs.preview_root
        : fileConfig?.preview_root !== undefined
          ? fileConfig.preview_root === '.' || fileConfig.preview_root === './'
            ? ''
            : fileConfig.preview_root
          : DEFAULT_CONFIG.preview_root,
    preview_retention_days: Number(
      inputs.preview_retention_days !== undefined && inputs.preview_retention_days !== ''
        ? inputs.preview_retention_days
        : fileConfig?.preview_retention_days !== undefined && fileConfig?.preview_retention_days !== ''
          ? fileConfig.preview_retention_days
          : DEFAULT_CONFIG.preview_retention_days
    ),
    warning_days_before_cleanup: Number(
      inputs.warning_days_before_cleanup !== undefined && inputs.warning_days_before_cleanup !== ''
        ? inputs.warning_days_before_cleanup
        : fileConfig?.warning_days_before_cleanup !== undefined && fileConfig?.warning_days_before_cleanup !== ''
          ? fileConfig.warning_days_before_cleanup
          : DEFAULT_CONFIG.warning_days_before_cleanup
    ),
    generate_badges:
      inputs.generate_badges !== undefined && inputs.generate_badges !== ''
        ? String(inputs.generate_badges) === 'true'
        : fileConfig?.generate_badges !== undefined
          ? Boolean(fileConfig.generate_badges)
          : DEFAULT_CONFIG.generate_badges,
    badges_directory: inputs.badges_directory || fileConfig?.badges_directory || DEFAULT_CONFIG.badges_directory,
    test_results_path:
      inputs.test_results_path !== undefined && inputs.test_results_path !== ''
        ? String(inputs.test_results_path)
        : fileConfig?.test_results_path !== undefined && fileConfig.test_results_path !== ''
          ? String(fileConfig.test_results_path)
          : DEFAULT_CONFIG.test_results_path,
    coverage_include_paths:
      inputs.coverage_include_paths !== undefined && inputs.coverage_include_paths !== ''
        ? String(inputs.coverage_include_paths)
        : fileConfig?.coverage_include_paths !== undefined && fileConfig.coverage_include_paths !== ''
          ? String(fileConfig.coverage_include_paths)
          : DEFAULT_CONFIG.coverage_include_paths,
    coverage_ignore_paths:
      inputs.coverage_ignore_paths !== undefined && inputs.coverage_ignore_paths !== ''
        ? String(inputs.coverage_ignore_paths)
        : fileConfig?.coverage_ignore_paths !== undefined && fileConfig.coverage_ignore_paths !== ''
          ? String(fileConfig.coverage_ignore_paths)
          : DEFAULT_CONFIG.coverage_ignore_paths,
    generate_stats_graph:
      inputs.generate_stats_graph !== undefined && inputs.generate_stats_graph !== ''
        ? String(inputs.generate_stats_graph) === 'true'
        : fileConfig?.generate_stats_graph !== undefined
          ? Boolean(fileConfig.generate_stats_graph)
          : DEFAULT_CONFIG.generate_stats_graph,
    stats_directory: inputs.stats_directory || fileConfig?.stats_directory || DEFAULT_CONFIG.stats_directory,
    enable_passcode_gate:
      inputs.enable_passcode_gate !== undefined && inputs.enable_passcode_gate !== ''
        ? String(inputs.enable_passcode_gate) === 'true'
        : fileConfig?.enable_passcode_gate !== undefined
          ? Boolean(fileConfig.enable_passcode_gate)
          : DEFAULT_CONFIG.enable_passcode_gate,
    passcode_session_hours: Number(
      inputs.passcode_session_hours !== undefined && inputs.passcode_session_hours !== ''
        ? inputs.passcode_session_hours
        : (fileConfig?.passcode_session_hours ?? DEFAULT_CONFIG.passcode_session_hours)
    ),
    smoke_test:
      inputs.smoke_test !== undefined && inputs.smoke_test !== ''
        ? String(inputs.smoke_test) === 'true'
        : fileConfig?.smoke_test !== undefined
          ? Boolean(fileConfig.smoke_test)
          : DEFAULT_CONFIG.smoke_test,
    smoke_test_stories:
      inputs.smoke_test_stories !== undefined && inputs.smoke_test_stories !== ''
        ? String(inputs.smoke_test_stories)
        : fileConfig?.smoke_test_stories || DEFAULT_CONFIG.smoke_test_stories,
    smoke_test_timeout_ms: Number(
      inputs.smoke_test_timeout_ms !== undefined && inputs.smoke_test_timeout_ms !== ''
        ? inputs.smoke_test_timeout_ms
        : (fileConfig?.smoke_test_timeout_ms ?? DEFAULT_CONFIG.smoke_test_timeout_ms)
    ),
    auto_base_url:
      inputs.auto_base_url !== undefined && inputs.auto_base_url !== ''
        ? String(inputs.auto_base_url) === 'true'
        : fileConfig?.auto_base_url !== undefined
          ? Boolean(fileConfig.auto_base_url)
          : DEFAULT_CONFIG.auto_base_url,
    build: {
      install_command:
        inputs.install_command ||
        inputs.custom_install_command ||
        fileConfig?.build?.install_command ||
        defaultBuild.install_command,
      build_command:
        inputs.build_command ||
        inputs.custom_build_command ||
        fileConfig?.build?.build_command ||
        defaultBuild.build_command
    }
  };

  validateConfig(merged, { allowedPackageManagers });
  return merged;
}

export function resolveBaseDirectoryForRef(
  baseRef,
  { target_directory = '', environment = '', default_branch = '', ref_to_directory = {} } = {}
) {
  const explicitDirectory = target_directory || environment || '';
  if (explicitDirectory !== '') {
    validateRelativeDirectory(explicitDirectory, 'target_directory', { allowEmpty: true });
    return explicitDirectory === '.' || explicitDirectory === './' ? '' : explicitDirectory;
  }

  if (!baseRef) {
    return '';
  }

  const normalizedBaseRef = String(baseRef).trim();
  const cleanBaseRef = normalizedBaseRef
    .replace(/^refs\/heads\//, '')
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '');

  const refKey = normalizedBaseRef.replace(/\\/g, '/');
  const mapped =
    ref_to_directory &&
    (ref_to_directory[cleanBaseRef] ?? ref_to_directory[refKey] ?? ref_to_directory[`refs/heads/${cleanBaseRef}`]);
  if (mapped !== undefined && mapped !== null) {
    const mappedDirectory = String(mapped).trim();
    validateRelativeDirectory(mappedDirectory, 'ref_to_directory', { allowEmpty: true });
    return mappedDirectory === '.' || mappedDirectory === './' ? '' : mappedDirectory;
  }

  const normalizedDefaultBranch = default_branch
    ? String(default_branch)
        .trim()
        .replace(/^refs\/heads\//, '')
        .replace(/\\/g, '/')
    : '';
  if (normalizedDefaultBranch && cleanBaseRef === normalizedDefaultBranch) {
    return '';
  }

  if (cleanBaseRef === '' || cleanBaseRef === '.' || cleanBaseRef === '/') {
    return '';
  }

  validateRelativeDirectory(cleanBaseRef, 'base_ref', { allowEmpty: true });
  return cleanBaseRef;
}

export function resolveDeploymentTarget(config) {
  validateConfig(config);
  if (config.mode !== 'directory')
    return { directory: null, basePath: config.base_path || '/', url: config.site_url || '' };
  const directory = resolveBaseDirectoryForRef(config.base_ref, {
    target_directory: config.target_directory,
    environment: config.environment,
    default_branch: config.default_branch || config.default_ref || '',
    ref_to_directory: config.ref_to_directory || config.base_ref_directory_map || {}
  });
  validateRelativeDirectory(directory, 'deployment target directory', { allowEmpty: true });
  const basePath = config.base_path || (directory ? `/${directory}` : '/');
  return {
    directory,
    basePath: basePath.startsWith('/') ? basePath : `/${basePath}`,
    url: config.site_url ? `${config.site_url.replace(/\/$/, '')}${basePath === '/' ? '' : basePath}` : ''
  };
}

if (process.argv[1] && process.argv[1].endsWith('config.js')) {
  try {
    const config = resolveConfiguration();
    console.log(JSON.stringify(config, null, 2));
  } catch (err) {
    console.error('Config resolution error:', err.message);
    process.exit(1);
  }
}
