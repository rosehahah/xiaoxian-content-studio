// A small, dependency-free Markdown renderer for article previews and exports.
// Source text is content, never HTML or instructions. Only registered raster
// assets can produce images; the caller owns registration and file integrity.

const RASTER_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const ASSET_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const CONTROL_OR_SPACE = /[\u0000-\u0020\u007f-\u009f]/;
const MAX_DEPTH = 12;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
}

function plain(value) {
  return typeof value === 'string' ? value : '';
}

function safeLinkUrl(value) {
  if (typeof value !== 'string' || value.length > 8192 || CONTROL_OR_SPACE.test(value) || /[\\<>]/.test(value)) return null;
  // Check the source spelling before URL parsing: encoded schemes, entities,
  // protocol-relative URLs and parser-repaired schemes are not accepted.
  if (!/^https?:\/\//i.test(value)) return null;
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || !url.hostname || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

function isRasterDataUrl(value, mime) {
  if (value.length > 20000000) return false;
  const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/]+={0,2})$/i.exec(value);
  if (!match || match[1].toLowerCase() !== mime || match[2].length % 4 !== 0) return false;
  // Check file signatures too; a claimed raster MIME must not smuggle SVG/HTML.
  // atob is a browser API and is also present in supported Node test runtimes.
  try {
    const bytes = atob(match[2].slice(0, 24));
    if (mime === 'image/png') return bytes.startsWith('\x89PNG\r\n\x1a\n');
    if (mime === 'image/jpeg') return bytes.startsWith('\xff\xd8\xff');
    if (mime === 'image/gif') return bytes.startsWith('GIF87a') || bytes.startsWith('GIF89a');
    return bytes.startsWith('RIFF') && bytes.slice(8, 12) === 'WEBP';
  } catch {
    return false;
  }
}

function safeAssetUrl(value, mime, allowHttp) {
  if (typeof value !== 'string' || !value || CONTROL_OR_SPACE.test(value) || /[\\<>"']/.test(value)) return null;
  if (value.startsWith('data:')) return isRasterDataUrl(value, mime) ? value : null;
  if (/^https?:\/\//i.test(value)) return allowHttp ? safeLinkUrl(value) : null;
  // Package images and the caller's local project-asset route are allowed.
  // Reject encoded separators/traversal rather than relying on browser repair.
  let decoded = value;
  for (let i = 0; i < 3; i++) {
    let next;
    try { next = decodeURIComponent(decoded); } catch { return null; }
    if (next === decoded) break;
    decoded = next;
  }
  if (CONTROL_OR_SPACE.test(decoded) || /[\\<>"'#:]/.test(decoded) || decoded.startsWith('//')) return null;
  const pathname = decoded.split('?')[0];
  if (pathname.split('/').some(segment => segment === '..' || segment === '.')) {
    // A single explicit ./ before a package path is harmless.
    if (!pathname.startsWith('./assets/') || pathname.slice(2).split('/').some(segment => segment === '..' || segment === '.')) return null;
  }
  if (!/^(?:\.\/)?assets\/[A-Za-z0-9_./%-]+(?:\?[^#]*)?$/.test(value) &&
      !/^\/api\/projects\/[A-Za-z0-9_.%-]+\/assets\/[A-Za-z0-9_.%-]+(?:\?[^#]*)?$/.test(value)) return null;
  return value;
}

function createContext(assets, assetUrl, onImage) {
  const registry = new Map();
  for (const entry of Array.isArray(assets) ? assets : []) {
    if (!entry || typeof entry !== 'object' || !ASSET_ID.test(plain(entry.id))) continue;
    // Ambiguous IDs never choose an arbitrary image.
    if (registry.has(entry.id)) { registry.set(entry.id, null); continue; }
    const mime = plain(entry.mimeType || entry.mime).toLowerCase();
    registry.set(entry.id, RASTER_MIMES.has(mime) ? {...entry, mime} : null);
  }
  return {registry, assetUrl, onImage, resolved: new Map()};
}

function resolveImage(target, context) {
  if (!target.startsWith('asset:')) return null;
  const id = target.slice(6);
  if (!ASSET_ID.test(id) || !context.registry.get(id)) return null;
  const asset = context.registry.get(id);
  if (!context.resolved.has(id)) {
    let result = null;
    try {
      const fromResolver = typeof context.assetUrl === 'function';
      const supplied = fromResolver ? context.assetUrl(id) : asset.url;
      result = safeAssetUrl(supplied, asset.mime, fromResolver);
    } catch { /* A failed resolver leaves a visible missing-image placeholder. */ }
    context.resolved.set(id, result);
  }
  const src = context.resolved.get(id);
  return src ? {asset, src} : null;
}

function unescapeMarkdown(value) {
  return value.replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/g, '$1');
}

// Keep original character positions while block parsing removes list/quote
// prefixes and inline parsing descends into formatting. All image consumers
// use this renderer's actual image nodes, including their destination spans.
function sliceSource(source, start = 0, end = source.text.length) {
  return {text: source.text.slice(start, end), positions: source.positions.slice(start, end)};
}
function trimSource(source) {
  const start = source.text.length - source.text.trimStart().length;
  return sliceSource(source, start, source.text.trimEnd().length);
}
function joinSources(sources) {
  return {text: sources.map(s => s.text).join('\n'), positions: sources.flatMap((s, i) => i ? [-1].concat(s.positions) : s.positions)};
}
function sourceLines(markdown) {
  const original = plain(markdown), lines = [];
  let offset = 0;
  for (const raw of original.split(/\r\n?|\n/)) {
    const tabs = /^\t*/.exec(raw)[0].length;
    const text = '    '.repeat(tabs) + raw.slice(tabs), positions = [];
    for (let i = 0; i < raw.length; i++) {
      for (let n = 0; n < (i < tabs ? 4 : 1); n++) positions.push(offset + i);
    }
    lines.push({text, positions});
    offset += raw.length;
    offset += original.startsWith('\r\n', offset) ? 2 : 1;
  }
  return lines;
}

// Pair brackets once so many unmatched '[' characters do not cause quadratic
// rescanning. Nested formatting is bounded independently of source length.
function bracketPairs(source) {
  const stack = [], pairs = new Map();
  for (let i = 0; i < source.length; i++) {
    if (source[i] === '\\') { i++; continue; }
    if (source[i] === '[') stack.push(i);
    if (source[i] === ']' && stack.length) pairs.set(stack.pop(), i);
  }
  return pairs;
}

function readDestination(source, start) {
  if (source[start] !== '(') return null;
  let depth = 1, quote = '', angle = false;
  for (let i = start + 1; i < source.length && i - start < 10000; i++) {
    const char = source[i];
    if (char === '\n' || char === '\r') return null;
    if (char === '\\') { i++; continue; }
    if (quote) { if (char === quote) quote = ''; continue; }
    if (angle) { if (char === '>') angle = false; continue; }
    if (char === '<' && /^\s*$/.test(source.slice(start + 1, i))) { angle = true; continue; }
    if ((char === '"' || char === "'") && /\s/.test(source[i - 1])) { quote = char; continue; }
    if (char === '(') depth++;
    if (char === ')' && --depth === 0) {
      const rawInside = source.slice(start + 1, i), inside = rawInside.trim();
      const match = /^(?:<([^<>]*)>|([^\s]+))(?:\s+(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'))?$/.exec(inside);
      if (!match) return null;
      const rawTarget = match[1] ?? match[2];
      const targetStart = start + 1 + rawInside.length - rawInside.trimStart().length + (match[1] !== undefined ? 1 : 0);
      return {target: unescapeMarkdown(rawTarget), title: unescapeMarkdown(match[3] ?? match[4] ?? ''), targetStart, targetEnd: targetStart + rawTarget.length, end: i + 1};
    }
  }
  return null;
}

function imageHtml(label, destination, context, block) {
  const resolved = resolveImage(destination.target, context);
  const alt = unescapeMarkdown(label) || plain(resolved?.asset.alt);
  if (!resolved) {
    const detail = alt || (destination.target.startsWith('asset:') ? destination.target.slice(6) : '外部图片');
    return `<span class="article-missing-asset" role="status">图片未登记或不可加载：${escapeHtml(detail)}</span>`;
  }
  const caption = destination.title || plain(resolved.asset.caption);
  const image = `<img src="${escapeHtml(resolved.src)}" alt="${escapeHtml(alt)}" decoding="async">`;
  if (block) return `<figure class="article-figure">${image}${caption ? `<figcaption>${escapeHtml(caption)}</figcaption>` : ''}</figure>`;
  return `<span class="article-inline-image">${image}${caption ? `<span class="article-caption">${escapeHtml(caption)}</span>` : ''}</span>`;
}

function emitImage(source, start, close, destination, context, block) {
  const label = source.text.slice(start + 2, close);
  context.onImage?.({label, target: destination.target, title: destination.title,
    start: source.positions[start], end: source.positions[destination.end - 1] + 1,
    targetStart: source.positions[destination.targetStart], targetEnd: source.positions[destination.targetEnd - 1] + 1});
  return imageHtml(label, destination, context, block);
}

function renderInline(input, context, depth = 0, allowLinks = true) {
  const source = input.text;
  if (depth > MAX_DEPTH) return escapeHtml(source);
  const pairs = bracketPairs(source);
  let html = '';
  for (let i = 0; i < source.length;) {
    const char = source[i];
    if (char === '\\' && i + 1 < source.length) {
      if (source[i + 1] === '\n') { html += '<br>\n'; i += 2; continue; }
      if (/[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/.test(source[i + 1])) {
        html += escapeHtml(source[i + 1]); i += 2; continue;
      }
    }
    if (char === '`') {
      let count = 1;
      while (source[i + count] === '`') count++;
      const marker = '`'.repeat(count);
      let close = source.indexOf(marker, i + count);
      while (close >= 0 && (source[close - 1] === '`' || source[close + count] === '`')) close = source.indexOf(marker, close + count);
      if (close >= 0) {
        let code = source.slice(i + count, close).replace(/\n/g, ' ');
        if (code.startsWith(' ') && code.endsWith(' ') && /[^ ]/.test(code)) code = code.slice(1, -1);
        html += `<code>${escapeHtml(code)}</code>`; i = close + count; continue;
      }
      html += marker; i += count; continue;
    }
    const image = char === '!' && source[i + 1] === '[';
    const open = image ? i + 1 : i;
    if ((image || char === '[') && pairs.has(open)) {
      const close = pairs.get(open);
      const destination = readDestination(source, close + 1);
      if (destination) {
        const label = source.slice(open + 1, close);
        if (image) html += emitImage(input, i, close, destination, context, false);
        else {
          const href = allowLinks && safeLinkUrl(destination.target);
          const inner = renderInline(sliceSource(input, open + 1, close), context, depth + 1, false);
          html += href ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer"${destination.title ? ` title="${escapeHtml(destination.title)}"` : ''}>${inner}</a>` : inner;
        }
        i = destination.end; continue;
      }
    }
    if (char === '<' && allowLinks) {
      const end = source.indexOf('>', i + 1);
      if (end >= 0 && end - i <= 8192) {
        const href = safeLinkUrl(source.slice(i + 1, end));
        if (href) { html += `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(source.slice(i + 1, end))}</a>`; i = end + 1; continue; }
      }
    }
    const delimiter = source.startsWith('**', i) ? '**' : source.startsWith('__', i) ? '__' :
      source.startsWith('~~', i) ? '~~' : (char === '*' || char === '_') ? char : '';
    if (delimiter && !(delimiter.includes('_') && /[\p{L}\p{N}]/u.test(source[i - 1] || ''))) {
      const close = source.indexOf(delimiter, i + delimiter.length);
      if (close > i + delimiter.length && !/\s/.test(source[i + delimiter.length]) && !/\s/.test(source[close - 1])) {
        const tag = delimiter.length === 1 ? 'em' : delimiter === '~~' ? 'del' : 'strong';
        html += `<${tag}>${renderInline(sliceSource(input, i + delimiter.length, close), context, depth + 1, allowLinks)}</${tag}>`;
        i = close + delimiter.length; continue;
      }
    }
    if (char === '\n' && html.endsWith('  ')) html = html.slice(0, -2) + '<br>\n';
    else html += escapeHtml(char);
    i++;
  }
  return html;
}

function listMarker(line) {
  const match = /^( {0,24})([-+*]|\d{1,9}[.)])([ \t]+)(.*)$/.exec(line);
  if (!match) return null;
  return {indent: match[1].length, ordered: /^\d/.test(match[2]), start: parseInt(match[2], 10), content: match[4], contentIndent: match[1].length + match[2].length + match[3].length};
}

function fenceMarker(line) {
  const match = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
  if (!match || (match[1][0] === '`' && match[2].includes('`'))) return null;
  return {marker: match[1], info: match[2].trim()};
}

function splitTableRow(source) {
  const line = source.text;
  const cells = [];
  let start = 0, ticks = 0;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '\\' && i + 1 < line.length) { i++; continue; }
    if (line[i] === '`') {
      let count = 1;
      while (line[i + count] === '`') count++;
      if (!ticks) ticks = count;
      else if (ticks === count) ticks = 0;
      i += count - 1; continue;
    }
    if (line[i] === '|' && !ticks) { cells.push(trimSource(sliceSource(source, start, i))); start = i + 1; }
  }
  cells.push(trimSource(sliceSource(source, start)));
  if (line.trimStart().startsWith('|')) cells.shift();
  if (line.trimEnd().endsWith('|')) cells.pop();
  return cells;
}

function tableHeader(lines, index) {
  if (index + 1 >= lines.length || !lines[index].text.includes('|')) return null;
  const cells = splitTableRow(lines[index]), separators = splitTableRow(lines[index + 1]);
  if (!cells.length || cells.length > 64 || cells.length !== separators.length || !separators.every(cell => /^:?-{3,}:?$/.test(cell.text))) return null;
  return {cells, alignments: separators.map(cell => cell.text.startsWith(':') && cell.text.endsWith(':') ? 'center' : cell.text.endsWith(':') ? 'right' : 'left')};
}

function isBlockStart(lines, index) {
  const line = lines[index].text;
  return !line.trim() || !!fenceMarker(line) || /^ {0,3}#{1,6}[ \t]+/.test(line) || /^ {0,3}>/.test(line) ||
    !!listMarker(line) || /^ {0,3}(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/.test(line) || !!tableHeader(lines, index);
}

function standaloneImage(line) {
  const source = trimSource(line);
  if (!source.text.startsWith('![')) return null;
  const close = bracketPairs(source.text).get(1);
  if (close === undefined) return null;
  const destination = readDestination(source.text, close + 1);
  if (!destination || destination.end !== source.text.length) return null;
  return {source, close, destination};
}

function renderList(lines, index, context, depth) {
  const first = listMarker(lines[index].text), tag = first.ordered ? 'ol' : 'ul';
  const items = [];
  let cursor = index;
  while (cursor < lines.length) {
    const marker = listMarker(lines[cursor].text);
    if (!marker || marker.indent !== first.indent || marker.ordered !== first.ordered) break;
    const itemLines = [sliceSource(lines[cursor], marker.contentIndent)];
    cursor++;
    let afterBlank = false;
    while (cursor < lines.length) {
      const line = lines[cursor].text, next = listMarker(line);
      if (next && next.indent <= first.indent) break;
      if (!line.trim()) { itemLines.push(sliceSource(lines[cursor], line.length)); cursor++; afterBlank = true; continue; }
      const indent = /^ */.exec(line)[0].length;
      if (indent <= first.indent && (afterBlank || isBlockStart(lines, cursor))) break;
      if (indent > first.indent) itemLines.push(sliceSource(lines[cursor], Math.min(marker.contentIndent, indent)));
      else itemLines.push(lines[cursor]); // A nonblank lazy continuation belongs to the item.
      cursor++; afterBlank = false;
    }
    while (itemLines.length && !itemLines.at(-1)?.text.trim()) itemLines.pop();
    const body = renderBlocks(itemLines, context, depth + 1);
    items.push(`<li>${body}</li>`);
  }
  const start = first.ordered && first.start !== 1 ? ` start="${first.start}"` : '';
  return {html: `<${tag}${start}>${items.join('')}</${tag}>`, end: cursor};
}

function renderBlocks(lines, context, depth = 0) {
  if (depth > MAX_DEPTH) return `<p>${escapeHtml(lines.map(line => line.text).join('\n'))}</p>`;
  const output = [];
  for (let i = 0; i < lines.length;) {
    const line = lines[i].text;
    if (!line.trim()) { i++; continue; }
    const fence = fenceMarker(line);
    if (fence) {
      const code = [], character = fence.marker[0];
      const closing = new RegExp(`^ {0,3}${character === '`' ? '`' : '~'}{${fence.marker.length},}\\s*$`);
      i++;
      while (i < lines.length && !closing.test(lines[i].text)) code.push(lines[i++].text);
      if (i < lines.length) i++;
      const language = /^[A-Za-z0-9_-]{1,40}$/.test(fence.info.split(/\s/)[0]) ? fence.info.split(/\s/)[0] : '';
      output.push(`<div class="article-code-scroll" tabindex="0" role="region" aria-label="代码"><pre><code${language ? ` class="language-${language}"` : ''}>${escapeHtml(code.join('\n'))}</code></pre></div>`);
      continue;
    }
    const heading = /^ {0,3}(#{1,6})[ \t]+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const content = sliceSource(lines[i], line.length - heading[2].length);
      output.push(`<h${level}>${renderInline(sliceSource(content, 0, content.text.replace(/[ \t]+#+[ \t]*$/, '').length), context)}</h${level}>`); i++; continue;
    }
    if (i + 1 < lines.length && /^ {0,3}(?:=+|-+)\s*$/.test(lines[i + 1].text) && !listMarker(line) && !/^ {0,3}>/.test(line)) {
      const level = lines[i + 1].text.trim()[0] === '=' ? 1 : 2;
      output.push(`<h${level}>${renderInline(trimSource(lines[i]), context)}</h${level}>`); i += 2; continue;
    }
    if (/^ {0,3}(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/.test(line)) { output.push('<hr>'); i++; continue; }
    if (/^ {0,3}>/.test(line)) {
      const quoted = [];
      while (i < lines.length && /^ {0,3}>/.test(lines[i].text)) {
        const prefix = /^ {0,3}> ?/.exec(lines[i].text)[0].length;
        quoted.push(sliceSource(lines[i++], prefix));
      }
      output.push(`<blockquote>${renderBlocks(quoted, context, depth + 1)}</blockquote>`); continue;
    }
    const table = tableHeader(lines, i);
    if (table) {
      const headingCells = table.cells.map((cell, col) => `<th scope="col" style="text-align:${table.alignments[col]}">${renderInline(cell, context)}</th>`).join('');
      const rows = [];
      i += 2;
      while (i < lines.length && lines[i].text.trim() && lines[i].text.includes('|') && !/^ {0,3}(?:#{1,6}[ \t]+|>|```|~~~)/.test(lines[i].text)) {
        const cells = splitTableRow(lines[i++]);
        rows.push(`<tr>${table.cells.map((_, col) => `<td style="text-align:${table.alignments[col]}">${renderInline(cells[col] || {text:'',positions:[]}, context)}</td>`).join('')}</tr>`);
      }
      output.push(`<div class="article-table-scroll" tabindex="0" role="region" aria-label="表格"><table><thead><tr>${headingCells}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`);
      continue;
    }
    if (listMarker(line)) {
      const list = renderList(lines, i, context, depth);
      output.push(list.html); i = list.end; continue;
    }
    const figure = standaloneImage(lines[i]);
    if (figure) { output.push(emitImage(figure.source, 0, figure.close, figure.destination, context, true)); i++; continue; }
    const paragraph = [lines[i]];
    i++;
    while (i < lines.length && !isBlockStart(lines, i) && !standaloneImage(lines[i])) {
      // Stop before a setext heading instead of merging it into this paragraph.
      if (i + 1 < lines.length && /^ {0,3}(?:=+|-+)\s*$/.test(lines[i + 1].text)) break;
      paragraph.push(lines[i++]);
    }
    output.push(`<p>${renderInline(joinSources(paragraph), context)}</p>`);
  }
  return output.join('\n');
}

/** Render supported Markdown as safe HTML. Remote/raw/data Markdown images are
 * placeholders. Registered assets may be resolved to safe local paths, strict
 * raster data URLs, or explicit HTTP(S) URLs returned by assetUrl(id). */
export function renderMarkdown(markdown, {assets = [], assetUrl, onImage} = {}) {
  return renderBlocks(sourceLines(markdown), createContext(assets, assetUrl, onImage));
}

/** Image nodes visited by the exact preview parser, regardless of registration.
 * Code, escaped examples, image alt text and non-rendered table cells are not
 * visited. Spans address the original Markdown, including CRLF and tabs. */
export function markdownImageNodes(markdown) {
  const nodes = [];
  renderMarkdown(markdown, {onImage: node => nodes.push(node)});
  return nodes;
}
export function markdownAssetIds(markdown) {
  return markdownImageNodes(markdown).filter(node => node.target.startsWith('asset:') && ASSET_ID.test(node.target.slice(6))).map(node => node.target.slice(6));
}
/** Rewrite only real image destinations; retain labels, titles and examples. */
export function rewriteMarkdownAssetImages(markdown, resolve) {
  let result = plain(markdown);
  const nodes = markdownImageNodes(result).filter(node => node.target.startsWith('asset:') && ASSET_ID.test(node.target.slice(6))).sort((a,b) => b.targetStart - a.targetStart);
  for (const node of nodes) {
    const value = resolve(node.target.slice(6), node);
    if (typeof value === 'string' && value) result = result.slice(0,node.targetStart) + value + result.slice(node.targetEnd);
  }
  return result;
}

const ARTICLE_CSS = `
:root{color-scheme:light;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;color:#242b27;background:#fcfbf8;font-synthesis:none}
*,*::before,*::after{box-sizing:border-box}
html,body{margin:0;width:100%;min-width:0}
body{font-size:clamp(17px,2.1vw,19px);line-height:1.85;overflow-wrap:anywhere;-webkit-text-size-adjust:100%;text-size-adjust:100%}
.article-document{width:100%;max-width:720px;min-width:0;margin:0 auto;padding:clamp(20px,5vw,48px)}
.article-header{margin:0 0 2rem;padding-bottom:1.4rem;border-bottom:1px solid #dce2d9}
.article-title{margin:0;font-size:clamp(28px,7vw,40px);line-height:1.35;letter-spacing:-.02em;font-weight:750;overflow-wrap:anywhere}
.article-digest{margin:1rem 0 0;color:#526159;font-size:1em}
.article-content,.article-content>*{min-width:0;max-width:100%}
.article-content p{margin:0 0 1.2em}
.article-content h1,.article-content h2,.article-content h3,.article-content h4,.article-content h5,.article-content h6{margin:1.7em 0 .75em;line-height:1.45;overflow-wrap:anywhere}
.article-content h1{font-size:1.8em}.article-content h2{font-size:1.5em}.article-content h3{font-size:1.25em}.article-content h4,.article-content h5,.article-content h6{font-size:1.08em}
.article-content a{color:#235b83;text-decoration-thickness:1px;text-underline-offset:.18em;overflow-wrap:anywhere}
.article-content a:focus-visible,.article-code-scroll:focus-visible,.article-table-scroll:focus-visible{outline:3px solid #235b83;outline-offset:3px}
.article-content blockquote{margin:1.4rem 0;padding:.8rem 1rem;border-left:3px solid #728b70;background:#f0f3ed;color:#3b4d42}
.article-content blockquote>:last-child,.article-content li>:last-child{margin-bottom:0}
.article-content ul,.article-content ol{margin:.7em 0 1.3em;padding-inline-start:1.5em}
.article-content li{padding-inline-start:.15em;margin:.4em 0;min-width:0;overflow-wrap:anywhere}
.article-content li>p{margin:.25em 0}.article-content li ul,.article-content li ol{margin:.4em 0}
.article-content hr{margin:2rem 0;border:0;border-top:1px solid #dce2d9}
.article-content code{font-family:ui-monospace,SFMono-Regular,Consolas,"Liberation Mono",monospace;font-size:.85em;background:#eef1eb;border-radius:4px;padding:.15em .3em;white-space:break-spaces;overflow-wrap:anywhere}
.article-code-scroll,.article-table-scroll{width:100%;max-width:100%;min-width:0;overflow-x:auto;overscroll-behavior-inline:contain;margin:1.4rem 0;border:1px solid #dce2d9;border-radius:8px;-webkit-overflow-scrolling:touch}
.article-code-scroll{background:#f0f3ed}
.article-code-scroll pre{margin:0;padding:1rem;min-width:0;max-width:100%;white-space:pre;font-size:14px;line-height:1.7}
.article-code-scroll code{padding:0;background:none;white-space:pre;overflow-wrap:normal;font-size:inherit}
.article-table-scroll table{border-collapse:collapse;width:max-content;min-width:100%;max-width:none;font-size:.88em;line-height:1.65}
.article-table-scroll th,.article-table-scroll td{padding:.7rem .85rem;border-bottom:1px solid #dce2d9;vertical-align:top;min-width:7rem;max-width:24rem;overflow-wrap:anywhere}
.article-table-scroll th{background:#eef2eb;font-weight:650}.article-table-scroll tbody tr:last-child td{border-bottom:0}
.article-figure{margin:1.6rem 0;width:100%;max-width:100%}
.article-content img{display:block;width:auto;max-width:100%;height:auto;margin:0 auto;border-radius:6px}
.article-figure figcaption,.article-caption{display:block;margin-top:.65rem;color:#526159;font-size:14px;line-height:1.65;overflow-wrap:anywhere;text-align:left}
.article-inline-image{display:block;max-width:100%;margin:1rem 0}
.article-missing-asset{display:block;max-width:100%;margin:.9rem 0;padding:.8rem 1rem;border:1px dashed #a78142;border-radius:6px;background:#fff7e9;color:#73541e;font-size:15px;line-height:1.6;overflow-wrap:anywhere}
@media(max-width:430px){.article-document{padding:24px 20px}.article-content blockquote{padding:.7rem .8rem}.article-content ul,.article-content ol{padding-inline-start:1.35em}}
@media print{body{background:#fff;font-size:12pt}.article-document{max-width:none;padding:0}.article-code-scroll,.article-table-scroll{overflow:visible;break-inside:avoid}.article-code-scroll pre,.article-code-scroll code{white-space:pre-wrap;overflow-wrap:anywhere}.article-table-scroll table{width:100%;max-width:100%}.article-table-scroll th,.article-table-scroll td{min-width:0}.article-figure{break-inside:avoid}}
`;

function articleAssets(registry, references) {
  const overrides = new Map();
  for (const ref of Array.isArray(references) ? references : []) {
    if (ref && typeof ref === 'object' && ASSET_ID.test(plain(ref.assetId))) overrides.set(ref.assetId, ref);
  }
  return (Array.isArray(registry) ? registry : []).map(asset => {
    const override = overrides.get(asset?.id);
    if (!override) return asset;
    return {...asset, ...(typeof override.caption === 'string' ? {caption: override.caption} : {}), ...(typeof override.alt === 'string' ? {alt: override.alt} : {})};
  });
}

/** A standalone, script-free document. The caller can provide registered images
 * as raster data URLs for a self-contained export or assets/id.ext package paths.
 * This function does not fetch resources, generate approvals, or publish. */
export function renderArticleDocument(article, {assets = [], assetUrl, lang} = {}) {
  const value = article && typeof article === 'object' ? article : {};
  const title = plain(value.title).trim() || '文章预览';
  const digest = plain(value.digest).trim();
  const requestedLang = lang ?? value.locale ?? 'zh-CN';
  const language = typeof requestedLang === 'string' && /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(requestedLang) ? requestedLang : 'zh-CN';
  const body = plain(value.bodyMd ?? value.markdown ?? value.body);
  const rendered = renderMarkdown(body, {assets: articleAssets(assets, value.assets), assetUrl});
  return `<!doctype html>\n<html lang="${escapeHtml(language)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="referrer" content="no-referrer"><title>${escapeHtml(title)}</title><style>${ARTICLE_CSS}</style></head><body><main class="article-document"><header class="article-header"><h1 class="article-title">${escapeHtml(title)}</h1>${digest ? `<p class="article-digest">${escapeHtml(digest)}</p>` : ''}</header><article class="article-content">${rendered}</article></main></body></html>`;
}
