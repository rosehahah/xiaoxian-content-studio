import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {renderMarkdown, renderArticleDocument} from '../article-render.mjs';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j6WQAAAAASUVORK5CYII=';
const GIF = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
const assets = [
  {id: 'result-1', mimeType: 'image/png', sha256: 'a'.repeat(64), name: 'result.png', caption: '实际成品', alt: '成品截图'},
  {id: 'steps-gif', mime: 'image/gif', sha256: 'b'.repeat(64), caption: '操作过程', alt: '打开与操作演示'}
];
const assetUrl = id => id === 'result-1' ? PNG : GIF;

function emittedTags(html) {
  return html.match(/<[^>]+>/g) || [];
}

function assertNoExecutableTags(html) {
  for (const tag of emittedTags(html)) {
    assert.doesNotMatch(tag, /^<\/?(?:script|iframe|object|embed|svg|math|form|input|button|link|base)\b/i);
    assert.doesNotMatch(tag, /\son[a-z]+\s*=/i);
    assert.doesNotMatch(tag, /(?:href|src)\s*=\s*["']?(?:javascript|vbscript|file|blob):/i);
  }
}

test('renders headings, paragraphs, emphasis, quotes, code and nested lists', () => {
  const html = renderMarkdown('# 文章标题\n\n读者得到**方法**，保留*语气*和`a < b`。\n\n> 一个具体问题\n>\n> 第二段\n\n3. 输入材料\n4. 打开成品\n   - 检查图片\n   - 修改文字\n\n## 下一步\n\n```js\nconst text = "<script>alert(1)</script>";\n```');
  assert.match(html, /<h1>文章标题<\/h1>/);
  assert.match(html, /<strong>方法<\/strong>/);
  assert.match(html, /<em>语气<\/em>/);
  assert.match(html, /<code>a &lt; b<\/code>/);
  assert.match(html, /<blockquote><p>一个具体问题<\/p>\n<p>第二段<\/p><\/blockquote>/);
  assert.match(html, /<ol start="3">/);
  assert.match(html, /<ul><li><p>检查图片<\/p><\/li>/);
  assert.match(html, /class="article-code-scroll"[^>]*><pre><code class="language-js">/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assertNoExecutableTags(html);
});

test('renders setext headings, hard line breaks and unclosed code fences safely', () => {
  const html = renderMarkdown('说明标题\n====\n\n第一行  \n第二行\\\n第三行\n\n~~~\n<svg onload="alert(1)">');
  assert.match(html, /<h1>说明标题<\/h1>/);
  assert.match(html, /第一行<br>\n第二行<br>\n第三行/);
  assert.match(html, /<pre><code>&lt;svg onload=&quot;alert\(1\)&quot;&gt;<\/code><\/pre>/);
  assertNoExecutableTags(html);
});

test('renders tables in a local scroll region and handles escaped and code pipes', () => {
  const html = renderMarkdown('| 输入 | 输出 |\n| :--- | ---: |\n| `a|b` | **成品** |\n| a\\|b | [来源](https://example.com/source) |');
  assert.match(html, /class="article-table-scroll" tabindex="0" role="region" aria-label="表格"/);
  assert.match(html, /<th scope="col" style="text-align:left">输入<\/th>/);
  assert.match(html, /<th scope="col" style="text-align:right">输出<\/th>/);
  assert.match(html, /<code>a\|b<\/code>/);
  assert.match(html, /<td style="text-align:left">a\|b<\/td>/);
  assert.match(html, /<strong>成品<\/strong>/);
  assert.match(html, /href="https:\/\/example.com\/source"/);
});

test('raw HTML, HTML entities and code text stay content rather than markup', () => {
  const html = renderMarkdown('<script>globalThis.compromised = true</script>\n\n<img src=x onerror=alert(1)>\n\n<svg><a onload=alert(1)></a></svg>\n\n&lt;img src=x onerror=alert(1)&gt;\n\n`<iframe srcdoc="<script>bad()</script>">`');
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /&amp;lt;img/);
  assert.match(html, /&lt;iframe srcdoc=&quot;/);
  assertNoExecutableTags(html);
});

test('script, encoded and browser-repaired URL schemes never become links', () => {
  const destinations = [
    'javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'java%73cript:alert(1)', '%6a%61vascript:alert(1)',
    '&#106;avascript:alert(1)', 'javascript&#58;alert(1)', 'javascript&colon;alert(1)',
    'java\tscript:alert(1)', 'java\u0000script:alert(1)', 'data:text/html;base64,PHNjcmlwdD4=',
    'vbscript:msgbox(1)', 'file:///etc/passwd', '//evil.example/path', 'https:evil.example/path',
    'https://good.example\\@evil.example/path'
  ];
  for (const destination of destinations) {
    const html = renderMarkdown(`[原始资料](${destination})`);
    assert.doesNotMatch(html, /<a\b/, destination);
    assertNoExecutableTags(html);
  }
});

test('HTTP(S) links support balanced parentheses and escape titles and query strings', () => {
  const html = renderMarkdown('[原始资料](https://example.com/method_(v2)?a=1&b=2 "来源 <原文>")\n\n<http://example.com/help>');
  assert.match(html, /href="https:\/\/example.com\/method_\(v2\)\?a=1&amp;b=2"/);
  assert.match(html, /title="来源 &lt;原文&gt;"/);
  assert.match(html, /rel="noopener noreferrer"/);
  assert.match(html, /href="http:\/\/example.com\/help"/);
  assertNoExecutableTags(html);
});

test('registered PNG and GIF preserve their source, alt and captions', () => {
  const html = renderMarkdown('![本次成品](asset:result-1)\n\n![打开与操作](asset:steps-gif "操作实录")', {assets, assetUrl});
  assert.match(html, /<figure class="article-figure"><img src="data:image\/png;base64,/);
  assert.match(html, /alt="本次成品"/);
  assert.match(html, /<figcaption>实际成品<\/figcaption>/);
  assert.match(html, /src="data:image\/gif;base64,R0lGODlh/);
  assert.match(html, /<figcaption>操作实录<\/figcaption>/);
  assert.equal((html.match(/<img\b/g) || []).length, 2);
  assertNoExecutableTags(html);
});

test('Markdown remote, data, SVG, file and unknown asset images become visible placeholders', () => {
  const urls = [
    'https://tracker.example/a.png', '//tracker.example/a.png', PNG,
    'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=', 'file:///private/a.png', 'asset:missing', 'asset:../result-1'
  ];
  const requested = [];
  for (const url of urls) {
    const html = renderMarkdown(`![操作图](${url})`, {assets, assetUrl: id => { requested.push(id); return PNG; }});
    assert.doesNotMatch(html, /<img\b/, url);
    assert.match(html, /图片未登记或不可加载：操作图/);
    assertNoExecutableTags(html);
  }
  assert.deepEqual(requested, []);
});

test('asset MIME, resolver return, duplicate IDs and data signatures are independently checked', () => {
  const invalid = [
    {registry: [{id: 'result-1', mimeType: 'image/svg+xml'}], resolved: PNG},
    {registry: assets, resolved: 'javascript:alert(1)'},
    {registry: assets, resolved: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4='},
    {registry: assets, resolved: 'data:image/png;base64,PHN2Zz48L3N2Zz4='},
    {registry: assets, resolved: GIF},
    {registry: assets, resolved: 'blob:https://example.com/uuid'},
    {registry: assets, resolved: 'assets/../secret.png'},
    {registry: assets, resolved: 'assets/%252e%252e/secret.png'},
    {registry: assets, resolved: '//evil.example/picture.png'},
    {registry: assets, resolved: '/api/delete?id=123'},
    {registry: [assets[0], assets[0]], resolved: PNG}
  ];
  for (const entry of invalid) {
    const html = renderMarkdown('![结果](asset:result-1)', {assets: entry.registry, assetUrl: () => entry.resolved});
    assert.doesNotMatch(html, /<img\b/);
    assert.match(html, /article-missing-asset/);
    assertNoExecutableTags(html);
  }
  assert.match(renderMarkdown('![结果](asset:result-1)', {assets, assetUrl: () => { throw new Error('offline'); }}), /article-missing-asset/);
});

test('resolver can use local registered routes and package paths; registry HTTP URL does not load by default', () => {
  for (const url of ['assets/result-1.png', './assets/result-1.png', '/api/projects/project-1/assets/result-1', 'https://cdn.example.com/registered.png']) {
    const html = renderMarkdown('![结果](asset:result-1)', {assets, assetUrl: () => url});
    assert.match(html, /<img\b/);
    assert.ok(html.includes(`src="${url}"`));
  }
  const remoteRegistry = [{...assets[0], url: 'https://tracker.example/registered.png'}];
  assert.doesNotMatch(renderMarkdown('![结果](asset:result-1)', {assets: remoteRegistry}), /<img\b/);
  const localRegistry = [{...assets[0], url: 'assets/result-1.png'}];
  assert.match(renderMarkdown('![结果](asset:result-1)', {assets: localRegistry}), /src="assets\/result-1.png"/);
});

test('untrusted alt text, captions and heading content cannot introduce attributes', () => {
  const registry = [{...assets[0], alt: '" onerror="bad()', caption: '</figcaption><script>bad()</script>'}];
  const html = renderMarkdown('# <img onerror=bad()>\n\n![](asset:result-1)', {assets: registry, assetUrl});
  assert.match(html, /alt="&quot; onerror=&quot;bad\(\)"/);
  assert.match(html, /&lt;\/figcaption&gt;&lt;script&gt;/);
  // This is escaped inside the alt attribute, not an emitted event handler.
  assert.doesNotMatch(html, /<img[^>]* alt="[^"<>]*"\s+onerror=/i);
  assert.doesNotMatch(html, /<script\b/i);
});

test('full document prioritizes bodyMd, escapes metadata and applies registered per-article captions', () => {
  const article = {
    title: '</h1><script>bad()</script>', digest: '<img onerror=bad()>', locale: 'en-US',
    bodyMd: '## Result\n\n![Result](asset:result-1)', markdown: 'WRONG', body: 'WRONG', author: 'Not an automatic byline',
    assets: [{assetId: 'result-1', caption: 'This result <verified>', alt: 'Result image'}]
  };
  const html = renderArticleDocument(article, {assets, assetUrl});
  assert.match(html, /^<!doctype html>\n<html lang="en-US">/);
  assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1">/);
  assert.match(html, /<title>&lt;\/h1&gt;&lt;script&gt;bad\(\)&lt;\/script&gt;<\/title>/);
  assert.match(html, /<p class="article-digest">&lt;img onerror=bad\(\)&gt;<\/p>/);
  assert.match(html, /<figcaption>This result &lt;verified&gt;<\/figcaption>/);
  assert.match(html, /<h2>Result<\/h2>/);
  assert.doesNotMatch(html, /WRONG|Not an automatic byline/);
  assertNoExecutableTags(html);
});

test('long words, inline code, preformatted code and wide tables have local containment rules', () => {
  const long = 'unbroken'.repeat(2000);
  const html = renderArticleDocument({title: long, bodyMd: `${long}\n\n\`${long}\`\n\n\`\`\`\n${long}\n\`\`\`\n\n| a | b | c |\n| --- | --- | --- |\n| ${long} | b | c |`});
  assert.match(html, /max-width:720px/);
  assert.match(html, /overflow-wrap:anywhere/);
  assert.match(html, /\.article-code-scroll,\.article-table-scroll\{[^}]*max-width:100%;[^}]*overflow-x:auto/);
  assert.match(html, /\.article-code-scroll code\{[^}]*white-space:pre;overflow-wrap:normal/);
  assert.match(html, /@media\(max-width:430px\)/);
  assert.equal((html.match(/class="article-code-scroll"/g) || []).length, 1);
  assert.equal((html.match(/class="article-table-scroll"/g) || []).length, 1);
  assert.ok(html.includes(long));
  // These are structure/layout contracts, not a claim that a browser was run.
});

test('empty/malformed input, empty list items and deep nesting terminate safely', () => {
  assert.equal(renderMarkdown(null), '');
  assert.equal(renderMarkdown({body: 'ignored'}), '');
  assert.equal(renderMarkdown('- '), '<ul><li></li></ul>');
  assert.match(renderMarkdown('> '.repeat(100) + '<script>bad()</script>'), /&lt;script&gt;/);
  const source = '['.repeat(20000) + 'content' + ']'.repeat(20000);
  assert.match(renderMarkdown(source), /content/);
  assertNoExecutableTags(renderMarkdown(source));
  assert.match(renderArticleDocument({title: '正常', locale: 'en" onload="bad()'}), /<html lang="zh-CN">/);
});

test('renderer stays browser portable and the offline document has no script, external stylesheet or font load', async () => {
  const source = await readFile(new URL('../article-render.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /^\s*import\s/m);
  assert.doesNotMatch(source, /\b(?:process|Buffer|require)\b|node:/);
  const html = renderArticleDocument({title: '离线文章', bodyMd: '正文'});
  assert.doesNotMatch(html, /<script\b|<link\b|@import|url\(/i);
  assertNoExecutableTags(html);
});
