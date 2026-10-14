import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath, pathToFileURL} from 'node:url';

const exec = promisify(execFile);
export const RELEASE_POLICY_VERSION = 'source-archive-v1';
export const MIN_RESERVE_BYTES = 1024 ** 3;
export const ARCHIVE_PREFIX = 'xiaoxian-content-studio/';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const MEDIA = /\.(?:png|jpe?g|gif|webp|avif|heic|svg|mp4|mov|webm|mp3|wav|m4a|pdf|zip|tar|gz)$/i;
const PUBLIC_MEDIA = new Set([
  'preview-cover.png', 'preview-materials.jpg', 'preview-workspace.jpg',
  'dist/xiaoxian-logo.png', 'dist/leaf.svg', 'dist/cover-references/social-atlas.png', 'assets/xiaoxian-wecom-qr.jpg',
  'assets/star-history.svg', 'assets/star-history-dark.svg'
]);

export const sha256 = data => createHash('sha256').update(data).digest('hex');
export function checkedPackageVersion(pkg,lock){
  if(typeof pkg?.version!=='string'||pkg.version!==lock?.version||pkg.version!==lock?.packages?.['']?.version)throw new Error('package.json and both package-lock.json root versions must match.');
  return pkg.version;
}

export function safeSourcePath(value) {
  return typeof value === 'string' && value.length > 0 && !/[\u0000-\u001f\u007f\\]/.test(value) &&
    !value.startsWith('/') && !/^[A-Za-z]:/.test(value) && !value.split('/').some(part => !part || part === '.' || part === '..');
}

export function exclusionReason(name, mode = '100644') {
  if (!safeSourcePath(name)) return 'unsafe_path';
  const parts = name.split('/');
  if (parts.some(part => ['.git', '.local-data', 'node_modules', 'outputs', 'browser-profiles', 'private', 'credentials', 'secrets', '.ssh'].includes(part.toLowerCase()))) return 'runtime_or_private_directory';
  if (parts.some(part => /^(?:\.env(?:\..*)?|\.npmrc|\.netrc|id_rsa|id_ed25519)$/i.test(part))) return 'credential_file';
  if (/(?:^|\/)(?:overseas-config|account-preferences|credentials?|secrets?)\.(?:json|ya?ml|toml|ini)$/i.test(name) || /\.(?:pem|key|p12|pfx|keystore)$/i.test(name)) return 'credential_file';
  if (mode !== '100644' && mode !== '100755') return 'symlink_or_submodule';
  // Real issue/project exports may contain private identity images or inline
  // media. They are not needed to build the product source distribution.
  if (name.startsWith('dist/issues/') || name.startsWith('examples/github-tag-release-')) return 'creator_issue_export';
  if (MEDIA.test(name) && !PUBLIC_MEDIA.has(name) && !/^examples\/preview\/(?:0[1-5]|workflow-standards)\.png$/i.test(name)) return 'media_not_public_allowlist';
  return null;
}

export function highConfidenceSecret(data) {
  const text = Buffer.isBuffer(data) ? data.toString('utf8') : String(data);
  // Report only a category, never the matched bytes. This is a narrow safety
  // check, not a claim that arbitrary prose/media has been privacy-reviewed.
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\r\n]+[A-Za-z0-9+/=\r\n]{40,}/.test(text)) return 'private_key';
  if (/\bsk-(?:proj|svcacct)-[A-Za-z0-9_-]{32,}\b/.test(text)) return 'api_key';
  if (/\bgh[pousr]_[A-Za-z0-9]{30,}\b|\bxox[baprs]-[A-Za-z0-9-]{24,}\b/.test(text)) return 'service_token';
  return null;
}

export function parseArgs(args) {
  const result = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--help') { result.help = true; continue; }
    if (!args[i].startsWith('--') || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error('Expected --name value: ' + args[i]);
    result[args[i].slice(2)] = args[++i];
  }
  return result;
}

export async function git(repo, args, options = {}) {
  const {stdout} = await exec('git', ['-C', repo, ...args], {
    encoding: 'utf8', maxBuffer: 128 * 1024 * 1024,
    env: {...process.env, GIT_LITERAL_PATHSPECS: '1'}, ...options
  });
  return stdout;
}

export async function exactCommit(repo, requested) {
  if (!/^[a-f0-9]{40}$/.test(requested || '')) throw new Error('A full, explicit 40-character Git commit SHA is required.');
  const actual = (await git(repo, ['rev-parse', '--verify', requested + '^{commit}'])).trim();
  if (actual !== requested) throw new Error('Requested SHA does not identify that exact commit.');
  return actual;
}

export async function sourceTree(repo, commit) {
  const raw = await git(repo, ['ls-tree', '-r', '-l', '-z', '--full-tree', commit]);
  return raw.split('\0').filter(Boolean).map(line => {
    const tab = line.indexOf('\t');
    const metadata = /^(\d+) (blob|commit) ([a-f0-9]+)\s+(\d+|-)\s*$/.exec(line.slice(0, tab));
    if (!metadata || tab < 0) throw new Error('Cannot parse Git tree metadata.');
    return {mode: metadata[1], type: metadata[2], gitBlob: metadata[3], bytes: metadata[4] === '-' ? 0 : Number(metadata[4]), path: line.slice(tab + 1)};
  });
}

async function nearestExisting(directory) {
  let current = path.resolve(directory);
  for (;;) {
    try { await fs.stat(current); return current; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const parent = path.dirname(current);
    if (parent === current) throw new Error('No existing ancestor for disk preflight.');
    current = parent;
  }
}

export async function preflight(directory, operation, {expectedBytes = 0, backupBytes = 0, reserveBytes = MIN_RESERVE_BYTES, log = () => {}} = {}) {
  if (![expectedBytes, backupBytes, reserveBytes].every(value => Number.isSafeInteger(value) && value >= 0) || reserveBytes < MIN_RESERVE_BYTES) throw new Error('Release preflight requires nonnegative budgets and at least 1 GiB reserve.');
  const inspectedPath = await nearestExisting(directory);
  const stat = await fs.statfs(inspectedPath);
  const availableBytes = Number(stat.bavail) * Number(stat.bsize);
  const requiredBytes = expectedBytes + backupBytes + reserveBytes;
  const report = {type: 'disk_preflight', at: new Date().toISOString(), operation, path: inspectedPath, availableBytes, expectedBytes, backupBytes, reserveBytes, requiredBytes, ok: availableBytes >= requiredBytes};
  await log(report);
  if (!report.ok) throw new Error('Insufficient disk for ' + operation + '; required ' + requiredBytes + ', available ' + availableBytes + '. No cleanup was attempted.');
  return report;
}

export async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), {recursive: true});
  const temp = file + '.' + randomUUID() + '.tmp';
  await fs.writeFile(temp, JSON.stringify(value, null, 2) + '\n', {flag: 'wx', mode: 0o600});
  await fs.rename(temp, file);
}

export async function createReleasePackage({repo = ROOT, sha, output, log = () => {}}) {
  repo = path.resolve(repo);
  output = path.resolve(output || path.join(repo, 'release-artifacts'));
  const commit = await exactCommit(repo, sha);
  const tree = await sourceTree(repo, commit);
  const selected = tree.filter(entry => !exclusionReason(entry.path, entry.mode));
  const excluded = tree.filter(entry => exclusionReason(entry.path, entry.mode)).map(entry => ({path: entry.path, reason: exclusionReason(entry.path, entry.mode)}));
  if (!selected.some(entry => entry.path === 'package-lock.json') || !selected.some(entry => entry.path === 'server.mjs')) throw new Error('Commit lacks the lockfile or server required for a source release.');
  if (selected.reduce((total, entry) => total + Buffer.byteLength(entry.path) + 1, 0) > 96000) throw new Error('Archive path list exceeds the explicit-path budget; refusing to fall back to an unfiltered archive.');
  const sourceBytes = selected.reduce((sum, entry) => sum + entry.bytes, 0);
  const reports = [];
  const record = async value => { reports.push(value); await log(value); };
  await preflight(output, 'source-package', {expectedBytes: sourceBytes * 3 + 64 * 1024 ** 2, log: record});
  await fs.mkdir(output, {recursive: true});
  const files = [];
  for (const entry of selected) {
    const data = await git(repo, ['cat-file', 'blob', entry.gitBlob], {encoding: 'buffer'});
    const secret = highConfidenceSecret(data);
    if (secret) throw new Error('Sensitive source content (' + secret + ') in ' + entry.path + '; package was not created.');
    files.push({...entry, sha256: sha256(data)});
  }
  const packageData = await git(repo, ['show', commit + ':package.json']);
  const lockData = await git(repo, ['show', commit + ':package-lock.json']);
  const version = checkedPackageVersion(JSON.parse(packageData),JSON.parse(lockData));
  if (typeof version !== 'string' || !/^[A-Za-z0-9._-]{1,80}$/.test(version)) throw new Error('Unsafe package version.');
  const basename = 'xiaoxian-content-studio-' + version + '-' + commit.slice(0, 12);
  const archive = path.join(output, basename + '.tar.gz');
  try { await fs.lstat(archive); throw new Error('Refusing to overwrite existing archive: ' + archive); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const temporary = archive + '.' + randomUUID() + '.tmp';
  try {
    await git(repo, ['-c', 'tar.umask=0022', 'archive', '--format=tar.gz', '--prefix=' + ARCHIVE_PREFIX, '--output=' + temporary, commit, '--', ...selected.map(entry => entry.path)]);
    const bytes = await fs.readFile(temporary);
    const digest = sha256(bytes);
    await fs.rename(temporary, archive);
    const manifest = {
      schema: 1, policyVersion: RELEASE_POLICY_VERSION, sourceSha: commit,
      sourceTree: (await git(repo, ['rev-parse', commit + '^{tree}'])).trim(),
      sourceCommitTime: (await git(repo, ['show', '-s', '--format=%cI', commit])).trim(),
      packageVersion: version, prefix: ARCHIVE_PREFIX,
      archive: {file: path.basename(archive), sha256: digest, bytes: bytes.length},
      files, excluded,
      scope: 'Git-tracked source only; no working-tree/untracked files, runtime data, dependencies, creator issue exports, credentials or non-allowlisted media.',
      limitations: ['Public-media allowlist is path-based; no image-pixel privacy analysis.', 'Narrow high-confidence token scan does not prove all prose is free of sensitive information.']
    };
    const manifestPath = path.join(output, basename + '.source-manifest.json');
    await writeJson(manifestPath, manifest);
    await fs.writeFile(archive + '.sha256', digest + '  ' + path.basename(archive) + '\n', {flag: 'wx', mode: 0o600});
    await writeJson(path.join(output, basename + '.preflight.json'), reports);
    return {archive, manifest: manifestPath, checksum: archive + '.sha256', sha256: digest, sourceSha: commit, includedFiles: files.length, excludedFiles: excluded.length};
  } catch (error) {
    await fs.unlink(temporary).catch(() => {});
    throw error;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('Usage: node scripts/package-release.mjs --sha FULL_COMMIT_SHA [--repo PATH] [--output DIRECTORY]\nOnly the selected commit is archived. This command does not install, build, publish, or mutate Git.');
    return;
  }
  for (const key of Object.keys(args)) if (!['sha', 'repo', 'output'].includes(key)) throw new Error('Unknown argument: --' + key);
  const result = await createReleasePackage({repo: args.repo || ROOT, sha: args.sha, output: args.output, log: report => console.log(JSON.stringify(report))});
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });
