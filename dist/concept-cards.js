// Read the same editable blocks as the editor; diagrams never contain a second copy of the text.
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const lines = value => String(value ?? '').split('\n').filter(x => x.trim());
const arrow = () => '<svg class="cc-arrow" viewBox="0 0 48 48" aria-hidden="true"><path d="M24 7v32m-11-11 11 11 11-11" fill="none" stroke="#b77a50" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const editorialPalettes = [
  ['#edf3ed','#28614c','#a7c2ac'],['#edf2f8','#315d83','#adc2d9'],
  ['#f6efdf','#91623b','#dec697'],['#f0edf5','#685183','#c7b9da'],
  ['#edf2eb','#496744','#b6c7a2'],['#edf1f8','#3b5f91','#b3c4e0'],
  ['#f8ede6','#945735','#dec0a5'],['#eaf2f1','#2c6866','#a7c8c5']
];
// These are original capability illustrations, not product logos or screenshots.
function editorialIllustration(c) {
  const text=[c.title,...(c.blocks||[]).map(b=>b.heading)].join(' ');
  const stroke='fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"';
  let label, art;
  if (/Muse/.test(text) && /Grok Bot/.test(text)) {
    label='能力示意：目标跟进与浏览器工具';
    art='<g transform="translate(28 18)"><circle cx="30" cy="30" r="25"/><circle cx="30" cy="30" r="13"/><path d="m30 30 34-29m-11 0h11v11"/></g><text x="111" y="57">Muse</text><path d="M235 49h35" stroke-dasharray="3 7"/><g transform="translate(291 20)"><rect x="0" y="0" width="64" height="51" rx="5"/><path d="M0 13h64m-50 14 10 8-10 8m20 0h15"/><circle cx="8" cy="7" r="1"/></g><text x="375" y="57">Grok Bot</text>';
  } else if (/Dots/.test(text) && /Manus/.test(text)) {
    label='能力示意：连接上下文与交付文件';
    art='<g transform="translate(24 13)"><path d="m8 10 42 18-27 28m-15-46 15 46"/><circle cx="8" cy="10" r="7" fill="currentColor" stroke="none"/><circle cx="50" cy="28" r="7" fill="currentColor" stroke="none"/><circle cx="23" cy="56" r="7" fill="currentColor" stroke="none"/></g><text x="111" y="57">Dots</text><path d="M235 49h35" stroke-dasharray="3 7"/><g transform="translate(297 11)"><path d="M0 0h34l18 18v55H0zM34 0v18h18m-40 14h27m-27 12h12m3 12 7 7 14-16"/></g><text x="375" y="57">Manus</text>';
  } else if (/决定权|权限/.test(text)) {
    label='能力示意：权限、确认与核对';
    art='<g transform="translate(6 9)"><path d="m28 0 27 12v24c0 17-27 34-27 34S1 53 1 36V12z"/><path d="m16 31 9 9 17-20"/></g><path d="M91 44h28" stroke-dasharray="3 7"/><g transform="translate(145 17)"><path d="M0 9h52m-52 19h52m-52 19h52"/><circle cx="15" cy="9" r="6" fill="var(--cc-paper)"/><circle cx="39" cy="28" r="6" fill="var(--cc-paper)"/><circle cx="23" cy="47" r="6" fill="var(--cc-paper)"/></g><path d="M218 44h28" stroke-dasharray="3 7"/><g transform="translate(270 16)"><circle cx="27" cy="27" r="27"/><path d="m13 27 10 10 18-22"/></g>';
  } else if (/贴合|偏好/.test(text)) {
    label='能力示意：围绕个人连接信息';
    art='<g transform="translate(4 15)"><circle cx="28" cy="17" r="12"/><path d="M5 62V50c0-24 46-24 46 0v12"/></g><path d="m89 44 60-19m-60 19 60 20"/><circle cx="161" cy="23" r="10"/><circle cx="161" cy="66" r="10"/><path d="m182 23 60 20m-60 23 60-23"/><g transform="translate(267 15)"><circle cx="28" cy="28" r="27"/><path d="m14 28 9 9 18-22"/></g>';
  } else if (/周末/.test(text)) {
    label='能力示意：对话建议与行程安排';
    art='<g transform="translate(4 14)"><path d="M0 0h62v48H23L8 61V48H0z"/><path d="M13 17h36m-36 14h23"/></g><path d="M91 44h33m-8-7 8 7-8 7"/><g transform="translate(147 11)"><path d="M2 49c0-30 50-8 50-39"/><circle cx="2" cy="57" r="7"/><circle cx="52" cy="3" r="7"/></g><path d="M222 44h30m-8-7 8 7-8 7"/><g transform="translate(270 16)"><rect width="60" height="57" rx="4"/><path d="M0 16h60M16-6v13m28-13v13m-27 25 9 9 16-18"/></g>';
  } else {
    label='任务推进示意';
    art='<g transform="translate(4 10)"><circle cx="32" cy="34" r="27"/><circle cx="32" cy="34" r="12"/><path d="m32 34 27-27"/></g><path d="M86 44h34m-8-7 8 7-8 7"/><g transform="translate(143 16)"><path d="M0 0h49v57H0zM10 13h29m-29 14h29m-29 14h16"/></g><path d="M213 44h34m-8-7 8 7-8 7"/><g transform="translate(271 16)"><circle cx="27" cy="27" r="27"/><path d="m13 27 10 10 18-22"/></g>';
  }
  return `<svg class="cc-editorial-art" viewBox="0 0 ${/Muse|Dots/.test(text)?560:338} 100" role="img" aria-label="${label}"><g ${stroke}>${art}</g></svg>`;
}
function block(b) {
  const heading = b.heading ? `<h3>${esc(b.heading)}</h3>` : '';
  if (b.type === 'compare') return `<section class="cc-block cc-diagram">${heading}<div class="cc-flow">${lines(b.text).map((line, i) => `${i ? arrow() : ''}<div class="cc-flow-node">${line.split('|').map((part, j) => `<${j ? 'span' : 'b'}>${esc(part.trim())}</${j ? 'span' : 'b'}>`).join('')}</div>`).join('')}</div></section>`;
  if (b.type === 'steps' || b.type === 'list') return `<section class="cc-block cc-${esc(b.type)}">${heading}<${b.type === 'steps' ? 'ol' : 'ul'}>${lines(b.text).map((line, i) => `<li><span class="cc-marker">${b.type === 'steps' ? i + 1 : '·'}</span><span>${esc(line)}</span></li>`).join('')}</${b.type === 'steps' ? 'ol' : 'ul'}></section>`;
  return `<section class="cc-block cc-${esc(b.type)}">${heading}<p>${esc(b.text)}</p></section>`;
}
export function renderConceptCard(p, i) {
  const c = p.content.cards[i];
  if (!c || i === 0) return ''; // The cover has its own rendering / generation pipeline.
  if(['plain','editorial'].includes(p.visual.readingStyle)){
    const designed=p.visual.readingStyle==='editorial';
    const heading=text=>{const brand=String(text).match(/^(Muse|Grok Bot|Dots|Manus)(：|:)/);return designed&&brand?`<span class="cc-product-name">${esc(brand[1])}</span>${esc(String(text).slice(brand[1].length))}`:esc(text);};
    const plainBlock=b=>`<section class="cc-block">${b.heading?`<h3>${heading(b.heading)}</h3>`:''}${b.type==='compare'?lines(b.text).map(line=>`<p class="cc-plain-row">${line.split('|').map((text,j)=>`<${j?'span':'strong'}>${esc(text.trim())}</${j?'span':'strong'}>`).join('')}</p>`).join(''):`<p>${esc(b.text)}</p>`}</section>`;
    const palette=editorialPalettes[(i-1)%editorialPalettes.length];
    const title=designed?String(c.title).split('\n').map((line,j)=>`<span class="${j?'cc-title-accent':''}">${esc(line)}</span>`).join('<br>'):esc(c.title);
    return `<article class="poster concept-poster cc-minimal${designed?' cc-editorial':''}" ${designed?`style="--cc-paper:${palette[0]};--cc-accent:${palette[1]};--cc-tint:${palette[2]}"`:''} data-poster="${i}"><h2 class="cc-title">${title}</h2><main class="cc-content">${c.body?`<p class="cc-intro">${esc(c.body)}</p>`:''}${(c.blocks||[]).map(plainBlock).join('')}${c.note?`<p class="cc-note">${esc(c.note)}</p>`:''}</main><footer class="cc-footer">${designed?editorialIllustration(c):''}<span>${String(i).padStart(2,'0')} / ${String(p.content.cards.length-1).padStart(2,'0')}</span></footer></article>`;
  }
  const layout = p.visual.pageLayouts?.[i] || 'flow';
  return `<article class="poster concept-poster cc-layout-${esc(layout)} ${(c.blocks || []).length >= 4 && (c.blocks || []).every(b=>b.type==='text') ? 'cc-directory' : ''}" data-poster="${i}"><header class="cc-header"><span>${esc(p.content.series || '')}</span><span>${String(i).padStart(2, '0')} / ${String(p.content.cards.length - 1).padStart(2, '0')}</span></header>${c.eyebrow ? `<div class="cc-eyebrow">${esc(c.eyebrow)}</div>` : ''}<h2 class="cc-title">${esc(c.title)}</h2>${c.body ? `<p class="cc-intro">${esc(c.body)}</p>` : ''}<main class="cc-content">${(c.blocks || []).map(block).join('')}</main>${c.note ? `<p class="cc-note">${esc(c.note)}</p>` : ''}<footer class="cc-footer"><span>小苋AI圈 · 把概念讲明白</span></footer></article>`;
}
