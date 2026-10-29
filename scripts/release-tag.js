import fs from 'node:fs';
import path from 'node:path';

const STABLE_TAG_PATTERN = /^v(\d+)\.(\d+)\.(\d+)$/;

/**
 * Parses a stable release tag (`vX.Y.Z`). Pre-release and build-metadata
 * tags are rejected so they can never move a major tag that consumers pin.
 */
export function parseReleaseTag(tag) {
  const match = STABLE_TAG_PATTERN.exec(typeof tag === 'string' ? tag : '');
  if (!match) {
    throw new Error(`Release tag "${tag}" must be a stable semver tag such as v1.2.3`);
  }
  const [major, minor, patch] = match.slice(1).map(Number);
  return { tag, version: `${major}.${minor}.${patch}`, major, minor, patch, majorTag: `v${major}` };
}

function compareVersions(a, b) {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

/**
 * Checks that a release tag agrees with the versioned files on the tagged
 * commit. Returns a list of problems; an empty list means the tag is valid.
 */
export function verifyReleaseTag({ tag, packageVersion, lockVersion, changelog }) {
  const release = parseReleaseTag(tag);
  const problems = [];
  if (packageVersion !== release.version) {
    problems.push(`package.json version ${packageVersion} does not match ${tag}`);
  }
  if (lockVersion !== undefined && lockVersion !== release.version) {
    problems.push(`package-lock.json version ${lockVersion} does not match ${tag}`);
  }
  if (typeof changelog !== 'string' || !changelog.includes(`## [${release.version}]`)) {
    problems.push(`CHANGELOG.md has no "## [${release.version}]" section`);
  }
  return problems;
}

/**
 * Returns the GitHub release notes for a version: the body of its
 * CHANGELOG.md section, with `###` subsections promoted to `##` to match
 * earlier release pages.
 */
export function releaseNotes(changelog, version) {
  const lines = changelog.split('\n');
  const start = lines.findIndex(line => line.startsWith(`## [${version}]`));
  if (start === -1) throw new Error(`CHANGELOG.md has no "## [${version}]" section`);
  const end = lines.findIndex((line, index) => index > start && /^## \[/.test(line));
  const body = lines
    .slice(start + 1, end === -1 ? undefined : end)
    .filter(line => line.trim() !== '---')
    .map(line => line.replace(/^### /, '## '))
    .join('\n')
    .trim();
  if (!body) throw new Error(`CHANGELOG.md section for ${version} is empty`);
  return `${body}\n`;
}

/**
 * Decides what the release workflow must do for a push.
 *
 * - A push to a branch releases `v<package.json version>` when that tag does
 *   not exist yet, so a merged version bump can never be left untagged.
 * - A push of a `vX.Y.Z` tag validates that tag.
 *
 * In both cases the major tag (`vX`) targets the newest stable release of
 * that major line, so a backport tagged on an older line never moves it and a
 * major tag that drifted is corrected on the next run.
 */
export function planRelease({ ref, packageVersion, existingTags = [] }) {
  const tagRef = /^refs\/tags\/(.+)$/.exec(ref || '');
  const releaseTag = tagRef ? tagRef[1] : `v${packageVersion}`;
  const release = parseReleaseTag(releaseTag);
  const createTag = !tagRef && !existingTags.includes(releaseTag);

  const majorTarget = [...new Set([...existingTags, releaseTag])]
    .filter(tag => STABLE_TAG_PATTERN.test(tag))
    .map(parseReleaseTag)
    .filter(tag => tag.major === release.major)
    .sort(compareVersions)
    .at(-1).tag;

  const newestOverall = [...new Set([...existingTags, releaseTag])]
    .filter(tag => STABLE_TAG_PATTERN.test(tag))
    .map(parseReleaseTag)
    .sort(compareVersions)
    .at(-1).tag;

  return {
    releaseTag,
    createTag,
    latest: newestOverall === releaseTag,
    // Versioned files are only checked when this run introduces the tag.
    verify: createTag || Boolean(tagRef),
    majorTag: release.majorTag,
    majorTarget
  };
}

if (process.argv[1] && process.argv[1].endsWith('release-tag.js')) {
  if (process.argv[2] === '--notes') {
    try {
      process.stdout.write(
        releaseNotes(fs.readFileSync(path.join(process.cwd(), 'CHANGELOG.md'), 'utf8'), process.argv[3])
      );
      process.exit(0);
    } catch (error) {
      console.error(error.message);
      process.exit(1);
    }
  }
  const existingTags = (process.env.EXISTING_TAGS || '').split(/\s+/).filter(Boolean);
  try {
    const root = process.cwd();
    const read = file => fs.readFileSync(path.join(root, file), 'utf8');
    const packageVersion = JSON.parse(read('package.json')).version;
    const plan = planRelease({ ref: process.env.RELEASE_REF, packageVersion, existingTags });
    if (plan.verify) {
      const problems = verifyReleaseTag({
        tag: plan.releaseTag,
        packageVersion,
        lockVersion: JSON.parse(read('package-lock.json')).version,
        changelog: read('CHANGELOG.md')
      });
      if (problems.length > 0) {
        for (const problem of problems) console.error(problem);
        process.exit(1);
      }
    }
    console.log(
      `${plan.createTag ? `Will create ${plan.releaseTag}` : `${plan.releaseTag} already exists`}; ` +
        `${plan.majorTag} should point at ${plan.majorTarget}`
    );
    if (process.env.GITHUB_OUTPUT) {
      const lines = [
        `release_tag=${plan.releaseTag}`,
        `create_tag=${plan.createTag}`,
        `verify=${plan.verify}`,
        `major_tag=${plan.majorTag}`,
        `major_target=${plan.majorTarget}`,
        `latest=${plan.latest}`
      ];
      fs.appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join('\n')}\n`);
    }
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
