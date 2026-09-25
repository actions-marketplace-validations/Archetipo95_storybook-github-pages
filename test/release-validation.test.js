import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function releaseVersion() {
  return JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')).version;
}

function releaseTagPattern(suffix = '') {
  return new RegExp(`v${releaseVersion().replaceAll('.', '\\.')}${suffix}`);
}

function readDocs(...files) {
  return files.map(file => fs.readFileSync(path.join(process.cwd(), file), 'utf8')).join('\n');
}

function walkFiles(dir) {
  const root = process.cwd();
  const abs = path.join(root, dir);
  if (!fs.existsSync(abs)) return [];
  return fs.readdirSync(abs, { withFileTypes: true }).flatMap(entry => {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return walkFiles(entryPath);
    return [entryPath];
  });
}

function releaseRefFiles() {
  return [
    'README.md',
    ...walkFiles('docs').filter(file => file.endsWith('.md')),
    ...walkFiles('.github').filter(file => /\.(ya?ml|md)$/.test(file))
  ];
}

test('release validation - package.json runtime dependency cleanliness', () => {
  const pkgPath = path.join(process.cwd(), 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

  assert.match(pkg.version, /^\d+\.\d+\.\d+$/, 'package.json version must be a stable semver release');
  assert.ok(
    !pkg.dependencies || Object.keys(pkg.dependencies).length === 0,
    'storybook-github-pages must have zero runtime npm dependencies for maximum reproducibility'
  );
  assert.ok(pkg.engines && pkg.engines.node, 'package.json must specify engines.node');
});

test('release validation - version metadata consistency across files', () => {
  const root = process.cwd();
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const version = pkg.version;

  // Check CHANGELOG.md
  const changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
  assert.ok(
    changelog.includes(`## [${version}]`),
    `CHANGELOG.md must contain a section header for version [${version}]`
  );

  // Check action.yml
  const actionYml = fs.readFileSync(path.join(root, 'action.yml'), 'utf8');
  assert.match(actionYml, /name:\s*['"]?Security-Hardened Storybook to GitHub Pages['"]?/);
  assert.match(actionYml, /using:\s*['"]?composite['"]?/);

  // Check publisher/action.yml
  const publisherYml = fs.readFileSync(path.join(root, 'publisher/action.yml'), 'utf8');
  assert.match(publisherYml, /name:\s*['"]?Trusted Storybook Pages publisher['"]?/);
  assert.match(publisherYml, /using:\s*['"]?composite['"]?/);

  // Check preview-cleanup/action.yml
  const cleanupYml = fs.readFileSync(path.join(root, 'preview-cleanup/action.yml'), 'utf8');
  assert.match(cleanupYml, /name:\s*['"]?Trusted Storybook preview cleanup['"]?/);
  assert.match(cleanupYml, /using:\s*['"]?composite['"]?/);

  // Check preview-janitor/action.yml
  const janitorYml = fs.readFileSync(path.join(root, 'preview-janitor/action.yml'), 'utf8');
  assert.match(janitorYml, /name:\s*['"]?Trusted Storybook preview janitor['"]?/);
  assert.match(janitorYml, /using:\s*['"]?composite['"]?/);

  // Check preview-publisher/action.yml
  const previewPublisherYml = fs.readFileSync(path.join(root, 'preview-publisher/action.yml'), 'utf8');
  assert.match(previewPublisherYml, /name:\s*['"]?Trusted Storybook preview publisher['"]?/);
  assert.match(previewPublisherYml, /using:\s*['"]?composite['"]?/);

  // Check preview-build/action.yml
  const previewBuildYml = fs.readFileSync(path.join(root, 'preview-build/action.yml'), 'utf8');
  assert.match(previewBuildYml, /name:\s*['"]?Storybook PR preview bundle['"]?/);
  assert.match(previewBuildYml, /using:\s*['"]?composite['"]?/);
});

test('release validation - documentation and governance files presence', () => {
  const root = process.cwd();
  const requiredFiles = [
    'README.md',
    'CHANGELOG.md',
    'SECURITY.md',
    'CONTRIBUTING.md',
    'LICENSE',
    'package.json',
    '.github/dependabot.yml',
    '.github/ISSUE_TEMPLATE/bug_report.yml',
    '.github/ISSUE_TEMPLATE/feature_request.yml',
    '.github/ISSUE_TEMPLATE/config.yml',
    'docs/usage.md',
    'docs/badges-and-stats.md',
    'docs/pr-previews.md',
    'docs/security.md',
    'docs/migration.md',
    'docs/bundlers.md',
    'docs/troubleshooting.md',
    'docs/development.md'
  ];

  for (const file of requiredFiles) {
    const filePath = path.join(root, file);
    assert.ok(fs.existsSync(filePath), `Required release governance file "${file}" is missing!`);
    const stat = fs.statSync(filePath);
    assert.ok(stat.size > 0, `Required release governance file "${file}" is empty!`);
  }
});

test('release validation - immutable release tag recommended in docs and issue templates', () => {
  const root = process.cwd();
  const docs = readDocs('README.md', 'docs/usage.md', 'docs/migration.md');
  const bugReport = fs.readFileSync(path.join(root, '.github/ISSUE_TEMPLATE/bug_report.yml'), 'utf8');

  assert.match(
    docs,
    new RegExp(
      `uses:\\s*Archetipo95/storybook-github-pages/\\.github/workflows/deploy-storybook\\.yml@${releaseTagPattern().source}`
    ),
    `Docs reusable workflow example must use immutable release tag @v${releaseVersion()}`
  );
  assert.match(
    docs,
    new RegExp(`uses:\\s*Archetipo95/storybook-github-pages@${releaseTagPattern().source}`),
    `Docs composite action example must use immutable release tag @v${releaseVersion()}`
  );
  assert.match(
    docs,
    new RegExp(
      `replace \`bitovi/github-actions-storybook-to-github-pages@v1\\.0\\.3\` with \`Archetipo95/storybook-github-pages@${releaseTagPattern().source}\``
    ),
    `Docs migration guide must specify immutable release tag @v${releaseVersion()}`
  );
  assert.match(
    docs,
    new RegExp(`Immutable release tags \\(for example, \`@${releaseTagPattern().source}\`\\)`),
    'Docs support matrix must recommend current immutable release tags'
  );
  assert.match(
    bugReport,
    new RegExp(`uses:\\s*Archetipo95/storybook-github-pages@${releaseTagPattern().source}`),
    `Bug report template must use immutable release tag @v${releaseVersion()}`
  );
});

test('release validation - all documented own-action release refs use current version', () => {
  const currentTag = `v${releaseVersion()}`;
  const staleRefs = releaseRefFiles().flatMap(file => {
    const content = fs.readFileSync(path.join(process.cwd(), file), 'utf8');
    return [...content.matchAll(/Archetipo95\/storybook-github-pages(?:\/[A-Za-z0-9_.\/-]+)?@(v\d+\.\d+\.\d+)/g)]
      .filter(match => match[1] !== currentTag)
      .map(match => `${file}: ${match[0]}`);
  });

  assert.deepEqual(staleRefs, [], `Found stale documented storybook-github-pages refs:\n${staleRefs.join('\n')}`);
});

test('release validation - package manager validation documents Bun workflow-only support', () => {
  const root = process.cwd();
  const docs = readDocs('docs/usage.md');
  const actionYml = fs.readFileSync(path.join(root, 'action.yml'), 'utf8');
  const deployYml = fs.readFileSync(path.join(root, '.github/workflows/deploy-storybook.yml'), 'utf8');

  assert.match(docs, /\bpackage_manager\b.*bun/, 'Docs must document bun as a package manager');
  assert.match(
    actionYml,
    /package_manager:\s*\n\s*description:.*Bun requires the reusable workflow/,
    'action.yml must exclude Bun from the deploy-capable composite action'
  );
  assert.match(
    deployYml,
    /package_manager:\s*\n\s*description:.*bun/,
    'deploy-storybook.yml must list bun as a package manager'
  );
});

test('release validation - directory mode integration documents dedicated publisher action', () => {
  const docs = readDocs('docs/usage.md', 'docs/security.md');

  // Directory mode requires publisher action
  assert.match(
    docs,
    new RegExp(`uses:\\s*Archetipo95/storybook-github-pages/publisher@${releaseTagPattern().source}`),
    `Docs Option 3 directory mode pipeline must use publisher@v${releaseVersion()}`
  );
  assert.match(
    docs,
    /Platform Note on Reusable Workflows vs Directory Mode/,
    'Docs must explain GitHub Actions startup_failure behavior on reusable workflow caller permissions'
  );
});

test('release validation - no telemetry and strict GitHub API endpoints in src/', () => {
  const srcDir = path.join(process.cwd(), 'src');
  const files = fs.readdirSync(srcDir).filter(f => f.endsWith('.js'));

  const prohibitedPatterns = [
    /mixpanel/i,
    /segment\.io/i,
    /google-analytics/i,
    /telemetry/i,
    /sentry/i,
    /datadog/i,
    /posthog/i
  ];

  for (const file of files) {
    const content = fs.readFileSync(path.join(srcDir, file), 'utf8');

    for (const pattern of prohibitedPatterns) {
      assert.doesNotMatch(
        content,
        pattern,
        `Prohibited telemetry or tracking pattern "${pattern}" found in src/${file}`
      );
    }

    // Verify all HTTP requests in JS files target api.github.com
    const fetchMatches = [...content.matchAll(/fetch\s*\(\s*[`'"](https?:\/\/[^`'"]+)[`'"]/g)];
    for (const match of fetchMatches) {
      const url = match[1];
      assert.ok(
        url.startsWith('https://api.github.com'),
        `HTTP fetch in src/${file} targets non-GitHub API endpoint "${url}"`
      );
    }
  }

  // Verify SECURITY.md accurately describes network behavior (no false 'zero external network calls' claim)
  const securityDoc = fs.readFileSync(path.join(process.cwd(), 'SECURITY.md'), 'utf8');
  assert.doesNotMatch(
    securityDoc,
    /Zero external network calls/i,
    'SECURITY.md must not falsely claim zero external network calls'
  );
  assert.match(
    securityDoc,
    /authenticated GitHub API/i,
    'SECURITY.md must accurately mention authenticated GitHub API calls'
  );
});
