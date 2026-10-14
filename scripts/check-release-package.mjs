import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {ARCHIVE_PREFIX, RELEASE_POLICY_VERSION, MIN_RESERVE_BYTES, sha256, parseArgs, git, exactCommit, sourceTree, safeSourcePath, exclusionReason, preflight, writeJson, createReleasePackage} from './package-release.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const MiB = 1024 ** 2;

export function cleanEnvironment(taskRuntimeDir, data, base = process.env) {
  const result = {PATH: base.PATH || '', LANG: base.LANG || 'en_US.UTF-8', STUDIO_DATA_DIR: data, npm_config_cache: path.join(taskRuntimeDir, 'npm-cache'), npm_config_userconfig: path.join(taskRuntimeDir, 'empty-npm-user.conf'), npm_config_globalconfig: path.join(taskRuntimeDir, 'empty-npm-global.conf'), npm_config_audit: 'false', npm_config_fund: 'false', npm_config_registry: 'https://registry.npmjs.org/'};
  for (const key of ['HOME', 'USERPROFILE', 'SystemRoot', 'WINDIR', 'ComSpec', 'PATHEXT', 'TMPDIR', 'TMP', 'TEMP']) if (base[key]) result[key] = base[key];
  // Preserve the real home variables. Isolate npm with explicit empty configs
  // and a task cache; no credential variables, mock switch or NODE_OPTIONS.
  return result;
}

export function validateManifest(manifest, expectedSha) {
  if (manifest?.schema !== 1 || manifest.policyVersion !== RELEASE_POLICY_VERSION || manifest.prefix !== ARCHIVE_PREFIX || manifest.sourceSha !== expectedSha) throw new Error('Manifest schema/policy/prefix/source SHA mismatch.');
  if (!/^[a-f0-9]{64}$/.test(manifest.archive?.sha256 || '') || !Array.isArray(manifest.files) || !manifest.files.length) throw new Error('Incomplete source manifest.');
  const seen = new Set();
  for (const entry of manifest.files) {
    if (!safeSourcePath(entry.path) || exclusionReason(entry.path, entry.mode) || seen.has(entry.path) || !/^[a-f0-9]{64}$/.test(entry.sha256 || '') || !/^[a-f0-9]{40}$/.test(entry.gitBlob || '') || !Number.isSafeInteger(entry.bytes) || entry.bytes < 0) throw new Error('Unsafe or duplicate manifest entry.');
    seen.add(entry.path);
  }
  return manifest;
}

export function validateTarListing(names, verbose, manifest) {
  const files = new Set(manifest.files.map(entry => manifest.prefix + entry.path));
  const found = new Set();
  for (const line of names.split('\n').filter(Boolean)) {
    const directory = line.endsWith('/');
    const relative = line.slice(manifest.prefix.length).replace(/\/$/, '');
    if (!line.startsWith(manifest.prefix) || (relative && !safeSourcePath(relative))) throw new Error('Unsafe archive member: ' + line);
    if (!directory) {
      if (!files.has(line) || found.has(line)) throw new Error('Unexpected or duplicate archive file: ' + line);
      found.add(line);
    }
  }
  if (found.size !== files.size) throw new Error('Archive does not contain every manifest source file.');
  for (const line of verbose.split('\n').filter(Boolean)) if (!['-', 'd'].includes(line[0])) throw new Error('Archive contains a link or special file.');
}

export async function verifyExtractedFiles(checkout, manifest) {
  const realRoot = await fs.realpath(checkout);
  for (const entry of manifest.files) {
    const file = path.join(checkout, entry.path), stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== entry.bytes || (stat.mode & 0o7777) !== parseInt(entry.mode.slice(-3), 8)) throw new Error('Extracted source type/size/mode mismatch: ' + entry.path);
    const real = await fs.realpath(file);
    if (!real.startsWith(realRoot + path.sep) || sha256(await fs.readFile(real)) !== entry.sha256) throw new Error('Extracted source SHA-256 mismatch: ' + entry.path);
  }
}

export function testCounts(output) {
  const count = name => Number([...output.matchAll(new RegExp('^# ' + name + ' (\\d+)$', 'gm'))].at(-1)?.[1] ?? NaN);
  const result = {tests: count('tests'), passed: count('pass'), failed: count('fail'), skipped: count('skipped')};
  if (!Object.values(result).every(Number.isFinite) || result.tests < 1 || result.failed !== 0 || result.passed + result.failed + result.skipped !== result.tests) throw new Error('Test command did not report a nonempty, zero-failure TAP suite.');
  return result;
}

async function run(command, args, {cwd, env, logFile, timeout = 15 * 60 * 1000}) {
  const handle = await fs.open(logFile, 'w', 0o600);
  let output = '', timedOut = false;
  const child = spawn(command, args, {cwd, env, stdio: ['ignore', 'pipe', 'pipe']});
  let writing = Promise.resolve();
  const append = chunk => { const text = chunk.toString(); output += text; writing = writing.then(() => handle.write(text)); process.stdout.write(text); };
  child.stdout.on('data', append); child.stderr.on('data', append);
  const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); setTimeout(() => child.kill('SIGKILL'), 5000).unref(); }, timeout);
  try {
    const [code] = await once(child, 'exit');
    await writing;
    if (timedOut || code !== 0) throw new Error(command + ' ' + args.join(' ') + ' failed; see ' + logFile);
    return output;
  } finally { clearTimeout(timer); await handle.close(); }
}

async function freePort() {
  const socket = net.createServer();
  await new Promise((resolve, reject) => { socket.once('error', reject); socket.listen(0, '127.0.0.1', resolve); });
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  return port;
}

async function runtimeGuard(file) {
  // Server checks cannot spawn platform commands or make outbound connections.
  // The old rollback HTTP listener additionally rejects every write method.
  await fs.writeFile(file, `const net=require('node:net'),cp=require('node:child_process'),http=require('node:http');
net.Socket.prototype.connect=function(){throw new Error('Outbound network disabled in release validation server');};
for(const name of ['exec','execFile','execSync','execFileSync','spawn','spawnSync','fork'])cp[name]=function(){throw new Error('Subprocess disabled in release validation server');};
if(process.env.STUDIO_RELEASE_READ_ONLY==='1'){const create=http.createServer;http.createServer=function(...args){const index=typeof args[0]==='function'?0:1;const listener=args[index];args[index]=(req,res)=>{if(!['GET','HEAD'].includes(req.method)){res.writeHead(403,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'Release rollback probe is read-only'}));return;}return listener(req,res);};return create.apply(this,args);};}
require('node:module').syncBuiltinESMExports();\n`, {mode: 0o600});
}

async function withServer(checkout, env, guard, logFile, operation, {readOnly = false} = {}) {
  const port = await freePort(), base = 'http://127.0.0.1:' + port;
  const handle = await fs.open(logFile, 'w', 0o600);
  const child = spawn(process.execPath, ['--require', guard, 'server.mjs'], {
    cwd: checkout, env: {...env, STUDIO_PORT: String(port), ...(readOnly ? {STUDIO_RELEASE_READ_ONLY: '1'} : {})}, stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  let writing = Promise.resolve();
  const append = chunk => { output += chunk.toString(); writing = writing.then(() => handle.write(chunk)); };
  child.stdout.on('data', append); child.stderr.on('data', append);
  try {
    const deadline = Date.now() + 15000;
    while (!output.includes('http://localhost:' + port)) {
      if (child.exitCode !== null) throw new Error('Validation server exited; see ' + logFile);
      if (Date.now() > deadline) throw new Error('Validation server startup timed out; see ' + logFile);
      await new Promise(resolve => setTimeout(resolve, 30));
    }
    return await operation(base);
  } finally {
    if (child.exitCode === null) {
      const exit = once(child, 'exit'); child.kill('SIGTERM');
      const force = setTimeout(() => child.kill('SIGKILL'), 5000);
      await exit; clearTimeout(force);
    }
    await writing; await handle.close();
  }
}

async function getJson(base, route, options = {}) {
  const response = await fetch(base + route, {...options, signal: AbortSignal.timeout(10000)});
  return {status: response.status, body: await response.json()};
}

async function extractVerified(archive, manifest, destination, log, evidence, label) {
  const bytes = await fs.readFile(archive);
  if (bytes.length !== manifest.archive.bytes || sha256(bytes) !== manifest.archive.sha256) throw new Error('Archive bytes do not match source manifest.');
  await preflight(destination, label + '-extract', {expectedBytes: manifest.files.reduce((sum, file) => sum + file.bytes, 0) * 2 + 32 * MiB, log});
  const listed = await run('tar', ['-tzf', archive], {cwd: destination, env: process.env, logFile: path.join(evidence, label + '-archive-members.log')});
  const verbose = await run('tar', ['-tvzf', archive], {cwd: destination, env: process.env, logFile: path.join(evidence, label + '-archive-types.log')});
  validateTarListing(listed, verbose, manifest);
  await run('tar', ['-xzf', archive, '-C', destination, '--no-same-owner'], {cwd: destination, env: process.env, logFile: path.join(evidence, label + '-extract.log')});
  const checkout = path.join(destination, manifest.prefix);
  await verifyExtractedFiles(checkout, manifest);
  return checkout;
}

function assertPreserved(oldProject, nextProject) {
  for (const key of ['id', 'content', 'visual', 'contentApproval', 'cardApproval', 'customRollbackMarker']) {
    if (JSON.stringify(oldProject[key]) !== JSON.stringify(nextProject[key])) throw new Error('Migration changed legacy field: ' + key);
  }
  if (JSON.stringify(oldProject.platforms.wechat) !== JSON.stringify(nextProject.platforms.wechat)) throw new Error('Migration lost the legacy unknown-outcome history.');
}

export async function checkReleasePackage(args) {
  const repo = path.resolve(args.repo || ROOT), expectedSha = await exactCommit(repo, args.sha);
  const archive = path.resolve(args.archive || ''), manifestPath = path.resolve(args.manifest || '');
  if (!args.archive || !args.manifest) throw new Error('--archive and --manifest are required.');
  const manifest = validateManifest(JSON.parse(await fs.readFile(manifestPath, 'utf8')), expectedSha);
  const tree = await sourceTree(repo, expectedSha), byPath = new Map(tree.map(entry => [entry.path, entry]));
  const expectedPaths = tree.filter(entry => !exclusionReason(entry.path, entry.mode)).map(entry => entry.path).sort();
  if (JSON.stringify(manifest.files.map(file => file.path).sort()) !== JSON.stringify(expectedPaths)) throw new Error('Manifest omits or adds paths relative to the selected commit and release policy.');
  for (const file of manifest.files) if (byPath.get(file.path)?.gitBlob !== file.gitBlob || byPath.get(file.path)?.mode !== file.mode || byPath.get(file.path)?.bytes !== file.bytes || sha256(await git(repo, ['cat-file', 'blob', file.gitBlob], {encoding: 'buffer'})) !== file.sha256) throw new Error('Manifest does not match Git source: ' + file.path);
  const rollbackRef = args['rollback-ref'] || 'v1.2.0';
  if (!/^[A-Za-z0-9._-]+$/.test(rollbackRef)) throw new Error('Rollback reference must name a local tag.');
  await git(repo, ['show-ref', '--verify', 'refs/tags/' + rollbackRef]);
  const rollbackSha = (await git(repo, ['rev-parse', 'refs/tags/' + rollbackRef + '^{commit}'])).trim();
  const evidence = path.resolve(args.evidence || path.join(path.dirname(archive), 'check-' + expectedSha.slice(0, 12)));
  await fs.mkdir(evidence, {recursive: true});
  let scratch;
  if (args.keep) { scratch = path.resolve(args.keep); await fs.mkdir(scratch); }
  else scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'xiaoxian-release-check-'));
  const report = {schema: 1, status: 'running', sourceSha: expectedSha, archiveSha256: manifest.archive.sha256, rollbackRef, rollbackSha, startedAt: new Date().toISOString(), scratch, phases: [], preflights: [], remoteWrites: 0, limitations: ['No real platform credentials, drafts, publishing, email or account permissions are exercised.', 'Only synthetic schema 1 data is migrated; private user databases and media are not read.', 'Archive source validation does not perform image-pixel privacy analysis.']};
  const log = async value => { report.preflights.push(value); console.log(JSON.stringify(value)); await writeJson(path.join(evidence, 'release-check.json'), report); };
  const phase = async (name, operation) => {
    const item = {name, status: 'running', startedAt: new Date().toISOString()}; report.phases.push(item);
    try { const result = await operation(); Object.assign(item, {status: 'passed', finishedAt: new Date().toISOString(), ...(result || {})}); return result; }
    catch (error) { Object.assign(item, {status: 'failed', error: error.message, finishedAt: new Date().toISOString()}); throw error; }
    finally { await writeJson(path.join(evidence, 'release-check.json'), report); }
  };
  const taskRuntimeDir = path.join(scratch, 'isolated-runtime'), emptyData = path.join(scratch, 'empty-data'), guard = path.join(scratch, 'server-guard.cjs');
  await fs.mkdir(taskRuntimeDir); await fs.mkdir(emptyData); await runtimeGuard(guard);
  await fs.writeFile(path.join(taskRuntimeDir, 'empty-npm-user.conf'), '', {mode: 0o600});
  await fs.writeFile(path.join(taskRuntimeDir, 'empty-npm-global.conf'), '', {mode: 0o600});
  const env = cleanEnvironment(taskRuntimeDir, emptyData);
  const installBudget = Number(args['install-budget-mib'] || 2048) * MiB, buildBudget = Number(args['build-budget-mib'] || 512) * MiB;
  try {
    const checkout = await phase('candidate-source-verification', async () => ({checkout: await extractVerified(archive, manifest, scratch, log, evidence, 'candidate')}));
    report.checkout = checkout.checkout;
    await phase('candidate-npm-ci', async () => { await preflight(scratch, 'candidate-install', {expectedBytes: installBudget, log}); await run('npm', ['ci'], {cwd: report.checkout, env, logFile: path.join(evidence, 'candidate-npm-ci.log')}); });
    await phase('candidate-build', async () => { await preflight(scratch, 'candidate-build', {expectedBytes: buildBudget, log}); await run('npm', ['run', 'build'], {cwd: report.checkout, env, logFile: path.join(evidence, 'candidate-build.log')}); });
    await phase('candidate-test', async () => { await preflight(scratch, 'candidate-test', {expectedBytes: 256 * MiB, log}); const output = await run('npm', ['run', 'test:ci'], {cwd: report.checkout, env, logFile: path.join(evidence, 'candidate-test.log')}); return {command: 'npm run test:ci', counts: testCounts(output), skipPolicy: 'The archived test:ci command must enforce the declared Ego skip allowlist; skips remain reported separately.'}; });
    await phase('candidate-empty-startup', async () => withServer(report.checkout, env, guard, path.join(evidence, 'candidate-server.log'), async base => {
      const health = await getJson(base, '/api/health');
      if (health.status !== 200 || health.body.capabilities?.mode !== 'export_only' || health.body.capabilities?.remoteDrafts !== false || health.body.capabilities?.formalPublishing !== false || health.body.publishing !== false || health.body.draftAutomation !== false) throw new Error('Default startup is not export-only with remote operations disabled.');
      const projects = await getJson(base, '/api/projects'), p = projects.body.projects?.[0];
      if (projects.status !== 200 || !p) throw new Error('Empty database did not start with a local project.');
      for (const mode of ['draft', 'publish']) {
        const response = await getJson(base, '/api/projects/' + p.id + '/deliveries', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({revision: p.revision, mode, variantId: 'article-main', destination: 'local'})});
        if (response.status !== 422 || typeof response.body.error !== 'string') throw new Error('Default ' + mode + ' operation was not explicitly refused.');
      }
      return {health: {mode: health.body.capabilities.mode, remoteDrafts: false, formalPublishing: false}, credentialEnvironment: 'allowlisted-no-credential-variables', npmConfig: 'task-cache-and-explicit-empty-configs', outboundGuard: true};
    }));
    const oldOutput = path.join(scratch, 'rollback-archive');
    const rollbackPackage = await phase('rollback-source-package', async () => createReleasePackage({repo, sha: rollbackSha, output: oldOutput, log}));
    const oldManifest = validateManifest(JSON.parse(await fs.readFile(rollbackPackage.manifest, 'utf8')), rollbackSha);
    const oldUnpack = path.join(scratch, 'rollback-unpack'); await fs.mkdir(oldUnpack);
    const oldCheckout = await extractVerified(rollbackPackage.archive, oldManifest, oldUnpack, log, evidence, 'rollback');
    await phase('rollback-install', async () => { await preflight(scratch, 'rollback-install', {expectedBytes: installBudget, log}); await run('npm', ['ci'], {cwd: oldCheckout, env, logFile: path.join(evidence, 'rollback-npm-ci.log')}); });
    await phase('rollback-build', async () => { await preflight(scratch, 'rollback-build', {expectedBytes: buildBudget, log}); await run('npm', ['run', 'build'], {cwd: oldCheckout, env, logFile: path.join(evidence, 'rollback-build.log')}); });
    const fixtureOutput = await run(process.execPath, ['--input-type=module', '-e', `const m=await import(process.argv[1]);const p=m.seedProject();p.id='synthetic-schema1-rollback';p.content.topic='合成 schema 1 回滚验收';p.contentApproval={by:'user',fingerprint:m.contentKey(p)};p.cardApproval={by:'user',fingerprint:m.cardKey(p)};p.platforms.wechat.delivery={status:'uncertain',outcome:'unknown',marker:'SYNTHETIC_UNKNOWN_DO_NOT_CREATE'};p.platforms.wechat.history=[{status:'uncertain',outcome:'unknown',marker:'SYNTHETIC_HISTORY_ONLY'}];p.customRollbackMarker='synthetic-only';m.validateProject(p);console.log(JSON.stringify([p],null,2));`, pathToFileURL(path.join(oldCheckout, 'model.mjs')).href], {cwd: oldCheckout, env, logFile: path.join(evidence, 'schema1-fixture.log')});
    const original = Buffer.from(fixtureOutput), originalProjects = JSON.parse(fixtureOutput), originalSha = sha256(original);
    const originalFile = path.join(evidence, 'schema1-original-readonly.json'); await fs.writeFile(originalFile, original, {flag: 'wx', mode: 0o444});
    const migrationData = path.join(scratch, 'migration-data'); await fs.mkdir(migrationData);
    await phase('schema1-upgrade', async () => {
      await preflight(migrationData, 'schema1-migration', {expectedBytes: original.length * 4 + 32 * MiB, backupBytes: original.length, log});
      await fs.writeFile(path.join(migrationData, 'projects.json'), original, {mode: 0o600});
      await withServer(report.checkout, {...env, STUDIO_DATA_DIR: migrationData}, guard, path.join(evidence, 'migration-server.log'), async base => {
        const response = await getJson(base, '/api/projects'), migrated = response.body.projects?.[0];
        if (response.status !== 200 || migrated?.schema !== 2) throw new Error('Schema 1 fixture was not migrated to schema 2.');
        assertPreserved(originalProjects[0], migrated);
      });
      const backupFiles = (await fs.readdir(path.join(migrationData, 'backups'))).filter(name => name.startsWith('projects-schema1-'));
      if (backupFiles.length !== 1) throw new Error('Migration did not leave exactly one original backup.');
      const backup = await fs.readFile(path.join(migrationData, 'backups', backupFiles[0]));
      if (sha256(backup) !== originalSha || !backup.equals(original)) throw new Error('Original migration backup was changed.');
      const stableBackup = path.join(evidence, 'schema1-migration-backup-readonly.json'); await fs.writeFile(stableBackup, backup, {flag: 'wx', mode: 0o444});
      const upgraded = await fs.readFile(path.join(migrationData, 'projects.json')); await fs.writeFile(path.join(evidence, 'schema2-migrated-synthetic.json'), upgraded, {mode: 0o600});
      report.originalSchema1 = {sha256: originalSha, original: originalFile, backup: stableBackup, unchanged: true};
      return {originalSha256: originalSha, backupSha256: sha256(backup), schema: 2, unknownHistoryPreserved: true};
    });
    await phase('schema1-readonly-rollback', async () => {
      const rollbackData = path.join(scratch, 'rollback-data'); await fs.mkdir(rollbackData);
      await preflight(rollbackData, 'schema1-rollback-copy', {expectedBytes: original.length * 3 + 32 * MiB, backupBytes: original.length, log});
      // The old server rewrites projects.json on startup. Give it a disposable
      // copy; the preserved backup is read-only and is never its data directory.
      const backup = await fs.readFile(report.originalSchema1.backup);
      await fs.writeFile(path.join(rollbackData, 'projects.json'), backup, {mode: 0o600});
      await withServer(oldCheckout, {...env, STUDIO_DATA_DIR: rollbackData}, guard, path.join(evidence, 'rollback-server.log'), async base => {
        const response = await getJson(base, '/api/projects'), restored = response.body.projects?.[0];
        if (response.status !== 200 || restored?.schema !== 1) throw new Error('Old archive did not reopen the schema 1 backup.');
        assertPreserved(originalProjects[0], restored);
        const denied = await getJson(base, '/api/projects', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: '{}'});
        if (denied.status !== 403) throw new Error('Rollback probe was not read-only.');
      }, {readOnly: true});
      if (sha256(await fs.readFile(originalFile)) !== originalSha || sha256(await fs.readFile(report.originalSchema1.backup)) !== originalSha) throw new Error('Read-only original/backup changed during rollback.');
      return {restoredSchema: 1, originalSha256: originalSha, backupUnchanged: true, unknownHistoryPreserved: true, readOnlyHttpGuard: true, productionRollbackExecuted: false};
    });
    const egoSpace = args['ego-space'] || process.env.STUDIO_EGO_SPACE;
    if (egoSpace) {
      if (!/^[1-9]\d*$/.test(egoSpace)) throw new Error('STUDIO_EGO_SPACE must be an existing numeric TaskSpace; a new space is never created.');
      await phase('R03-packaged-ego-flow', async () => {
        await verifyExtractedFiles(report.checkout, manifest);
        await preflight(scratch, 'R03-ego-browser-check', {expectedBytes: 256 * MiB, log});
        const output = path.join(evidence, 'R03-ego');
        const uiEnv = {...env, STUDIO_EGO_SPACE: egoSpace, STUDIO_PACKAGE_SHA: expectedSha, STUDIO_UI_OUTPUT: output};
        if (process.env.CODEX_HOME) uiEnv.CODEX_HOME = process.env.CODEX_HOME;
        await run('npm', ['run', 'test:longform-ui'], {cwd: report.checkout, env: uiEnv, logFile: path.join(evidence, 'R03-ego.log')});
        const result = JSON.parse(await fs.readFile(path.join(output, 'results.json'), 'utf8'));
        if (result.status !== 'pass' || result.sha !== expectedSha || result.sourceKind !== 'release_archive' || result.syntheticOnly !== true || result.remoteWrites !== 0) throw new Error('Packaged Ego result does not match the verified source archive and synthetic-only boundary.');
        return {spaceId: Number(egoSpace), evidence: output, result};
      });
    } else report.phases.push({name: 'R03-packaged-ego-flow', status: 'not_run', reason: 'No existing STUDIO_EGO_SPACE was supplied; no TaskSpace was created.'});
    report.status = 'passed';
    report.kept = Boolean(args.keep);
    report.finishedAt = new Date().toISOString();
    await writeJson(path.join(evidence, 'release-check.json'), report);
    return report;
  } catch (error) {
    report.status = 'failed'; report.error = error.message; report.kept = true; report.finishedAt = new Date().toISOString();
    await writeJson(path.join(evidence, 'release-check.json'), report);
    throw error;
  } finally {
    if (report.status === 'passed' && !args.keep) await fs.rm(scratch, {recursive: true, force: true});
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { console.log('Usage: node scripts/check-release-package.mjs --sha FULL_SHA --archive FILE.tar.gz --manifest FILE.source-manifest.json [--repo PATH] [--rollback-ref v1.2.0] [--evidence DIRECTORY] [--keep NEW_DIRECTORY] [--ego-space EXISTING_ID]\nRuns isolated npm ci/build/test:ci, export-only startup, synthetic migration and read-only backup rollback. Existing STUDIO_EGO_SPACE enables packaged Ego UI checks. No remote platform write is permitted.'); return; }
  for (const key of Object.keys(args)) if (!['sha', 'archive', 'manifest', 'repo', 'rollback-ref', 'evidence', 'keep', 'ego-space', 'install-budget-mib', 'build-budget-mib'].includes(key)) throw new Error('Unknown argument: --' + key);
  const result = await checkReleasePackage(args);
  console.log(JSON.stringify({status: result.status, sourceSha: result.sourceSha, archiveSha256: result.archiveSha256, keptCheckout: result.kept ? result.checkout : null, phases: result.phases.map(phase => ({name: phase.name, status: phase.status}))}, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });
