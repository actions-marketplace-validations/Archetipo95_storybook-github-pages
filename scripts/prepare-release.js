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

function walkFiles(dir) {
  if (!fs.existsSync(path.join(root, dir))) return [];
  const entries = fs.readdirSync(path.join(root, dir), { withFileTypes: true });
  return entries.flatMap(entry => {
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

updateJson('package.json', pkg => {
  pkg.version = version;
});

updateJson('package-lock.json', lock => {
  lock.version = version;
  if (lock.packages?.['']) lock.packages[''].version = version;
});

for (const file of releaseRefFiles()) {
  replaceProjectTags(file);
}

const staleRefs = releaseRefFiles().flatMap(file => {
  const matches = [
    ...read(file).matchAll(/Archetipo95\/storybook-github-pages(?:\/[A-Za-z0-9_.\/-]+)?@v\d+\.\d+\.\d+/g)
  ];
  return matches.map(match => ({ file, ref: match[0] })).filter(({ ref }) => !ref.endsWith(`@${tag}`));
});

if (staleRefs.length > 0) {
  console.error(`Found stale storybook-github-pages release refs after preparing ${tag}:`);
  for (const { file, ref } of staleRefs) {
    console.error(`- ${file}: ${ref}`);
  }
  process.exit(1);
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
