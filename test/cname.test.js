import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { normalizeCname, writeCnameFile } from '../src/cname.js';
import { resolveConfiguration, validateConfig } from '../src/config.js';
import { replaceDirectory } from '../src/publish-directory.js';

async function tempDirs() {
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'pages-cname-repo-'));
  const source = await fs.mkdtemp(path.join(os.tmpdir(), 'pages-cname-src-'));
  await fs.writeFile(path.join(source, 'index.html'), 'new');
  return {
    repo,
    source,
    cleanup: async () => {
      await fs.rm(repo, { recursive: true, force: true });
      await fs.rm(source, { recursive: true, force: true });
    }
  };
}

test('normalizeCname accepts bare hostnames and lowercases them', () => {
  assert.equal(normalizeCname(''), '');
  assert.equal(normalizeCname(undefined), '');
  assert.equal(normalizeCname('  Storybook.Example.com '), 'storybook.example.com');
  assert.equal(normalizeCname('docs.my-org.co.uk'), 'docs.my-org.co.uk');
});

test('normalizeCname rejects schemes, paths, ports, traversal, and malformed labels', () => {
  for (const value of [
    'https://storybook.example.com',
    'storybook.example.com/',
    'storybook.example.com/docs',
    'storybook.example.com:8080',
    '../CNAME',
    'localhost',
    '-bad.example.com',
    'bad-.example.com',
    'storybook..example.com',
    'storybook.example.com\nevil.com',
    `${'a'.repeat(64)}.example.com`
  ]) {
    assert.throws(() => normalizeCname(value), /not a valid hostname/, value);
  }
  assert.throws(() => normalizeCname(42), /must be a string/);
});

test('configuration resolves and validates cname and preserve_cname', () => {
  const configFilePath = path.join(os.tmpdir(), 'missing-cname-config.yml');
  const defaults = resolveConfiguration({ inputs: {}, configFilePath });
  assert.equal(defaults.cname, '');
  assert.equal(defaults.preserve_cname, true);

  const custom = resolveConfiguration({
    inputs: { cname: 'Storybook.Example.com', preserve_cname: 'false' },
    configFilePath
  });
  assert.equal(custom.cname, 'storybook.example.com');
  assert.equal(custom.preserve_cname, false);

  assert.throws(() => resolveConfiguration({ inputs: { cname: 'http://x.example.com' }, configFilePath }));
  assert.throws(() => validateConfig({ preserve_cname: 'yes' }), /preserve_cname must be a boolean/);
});

test('writeCnameFile writes a clean single-line CNAME', async () => {
  const { repo, cleanup } = await tempDirs();
  try {
    assert.equal(await writeCnameFile(repo, ''), false);
    await assert.rejects(fs.access(path.join(repo, 'CNAME')));
    assert.equal(await writeCnameFile(repo, ' Storybook.Example.com '), true);
    assert.equal(await fs.readFile(path.join(repo, 'CNAME'), 'utf8'), 'storybook.example.com\n');
  } finally {
    await cleanup();
  }
});

test('root publish preserves an existing CNAME by default', async () => {
  const { repo, source, cleanup } = await tempDirs();
  try {
    await fs.writeFile(path.join(repo, 'CNAME'), 'existing.example.com\n');
    await fs.writeFile(path.join(repo, 'old.html'), 'old');

    await replaceDirectory(repo, '', source);

    assert.equal(await fs.readFile(path.join(repo, 'CNAME'), 'utf8'), 'existing.example.com\n');
    await assert.rejects(fs.access(path.join(repo, 'old.html')));
  } finally {
    await cleanup();
  }
});

test('root publish drops the existing CNAME when preservation is disabled', async () => {
  const { repo, source, cleanup } = await tempDirs();
  try {
    await fs.writeFile(path.join(repo, 'CNAME'), 'existing.example.com\n');
    await replaceDirectory(repo, '', source, [], { preserveCname: false });
    await assert.rejects(fs.access(path.join(repo, 'CNAME')));
  } finally {
    await cleanup();
  }
});

test('root publish prefers a CNAME shipped in the build output over the preserved one', async () => {
  const { repo, source, cleanup } = await tempDirs();
  try {
    await fs.writeFile(path.join(repo, 'CNAME'), 'existing.example.com\n');
    await fs.writeFile(path.join(source, 'CNAME'), 'build.example.com\n');
    await replaceDirectory(repo, '', source);
    assert.equal(await fs.readFile(path.join(repo, 'CNAME'), 'utf8'), 'build.example.com\n');
  } finally {
    await cleanup();
  }
});

test('explicit cname input overrides existing and build-provided CNAME files', async () => {
  const { repo, source, cleanup } = await tempDirs();
  try {
    await fs.writeFile(path.join(repo, 'CNAME'), 'existing.example.com\n');
    await fs.writeFile(path.join(source, 'CNAME'), 'build.example.com\n');
    await replaceDirectory(repo, '', source, [], { cname: 'Configured.Example.com' });
    assert.equal(await fs.readFile(path.join(repo, 'CNAME'), 'utf8'), 'configured.example.com\n');
  } finally {
    await cleanup();
  }
});

test('subdirectory publish keeps the root CNAME and writes a configured one at the root', async () => {
  const { repo, source, cleanup } = await tempDirs();
  try {
    await fs.writeFile(path.join(repo, 'CNAME'), 'existing.example.com\n');
    await replaceDirectory(repo, 'staging', source);
    assert.equal(await fs.readFile(path.join(repo, 'CNAME'), 'utf8'), 'existing.example.com\n');

    await replaceDirectory(repo, 'pr-preview/pr-1', source, [], { cname: 'new.example.com' });
    assert.equal(await fs.readFile(path.join(repo, 'CNAME'), 'utf8'), 'new.example.com\n');
    await assert.rejects(fs.access(path.join(repo, 'pr-preview', 'pr-1', 'CNAME')));
  } finally {
    await cleanup();
  }
});

test('invalid cname fails before the Pages branch is modified', async () => {
  const { repo, source, cleanup } = await tempDirs();
  try {
    await fs.writeFile(path.join(repo, 'old.html'), 'old');
    await assert.rejects(replaceDirectory(repo, '', source, [], { cname: 'https://bad.example.com/' }));
    assert.equal(await fs.readFile(path.join(repo, 'old.html'), 'utf8'), 'old');
  } finally {
    await cleanup();
  }
});

test('artifact mode warns about cname while directory mode wires it to the publisher', async () => {
  const action = await fs.readFile(path.join(process.cwd(), 'action.yml'), 'utf8');
  assert.doesNotMatch(action, /src\/cname\.js/, 'artifact mode must not write a CNAME GitHub ignores');
  assert.match(action, /::warning title=cname ignored in artifact mode::/);

  const publisher = await fs.readFile(path.join(process.cwd(), 'publisher/action.yml'), 'utf8');
  assert.match(publisher, /CNAME: \$\{\{ inputs\.cname \}\}/);
  assert.match(publisher, /PRESERVE_CNAME: \$\{\{ inputs\.preserve_cname \}\}/);

  const workflow = await fs.readFile(path.join(process.cwd(), '.github/workflows/deploy-storybook.yml'), 'utf8');
  assert.match(workflow, /\n      cname:\n/);
  assert.match(workflow, /\n      preserve_cname:\n/);
  assert.doesNotMatch(workflow, /node src\/cname\.js/, 'artifact mode must not write a CNAME GitHub ignores');
  assert.match(workflow, /::warning title=cname ignored in artifact mode::/);
  assert.match(workflow, /cname: \$\{\{ needs\.build-and-upload\.outputs\.cname \}\}/);
});
