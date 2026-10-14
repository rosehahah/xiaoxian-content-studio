import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {ARCHIVE_PREFIX, RELEASE_POLICY_VERSION, MIN_RESERVE_BYTES, sha256, safeSourcePath, exclusionReason, highConfidenceSecret, parseArgs, preflight,checkedPackageVersion} from '../scripts/package-release.mjs';
import {cleanEnvironment, validateManifest, validateTarListing, verifyExtractedFiles, testCounts, releaseGateStatus} from '../scripts/check-release-package.mjs';

function sourceManifest() {
  return {
    schema: 1, policyVersion: RELEASE_POLICY_VERSION, sourceSha: 'a'.repeat(40), prefix: ARCHIVE_PREFIX,
    archive: {sha256: 'b'.repeat(64), bytes: 100},
    files: [{path: 'server.mjs', mode: '100644', bytes: 4, gitBlob: 'c'.repeat(40), sha256: sha256('test')}]
  };
}

test('release validation cannot pass when required packaged Ego evidence is missing or incomplete',()=>{
  assert.equal(releaseGateStatus([]),'incomplete');
  assert.equal(releaseGateStatus([{name:'candidate-test',status:'passed'},{name:'R03-packaged-ego-flow',status:'not_run'}]),'incomplete');
  assert.equal(releaseGateStatus([{name:'R03-packaged-ego-flow',status:'failed'}]),'incomplete');
  assert.equal(releaseGateStatus([{name:'R03-packaged-ego-flow',status:'passed'}]),'passed');
});

test('archive version requires matching package and lock roots and keeps the actual README star-history asset',()=>{
  assert.equal(checkedPackageVersion({version:'1.3.0'},{version:'1.3.0',packages:{'':{version:'1.3.0'}}}),'1.3.0');
  assert.throws(()=>checkedPackageVersion({version:'1.3.0'},{version:'1.2.0',packages:{'':{version:'1.3.0'}}}),/must match/);
  assert.throws(()=>checkedPackageVersion({version:'1.3.0'},{version:'1.3.0',packages:{'':{version:'1.2.0'}}}),/must match/);
  assert.equal(exclusionReason('assets/star-history.svg'),null);
});

test('release paths exclude runtime data, dependencies, secrets, symlinks and private media', () => {
  for (const name of ['.local-data/projects.json', 'node_modules/library/index.js', 'outputs/evidence.json', 'nested/credentials/token.json', '.env', '.env.local', '.npmrc', 'key.pem', 'assets/private-photo.jpg', 'dist/issues/real-person/project.json', 'examples/github-tag-release-20261006/project.json']) assert.ok(exclusionReason(name), name);
  assert.equal(exclusionReason('linked-folder/file.mjs', '120000'), 'symlink_or_submodule');
  for (const name of ['../secret', '/private/file', 'assets/../secret', 'assets\\file', 'file\nname', 'C:/secret']) assert.equal(safeSourcePath(name), false, name);
});

test('runtime configuration modules survive while actual local configuration data is excluded', () => {
  for (const name of ['overseas-config.mjs', 'account-preferences.mjs', 'scripts/check-release-package.mjs', 'server.mjs', 'package-lock.json']) assert.equal(exclusionReason(name), null, name);
  for (const name of ['overseas-config.json', 'account-preferences.json', 'credentials.yaml', 'secrets.toml']) assert.equal(exclusionReason(name), 'credential_file', name);
});

test('known public reference media is retained without a broad media exception', () => {
  for (const name of ['dist/cover-references/social-atlas.png', 'dist/xiaoxian-logo.png', 'dist/leaf.svg', 'assets/star-history-dark.svg', 'preview-workspace.jpg', 'examples/preview/01.png']) assert.equal(exclusionReason(name), null, name);
  for (const name of ['dist/new-person.jpg', 'dist/cover-references/unreviewed-person.png', 'assets/person.svg', 'examples/preview/portrait/deeper.png']) assert.equal(exclusionReason(name), 'media_not_public_allowlist', name);
});

test('high-confidence secret scan reports categories without returning matched values', () => {
  assert.equal(highConfidenceSecret('const token = "YOUR_USER_OAUTH_ACCESS_TOKEN";'), null);
  assert.equal(highConfidenceSecret('prefix ' + 'sk-proj-' + 'a'.repeat(40)), 'api_key');
  assert.equal(highConfidenceSecret('token ' + 'ghp_' + 'z'.repeat(36)), 'service_token');
  assert.equal(highConfidenceSecret('-----BEGIN PRIVATE KEY-----\n' + 'a'.repeat(60)), 'private_key');
});

test('release argument parsing requires explicit values and importing scripts performs no release action', () => {
  assert.deepEqual(parseArgs(['--sha', 'a'.repeat(40), '--output', '/tmp/candidate']), {sha: 'a'.repeat(40), output: '/tmp/candidate'});
  assert.deepEqual(parseArgs(['--help']), {help: true});
  assert.throws(() => parseArgs(['--sha']), /Expected/);
  assert.throws(() => parseArgs(['v1.3.0']), /Expected/);
});

test('manifest SHA, unsafe entries and duplicates are rejected before extraction', () => {
  const manifest = sourceManifest();
  assert.equal(validateManifest(manifest, 'a'.repeat(40)), manifest);
  assert.throws(() => validateManifest(manifest, 'd'.repeat(40)), /mismatch/);
  for (const name of ['../secret', '.local-data/projects.json', 'node_modules/x.js']) {
    const bad = structuredClone(manifest); bad.files[0].path = name;
    assert.throws(() => validateManifest(bad, manifest.sourceSha), /Unsafe/);
  }
  const duplicate = structuredClone(manifest); duplicate.files.push(duplicate.files[0]);
  assert.throws(() => validateManifest(duplicate, manifest.sourceSha), /duplicate/);
});

test('tar validation requires exactly the manifest files and denies links/traversal', () => {
  const manifest = sourceManifest(), names = ARCHIVE_PREFIX + '\n' + ARCHIVE_PREFIX + 'server.mjs\n';
  assert.doesNotThrow(() => validateTarListing(names, 'drwxr-xr-x directory\n-rw-r--r-- file\n', manifest));
  assert.throws(() => validateTarListing(names + ARCHIVE_PREFIX + 'extra.txt\n', '-rw-r--r-- file\n', manifest), /Unexpected/);
  assert.throws(() => validateTarListing(ARCHIVE_PREFIX + '../secret\n', '-rw-r--r-- file\n', manifest), /Unsafe/);
  assert.throws(() => validateTarListing(names, 'lrwxrwxrwx link -> outside\n', manifest), /link or special/);
  assert.throws(() => validateTarListing(ARCHIVE_PREFIX + '\n', 'drwxr-xr-x directory\n', manifest), /every manifest/);
});

test('source verification detects altered bytes, executable mode and symlinks', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'release-source-unit-'));
  try {
    const manifest = sourceManifest(), file = path.join(directory, 'server.mjs');
    await fs.writeFile(file, 'test', {mode: 0o644});
    await verifyExtractedFiles(directory, manifest);
    await fs.writeFile(file, 'evil');
    await assert.rejects(verifyExtractedFiles(directory, manifest), /SHA-256/);
    await fs.writeFile(file, 'test'); await fs.chmod(file, 0o755);
    await assert.rejects(verifyExtractedFiles(directory, manifest), /mode/);
    await fs.unlink(file); await fs.writeFile(path.join(directory, 'target.mjs'), 'test'); await fs.symlink('target.mjs', file);
    await assert.rejects(verifyExtractedFiles(directory, manifest), /type\/size\/mode/);
  } finally { await fs.rm(directory, {recursive: true, force: true}); }
});

test('isolated command environment preserves home and uses explicit task npm config/cache', () => {
  const env = cleanEnvironment('/task/runtime', '/task/data', {PATH: '/bin', HOME: '/original/home', USERPROFILE: '/original/profile', WECHAT_SECRET: 'synthetic-secret', STUDIO_X_ACCESS_TOKEN: 'synthetic-token', STUDIO_DRAFT_DRIVER: 'mock', NODE_OPTIONS: '--require private.cjs', npm_config_userconfig: '/private/npmrc'});
  assert.equal(env.HOME, '/original/home');
  assert.equal(env.USERPROFILE, '/original/profile');
  assert.equal(env.STUDIO_DATA_DIR, '/task/data');
  assert.equal(env.npm_config_cache, '/task/runtime/npm-cache');
  assert.equal(env.npm_config_userconfig, '/task/runtime/empty-npm-user.conf');
  assert.equal(env.npm_config_globalconfig, '/task/runtime/empty-npm-global.conf');
  for (const key of ['WECHAT_SECRET', 'STUDIO_X_ACCESS_TOKEN', 'STUDIO_DRAFT_DRIVER', 'NODE_OPTIONS']) assert.equal(env[key], undefined);
});

test('TAP summaries preserve skips instead of reporting every check passed', () => {
  assert.deepEqual(testCounts('# tests 197\n# pass 191\n# fail 0\n# skipped 6\n'), {tests: 197, passed: 191, failed: 0, skipped: 6});
  assert.throws(() => testCounts('# tests 1\n# pass 0\n# fail 1\n# skipped 0\n'), /zero-failure/);
  assert.throws(() => testCounts('nothing was tested'), /nonempty/);
});

test('release preflight cannot reduce its 1 GiB reserve and logs refusal before any large write', async () => {
  await assert.rejects(preflight(os.tmpdir(), 'unit-test-only', {reserveBytes: MIN_RESERVE_BYTES - 1}), /at least 1 GiB/);
  const reports = [];
  await assert.rejects(preflight(os.tmpdir(), 'unit-test-only-no-install-or-package', {expectedBytes: Number.MAX_SAFE_INTEGER, log: report => reports.push(report)}), /Insufficient disk/);
  assert.equal(reports.length, 1);
  assert.equal(reports[0].ok, false);
  assert.equal(reports[0].reserveBytes, MIN_RESERVE_BYTES);
});
