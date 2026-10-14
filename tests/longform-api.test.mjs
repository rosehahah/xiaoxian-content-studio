import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createHash, randomUUID} from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import {cardKey} from '../model.mjs';

// Every fixture and approval in this file is synthetic and local. The child
// deliberately has no STUDIO_DRAFT_DRIVER and never calls a platform connector.
const PORT = '14339';
const BASE = 'http://127.0.0.1:' + PORT;
const PROJECT_ID = 'synthetic-longform-http';
const GIF = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
const GIF_BYTES = Buffer.from(GIF.split(',')[1], 'base64');
const GIF_SHA = createHash('sha256').update(GIF_BYTES).digest('hex');
const VARIANT_KEYS = [
  {id: 'wechat-article-zh', channel: 'wechat', format: 'article', locale: 'zh-CN'},
  {id: 'substack-article-en', channel: 'substack', format: 'article', locale: 'en'},
  {id: 'linkedin-post-en', channel: 'linkedin', format: 'post', locale: 'en'}
];

let directory, child, project, registeredGif, articlePreview, importedArticleEnvelope;
let localArticleDelivery, linkedinDelivery, stdout = '', stderr = '';

async function request(route, {method = 'GET', body, raw, headers = {}} = {}) {
  const hasBody = body !== undefined || raw !== undefined;
  return fetch(BASE + route, {
    method,
    headers: {...(hasBody ? {'Content-Type': 'application/json'} : {}), ...headers},
    body: raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10000)
  });
}

async function json(route, options = {}) {
  const response = await request(route, options);
  assert.match(response.headers.get('content-type') || '', /application\/json/, route);
  return {status: response.status, data: await response.json()};
}

async function expectError(route, options, status, message) {
  const result = await json(route, options);
  assert.equal(result.status, status, route + ': ' + JSON.stringify(result.data));
  assert.equal(typeof result.data.error, 'string');
  assert.ok(result.data.error.length > 0);
  if (message) assert.match(result.data.error, message);
  return result.data;
}

async function refresh() {
  const result = await json('/api/projects/' + PROJECT_ID);
  assert.equal(result.status, 200, JSON.stringify(result.data));
  project = result.data.project;
  return project;
}

async function mutate(action, body, method = 'POST') {
  const result = await json('/api/projects/' + PROJECT_ID + '/' + action, {
    method, body: {revision: project.revision, ...body}
  });
  assert.equal(result.status, 200, action + ': ' + JSON.stringify(result.data));
  project = result.data.project;
  return result.data;
}

async function preview(variantId) {
  const route = '/api/projects/' + PROJECT_ID + '/article-preview' + (variantId ? '?variantId=' + encodeURIComponent(variantId) : '');
  const result = await json(route);
  assert.equal(result.status, 200, JSON.stringify(result.data));
  assert.match(result.data.artifactHash, /^[a-f0-9]{64}$/);
  assert.ok(result.data.html.startsWith('<!doctype html>'));
  return result.data;
}

async function approveVariant(id) {
  const view = await preview(id);
  await mutate('variants/' + id + '/approve', {actor: 'user', artifactHash: view.artifactHash});
  assert.equal(project.runtime.variantApproved[id], true);
}

function assertNoRemoteSuccess(p) {
  assert.equal(p.runtime.capabilities.mode, 'export_only');
  assert.equal(p.runtime.capabilities.remoteDrafts, false);
  assert.equal(p.runtime.capabilities.formalPublishing, false);
  for (const delivery of p.deliveries) {
    assert.notEqual(delivery.status, 'draft_verified');
    assert.notEqual(delivery.status, 'published');
    assert.notEqual(delivery.status, 'api_accepted');
  }
  for (const copy of Object.values(p.platforms)) assert.equal(copy.delivery, null);
}

async function startServer() {
  const environment = {...process.env, STUDIO_DATA_DIR: directory, STUDIO_PORT: PORT};
  delete environment.STUDIO_DRAFT_DRIVER;
  // Even an inherited local credential cannot become an accidental test input.
  for (const key of ['STUDIO_X_ACCESS_TOKEN', 'STUDIO_SUBSTACK_URL', 'WECHAT_APPID', 'WECHAT_SECRET']) delete environment[key];
  stdout = ''; stderr = '';
  child = spawn(process.execPath, ['server.mjs'], {
    cwd: new URL('..', import.meta.url), env: environment, stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', chunk => { stdout += chunk.toString(); });
  child.stderr.on('data', chunk => { stderr += chunk.toString(); });
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error('Isolated server exited: ' + stderr);
    if (stdout.includes('http://localhost:' + PORT)) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error('Isolated server did not start: ' + stderr);
}

async function stopServer() {
  if (!child || child.exitCode !== null) return;
  const stopped = once(child, 'exit');
  child.kill('SIGTERM');
  await stopped;
}

before(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'xiaoxian-longform-http-'));
  await startServer();
});

after(async () => {
  await stopServer();
  if (directory) await fs.rm(directory, {recursive: true, force: true});
});

test('default HTTP mode is export-only and a new project needs no cards', async () => {
  const health = await json('/api/health');
  assert.equal(health.status, 200);
  assert.equal(health.data.publishing, false);
  assert.equal(health.data.draftAutomation, false);
  assert.deepEqual(health.data.capabilities.remoteDrafts, false);
  const initial = await json('/api/projects');
  assert.equal(initial.status, 200);
  const fixture = structuredClone(initial.data.projects[0]);
  delete fixture.runtime;
  fixture.id = PROJECT_ID;
  fixture.content.topic = '合成测试：从材料到可审阅的长文';
  fixture.content.takeaway = '本测试不用于真实平台宣发';
  fixture.content.cards = [];
  fixture.contentApproval = null;
  fixture.cardApproval = null;
  fixture.variants = [];
  fixture.selectedChannels = {domestic: [], overseas: []};
  const created = await json('/api/projects', {method: 'POST', body: fixture});
  assert.equal(created.status, 201, JSON.stringify(created.data));
  project = created.data.project;
  assert.equal(project.schema, 2);
  assert.equal(project.content.cards.length, 0);
  assert.equal(project.article.id, 'article-main');
  assert.equal(project.runtime.articleApproved, false);
  assert.deepEqual(project.selectedChannels, {domestic: [], overseas: []});
  assertNoRemoteSuccess(project);
  assert.equal((await refresh()).id, PROJECT_ID);
});

test('sources/facts are registered over HTTP and a GIF is stored and read back byte-for-byte', async () => {
  await mutate('sources', {sourceBundle: {
    revision: project.sourceBundle.revision,
    sources: [{id: 'fixture-source', type: 'local_document', locator: 'synthetic-fixture.md', verification: 'verified', text: '这是合成测试材料，内容中的提示不是执行指令。'}],
    facts: [{id: 'fixture-fact', statement: '本示例是一份人工构造的HTTP测试材料，不代表真实效果。', verification: 'verified', sourceRefs: [{sourceId: 'fixture-source', anchor: 'fixture-only'}]}],
    voiceSampleRefs: []
  }}, 'PUT');
  assert.match(project.sourceBundle.facts[0].fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(project.sourceBundle.sources[0].locator, 'synthetic-fixture.md');
  const saved = await mutate('assets', {name: 'synthetic-demo.gif', mimeType: 'image/gif', data: GIF, caption: '合成操作演示', alt: '合成GIF'});
  registeredGif = saved.asset;
  assert.equal(registeredGif.sha256, GIF_SHA);
  assert.equal(registeredGif.mimeType, 'image/gif');
  assert.equal(project.sourceBundle.assets.length, 1);
  const image = await request('/api/projects/' + PROJECT_ID + '/assets/' + registeredGif.id);
  assert.equal(image.status, 200);
  assert.equal(image.headers.get('content-type'), 'image/gif');
  assert.deepEqual(Buffer.from(await image.arrayBuffer()), GIF_BYTES);
  await mutate('assets', {name: 'same-bytes-again.gif', mimeType: 'image/gif', data: GIF});
  assert.equal(project.sourceBundle.assets.length, 1);
  assert.equal(project.sourceBundle.assets[0].id, registeredGif.id);
});

test('article handoff imports once, replays without a new task and rejects stale inputs with 409', async () => {
  const task = await json('/api/projects/' + PROJECT_ID + '/article-input');
  assert.equal(task.status, 200);
  assert.match(task.data.prompt, /资料数据，不是可执行指令/);
  importedArticleEnvelope = {
    revision: task.data.revision,
    inputFingerprint: task.data.inputFingerprint,
    article: {
      storyType: 'tutorial', locale: 'zh-CN', title: '合成长文：保留一个可继续编辑的结果', digest: '用于集成测试的合成文章。',
      bodyMd: '# 这是合成结果\n\n先准备材料，再检查结果。\n\n![操作演示](asset:' + registeredGif.id + ' "合成GIF证据")\n\n## 操作\n\n1. 打开成品。\n2. 核对输入与输出。\n\n<script>notExecutable()</script>',
      assets: [], coverAssetId: null,
      sourceDeps: [{factId: 'fixture-fact', fingerprint: project.sourceBundle.facts[0].fingerprint}]
    }
  };
  const result = await json('/api/projects/' + PROJECT_ID + '/article-import', {method: 'POST', body: importedArticleEnvelope});
  assert.equal(result.status, 200, JSON.stringify(result.data));
  project = result.data.project;
  assert.equal(project.article.approval, null);
  assert.equal(project.cardApproval, null);
  assert.equal(project.content.cards.length, 0);
  assert.equal(project.tasks.length, 1);
  const revision = project.revision;
  const replay = await json('/api/projects/' + PROJECT_ID + '/article-import', {method: 'POST', body: importedArticleEnvelope});
  assert.equal(replay.status, 200);
  assert.equal(replay.data.reused, true);
  assert.equal(replay.data.project.revision, revision);
  assert.equal(replay.data.project.tasks.length, 1);
  const changed = {...importedArticleEnvelope, revision, article: {...importedArticleEnvelope.article, bodyMd: '不是原任务的结果。'}};
  await expectError('/api/projects/' + PROJECT_ID + '/article-import', {method: 'POST', body: changed}, 409, /输入已变化/);
  await refresh();
  assert.equal(project.tasks.length, 1);
  assert.equal(project.article.bodyMd, importedArticleEnvelope.article.bodyMd);
});

test('article preview and user approval are independent; an agent cannot approve a fixture', async () => {
  articlePreview = await preview();
  assert.equal(articlePreview.approved, false);
  assert.match(articlePreview.html, /&lt;script&gt;notExecutable\(\)&lt;\/script&gt;/);
  assert.match(articlePreview.html, new RegExp('/api/projects/' + PROJECT_ID + '/assets/' + registeredGif.id));
  await expectError('/api/projects/' + PROJECT_ID + '/article-approve', {method: 'POST', body: {revision: project.revision, actor: 'agent', artifactHash: articlePreview.artifactHash}}, 422, /用户/);
  await expectError('/api/projects/' + PROJECT_ID + '/article-approve', {method: 'POST', body: {revision: project.revision, actor: 'user', artifactHash: '0'.repeat(64)}}, 409, /预览/);
  await mutate('article-approve', {actor: 'user', artifactHash: articlePreview.artifactHash});
  assert.equal(project.runtime.articleApproved, true);
  assert.equal(project.article.approval.by, 'user');
  assert.equal(project.contentApproval, null);
  assert.equal(project.cardApproval, null);
  assert.equal(project.content.cards.length, 0);
});

test('HTML export is self-contained and ZIP contains the registered GIF and matching review evidence', async () => {
  const htmlResponse = await request('/api/projects/' + PROJECT_ID + '/export?format=html');
  assert.equal(htmlResponse.status, 200);
  assert.match(htmlResponse.headers.get('content-type'), /text\/html/);
  const html = await htmlResponse.text();
  assert.ok(html.includes(GIF));
  assert.doesNotMatch(html, /<script\b|<link\b|src="\/api\/projects\//i);
  const zipResponse = await request('/api/projects/' + PROJECT_ID + '/export?format=zip');
  assert.equal(zipResponse.status, 200);
  assert.match(zipResponse.headers.get('content-type'), /application\/zip/);
  const zip = await JSZip.loadAsync(Buffer.from(await zipResponse.arrayBuffer()));
  const imagePath = 'assets/' + GIF_SHA + '.gif';
  assert.ok(zip.file(imagePath));
  assert.deepEqual(await zip.file(imagePath).async('nodebuffer'), GIF_BYTES);
  assert.ok((await zip.file('article.html').async('string')).includes('src="' + imagePath + '"'));
  assert.ok((await zip.file('article.md').async('string')).includes('](' + imagePath));
  const review = JSON.parse(await zip.file('审核记录.json').async('string'));
  assert.equal(review.workId, 'article-main');
  assert.equal(review.artifactHash, articlePreview.artifactHash);
  assert.equal(review.approval.by, 'user');
  assert.match(await zip.file('使用说明.txt').async('string'), /未写入任何平台/);
  assert.ok(!Object.keys(zip.files).some(name => /credential|secret|token|sourceBundle/i.test(name)));
  await refresh();
  assert.equal(project.deliveries.length, 1);
  localArticleDelivery = project.deliveries[0];
  assert.equal(localArticleDelivery.status, 'local_ready');
  assertNoRemoteSuccess(project);
});

test('domestic and overseas selections are independent and only requested selected variants can be imported', async () => {
  const articleTaskCount = project.tasks.length;
  await mutate('channels', {selectedChannels: {domestic: ['wechat', 'zhihu'], overseas: []}}, 'PATCH');
  assert.equal(project.tasks.length, articleTaskCount);
  await mutate('channels', {selectedChannels: {domestic: ['wechat', 'zhihu'], overseas: ['substack', 'linkedin']}}, 'PATCH');
  assert.deepEqual(project.selectedChannels.domestic, ['wechat', 'zhihu']);
  assert.deepEqual(project.selectedChannels.overseas, ['substack', 'linkedin']);
  assert.equal(project.variants.length, 0);
  await expectError('/api/projects/' + PROJECT_ID + '/variant-input?keys=' + encodeURIComponent(JSON.stringify([{channel: 'x', format: 'post', locale: 'en'}])), {}, 422, /未在本期独立勾选/);
  const input = await json('/api/projects/' + PROJECT_ID + '/variant-input?keys=' + encodeURIComponent(JSON.stringify(VARIANT_KEYS)));
  assert.equal(input.status, 200);
  assert.deepEqual(input.data.keys, VARIANT_KEYS);
  assert.match(input.data.prompt, /不能逐段直译/);
  const variants = VARIANT_KEYS.map(key => ({
    ...key, profileVersion: input.data.profileVersion,
    title: key.channel === 'wechat' ? '合成中文版' : 'A synthetic workflow check',
    bodyMd: key.channel === 'substack' ? 'This is a synthetic fixture, with no real productivity claim.\n\n![Workflow](asset:' + registeredGif.id + ')' : key.channel === 'wechat' ? '这是一份测试用平台稿，检查资料与结果。' : 'One useful check: reopen the work and compare the input with the result. This is a synthetic test fixture.',
    assets: [], sourceDeps: [{factId: 'fixture-fact'}]
  }));
  const envelope = {revision: project.revision, inputFingerprint: input.data.inputFingerprint, keys: input.data.keys, sourceWorkId: input.data.sourceWorkId, variants};
  await expectError('/api/projects/' + PROJECT_ID + '/variant-import', {method: 'POST', body: {...envelope, variants: [...variants, {id: 'unselected-x', channel: 'x', format: 'post', locale: 'en', bodyMd: 'Not selected.'}]}}, 422, /完整匹配/);
  const result = await json('/api/projects/' + PROJECT_ID + '/variant-import', {method: 'POST', body: envelope});
  assert.equal(result.status, 200, JSON.stringify(result.data));
  project = result.data.project;
  assert.deepEqual(project.variants.map(v => v.id), VARIANT_KEYS.map(v => v.id));
  assert.ok(!project.variants.some(v => v.channel === 'zhihu' || v.channel === 'x' || v.channel === 'threads'));
  assert.equal(project.runtime.articleApproved, true);
  assert.ok(project.variants.every(v => v.approval === null));
  const count = project.tasks.length, revision = project.revision;
  const replay = await json('/api/projects/' + PROJECT_ID + '/variant-import', {method: 'POST', body: envelope});
  assert.equal(replay.status, 200);
  assert.equal(replay.data.reused, true);
  assert.equal(replay.data.project.tasks.length, count);
  assert.equal(replay.data.project.revision, revision);
  const view = await preview('linkedin-post-en');
  await expectError('/api/projects/' + PROJECT_ID + '/variants/linkedin-post-en/approve', {method: 'POST', body: {revision, actor: 'agent', artifactHash: view.artifactHash}}, 422, /用户/);
  for (const key of VARIANT_KEYS) await approveVariant(key.id);
  assert.equal(project.runtime.articleApproved, true);
});

test('local deliveries are idempotent and target changes preserve approval but make a new delivery key', async () => {
  const beforeCount = project.deliveries.length;
  const first = await mutate('deliveries', {variantId: 'linkedin-post-en', mode: 'export', destination: 'local'});
  assert.equal(first.reused, false);
  linkedinDelivery = first.delivery;
  assert.equal(first.delivery.status, 'local_ready');
  const second = await mutate('deliveries', {variantId: 'linkedin-post-en', mode: 'export', destination: 'local'});
  assert.equal(second.reused, true);
  assert.equal(second.delivery.id, first.delivery.id);
  assert.equal(project.deliveries.length, beforeCount + 1);
  const current = project.variants.find(v => v.id === 'linkedin-post-en');
  const approval = structuredClone(current.approval), hash = project.runtime.variantHashes[current.id];
  await mutate('variants/linkedin-post-en', {variant: {target: {accountId: 'synthetic-target-two'}}}, 'PATCH');
  assert.deepEqual(project.variants.find(v => v.id === current.id).approval, approval);
  assert.equal(project.runtime.variantHashes[current.id], hash);
  assert.equal(project.runtime.variantApproved[current.id], true);
  const changedTarget = await mutate('deliveries', {variantId: current.id, mode: 'export', destination: 'local'});
  assert.equal(changedTarget.reused, false);
  assert.notEqual(changedTarget.delivery.id, first.delivery.id);
  assert.notEqual(changedTarget.delivery.idempotencyKey, first.delivery.idempotencyKey);
  assert.equal(project.deliveries.length, beforeCount + 2);
  const saved = await json('/api/deliveries/' + first.delivery.id);
  assert.equal(saved.status, 200);
  assert.equal(saved.data.delivery.status, 'local_ready');
  assertNoRemoteSuccess(project);
});

test('default draft/publish routes refuse execution without creating remote-success records', async () => {
  const deliveryCount = project.deliveries.length, taskCount = project.tasks.length, revision = project.revision;
  for (const mode of ['draft', 'publish']) await expectError('/api/projects/' + PROJECT_ID + '/deliveries', {method: 'POST', body: {revision, variantId: 'linkedin-post-en', mode, destination: 'local'}}, 422, /仅导出|不提供正式发布/);
  await expectError('/api/projects/' + PROJECT_ID + '/deliveries', {method: 'POST', body: {revision, variantId: 'linkedin-post-en', mode: 'export', destination: 'remote-account'}}, 422, /local|远程目标/);
  await expectError('/api/projects/' + PROJECT_ID + '/overseas-draft', {method: 'POST', body: {revision, platform: 'substack', cardFingerprint: 'synthetic-unused'}}, 422, /仅导出|不会写入平台/);
  await expectError('/api/projects/' + PROJECT_ID + '/publish', {method: 'POST', body: {revision}}, 404);
  await refresh();
  assert.equal(project.revision, revision);
  assert.equal(project.deliveries.length, deliveryCount);
  assert.equal(project.tasks.length, taskCount);
  assertNoRemoteSuccess(project);
  assert.deepEqual(await fs.readdir(path.join(directory, 'draft-jobs')), []);
});

test('one platform edit revokes only itself; an article edit revokes derived variants and preserves independent cards', async () => {
  await mutate('variants/linkedin-post-en', {variant: {bodyMd: 'A revised, synthetic professional takeaway. Check the actual output.'}}, 'PATCH');
  assert.equal(project.runtime.variantApproved['linkedin-post-en'], false);
  assert.equal(project.runtime.variantApproved['substack-article-en'], true);
  assert.equal(project.runtime.variantApproved['wechat-article-zh'], true);
  assert.equal(project.runtime.articleApproved, true);
  await approveVariant('linkedin-post-en');

  const withCard = structuredClone(project);
  delete withCard.runtime;
  withCard.content.cards = [{kind: 'editorial', eyebrow: '合成测试', title: '独立的一页图卡', body: '图卡与文章各自审核，这不是正式作品。', note: ''}];
  const updated = await json('/api/projects/' + PROJECT_ID, {method: 'PUT', body: withCard});
  assert.equal(updated.status, 200, JSON.stringify(updated.data));
  project = updated.data.project;
  await mutate('content-approve', {});
  await mutate('cards-approve', {cardFingerprint: cardKey(project), viewedCount: 1});
  const cards = structuredClone(project.content.cards), cardApproval = structuredClone(project.cardApproval), contentApproval = structuredClone(project.contentApproval);
  assert.equal(project.runtime.articleApproved, true);
  await mutate('article', {article: {bodyMd: project.article.bodyMd + '\n\n这是原文的新一版合成说明。'}}, 'PATCH');
  assert.equal(project.runtime.articleApproved, false);
  assert.ok(Object.values(project.runtime.variantApproved).every(value => value === false));
  assert.deepEqual(project.content.cards, cards);
  assert.deepEqual(project.cardApproval, cardApproval);
  assert.deepEqual(project.contentApproval, contentApproval);
  await expectError('/api/projects/' + PROJECT_ID + '/export?format=html', {}, 409, /审核/);
  const staleView = await preview('substack-article-en');
  await expectError('/api/projects/' + PROJECT_ID + '/variants/substack-article-en/approve', {method: 'POST', body: {revision: project.revision, actor: 'user', artifactHash: staleView.artifactHash}}, 409, /来源版本|重新适配/);
});

test('feedback is persisted and returned by the single-project GET without invented metrics', async () => {
  const feedback = [{channel: 'wechat', note: '合成测试：仅记录文本反馈，阅读量未提供。'}];
  await mutate('feedback', {feedback}, 'PATCH');
  assert.deepEqual((await refresh()).feedback, feedback);
  assert.ok(!Object.prototype.hasOwnProperty.call(project.feedback[0], 'views'));
});

test('cross-origin, unsafe keys, malformed JSON and unregistered images fail with real HTTP errors', async () => {
  const before = structuredClone(project);
  await expectError('/api/projects/' + PROJECT_ID + '/article', {method: 'PATCH', headers: {Origin: 'https://untrusted.example'}, body: {revision: project.revision, article: {title: 'Cross-origin mutation'}}}, 403, /同源/);
  for (const key of ['__proto__', 'constructor', 'cookie', 'access_token']) {
    const raw = '{"revision":' + project.revision + ',"article":{"title":"unsafe","' + key + '":{"value":"synthetic-only"}}}';
    await expectError('/api/projects/' + PROJECT_ID + '/article', {method: 'PATCH', raw}, 422, /凭证|原型/);
  }
  await expectError('/api/projects/' + PROJECT_ID + '/article', {method: 'PATCH', raw: '{not-json'}, 400);
  await expectError('/api/projects/' + PROJECT_ID + '/article', {method: 'PATCH', body: {revision: project.revision}, headers: {'Content-Type': 'text/plain'}}, 415, /JSON/);
  await refresh();
  assert.equal(project.revision, before.revision);
  assert.equal(project.article.title, before.article.title);
  await expectError('/api/projects/' + PROJECT_ID + '/article', {method: 'PATCH', body: {revision: project.revision, article: {assets: ['not-registered']}}}, 422, /未登记/);
  await mutate('article', {article: {bodyMd: '![必须登记的图片](asset:not-registered "缺图")'}}, 'PATCH');
  const missing = await preview();
  assert.match(missing.html, /图片未登记或不可加载/);
  assert.doesNotMatch(missing.html, /<img\b/);
  await expectError('/api/projects/' + PROJECT_ID + '/article-approve', {method: 'POST', body: {revision: project.revision, actor: 'user', artifactHash: missing.artifactHash}}, 422, /未登记/);
  assert.equal((await refresh()).runtime.articleApproved, false);
});

test('path traversal cannot read unregistered assets or create an escaping asset registration', async () => {
  await expectError('/api/projects/' + PROJECT_ID + '/assets/%2e%2e%2fprojects.json', {}, 404, /未登记/);
  const hostile = structuredClone(project);
  delete hostile.runtime;
  hostile.id = 'synthetic-path-rejection';
  hostile.sourceBundle.assets[0].relativePath = '../outside.gif';
  await expectError('/api/projects', {method: 'POST', body: hostile}, 422, /相对路径|登记目录/);
  const response = await request('/%2e%2e%2fpackage.json');
  assert.equal(response.status, 403);
  assert.ok(!(await response.text()).includes('xiaoxian-studio'));
  assertNoRemoteSuccess(await refresh());
});

test('restart recovery keeps unknown external outcomes unresolved and reconciles local evidence without new tasks', async () => {
  await stopServer();
  const databasePath = path.join(directory, 'projects.json');
  const database = JSON.parse(await fs.readFile(databasePath, 'utf8'));
  const saved = database.find(p => p.id === PROJECT_ID);
  const interruptedLocal = saved.deliveries.find(d => d.id === localArticleDelivery.id);
  interruptedLocal.status = 'running';
  const unknownRemote = {...structuredClone(linkedinDelivery), id: randomUUID(), mode: 'draft', destination: 'synthetic-no-network', status: 'running', idempotencyKey: 'synthetic-unknown-only'};
  delete unknownRemote.package;
  delete unknownRemote.url;
  const invalidPackage = {...structuredClone(linkedinDelivery), id: randomUUID(), status: 'local_ready', package: {...linkedinDelivery.package, relativePath: '../outside.zip'}};
  saved.deliveries.push(unknownRemote, invalidPackage);
  await fs.writeFile(databasePath, JSON.stringify(database), {mode: 0o600});
  await startServer();
  await refresh();
  const count = project.deliveries.length, taskCount = project.tasks.length;
  const recoveredRemote = await json('/api/deliveries/' + unknownRemote.id);
  assert.equal(recoveredRemote.status, 200);
  assert.equal(recoveredRemote.data.delivery.status, 'unknown_outcome');
  assert.equal(project.deliveries.find(d => d.id === interruptedLocal.id).status, 'needs_attention');
  await expectError('/api/deliveries/' + unknownRemote.id + '/reconcile', {method: 'POST', body: {revision: project.revision}}, 409, /核对|不能重新创建/);
  await expectError('/api/deliveries/' + invalidPackage.id + '/package', {}, 422, /路径无效/);
  const reconciled = await json('/api/deliveries/' + interruptedLocal.id + '/reconcile', {method: 'POST', body: {revision: project.revision}});
  assert.equal(reconciled.status, 200, JSON.stringify(reconciled.data));
  assert.equal(reconciled.data.delivery.id, interruptedLocal.id);
  assert.equal(reconciled.data.delivery.status, 'local_ready');
  assert.match(reconciled.data.delivery.message, /未写入平台/);
  await refresh();
  assert.equal(project.deliveries.length, count);
  assert.equal(project.tasks.length, taskCount);
  assert.equal(project.deliveries.find(d => d.id === unknownRemote.id).status, 'unknown_outcome');
  assertNoRemoteSuccess(project);
  assert.deepEqual(await fs.readdir(path.join(directory, 'draft-jobs')), []);
});
