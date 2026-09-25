import fs from 'node:fs';
import path from 'node:path';

const version = process.argv[2];

if (!/^\d+\.\d+\.\d+$/.test(version || '')) {
  console.error('Usage: npm run prepare-release -- <x.y.z>');
  process.exit(1);
}

const root = process.cwd();
const tag = `v${version}`;

function read(file) {
  return fs.readFileSync(path.join(root, file), 'utf8');
}

function write(file, content) {
  fs.writeFileSync(path.join(root, file), content);
}

function updateJson(file, updater) {
  const data = JSON.parse(read(file));
  updater(data);
  write(file, `${JSON.stringify(data, null, 2)}\n`);
}

function replaceProjectTags(file) {
  write(
    file,
    read(file)
      .replace(/(Archetipo95\/storybook-github-pages(?:\/[A-Za-z0-9_.\/-]+)?@)v\d+\.\d+\.\d+/g, `$1${tag}`)
      .replace(/(for example, `@)v\d+\.\d+\.\d+(`\))/g, `$1${tag}$2`)
  );
}

updateJson('package.json', pkg => {
  pkg.version = version;
});

updateJson('package-lock.json', lock => {
  lock.version = version;
  if (lock.packages?.['']) lock.packages[''].version = version;
});

for (const file of [
  'README.md',
  'docs/usage.md',
  'docs/pr-previews.md',
  'docs/security.md',
  'docs/migration.md',
  '.github/ISSUE_TEMPLATE/bug_report.yml'
]) {
  replaceProjectTags(file);
}

const changelog = read('CHANGELOG.md');
if (!changelog.includes(`## [${version}]`)) {
  write(
    'CHANGELOG.md',
    changelog.replace(
      '## [Unreleased]\n',
      `## [Unreleased]\n\n## [${version}] - ${new Date().toISOString().slice(0, 10)}\n\n### Changed\n\n- Release ${tag}.\n`
    )
  );
}

console.log(`Prepared ${tag}`);
