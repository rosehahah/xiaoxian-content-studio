import {materialSvg} from './icon-library.mjs';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const BLOCK_LABELS={text:'段落',list:'清单',steps:'步骤',compare:'对照',callout:'重点 / 提示词'};
export function renderBlock(block){
  const lines=block.text.split('\n').filter(x=>x.trim());
  const heading=block.heading?`<h3>${esc(block.heading)}</h3>`:'';
  let text=`<p>${esc(block.text)}</p>`;
  if(block.type==='list'||block.type==='steps')text=`<${block.type==='steps'?'ol':'ul'}>${lines.map(t=>`<li>${esc(t)}</li>`).join('')}</${block.type==='steps'?'ol':'ul'}>`;
  if(block.type==='compare')text=`<div class="card-comparison">${lines.map(line=>`<div class="comparison-row">${line.split('|').map(t=>`<span>${esc(t.trim())}</span>`).join('')}</div>`).join('')}</div>`;
  return `<section class="content-block block-${esc(block.type)}">${heading}${text}</section>`;
}
export function renderFlexibleCard(p,i,wordmark,palette){
  const c=p.content.cards[i],layout=p.visual.pageLayouts?.[i]||'flow';
  const blocks=[...(c.body?[{type:c.kind==='steps'?'steps':c.kind==='prompt'?'callout':'text',heading:'',text:c.body}]:[]),...(c.blocks||[])];
  const symbol=p.visual.artwork?.[i]?`<div class="flexible-symbol">${materialSvg(p.visual.artwork[i],palette.ink)}</div>`:'';
  let html=`<article class="poster flexible ${esc(p.visual.theme)} ${esc(p.visual.layout)} composition-${esc(layout)}" data-poster="${i}"><div class="poster-header"><span class="wordmark">${wordmark}小苋AI圈</span><span>${esc(p.content.series||'外行人的 AI 学习笔记')}</span></div><div class="flexible-heading">${c.eyebrow?`<div class="poster-eyebrow">${esc(c.eyebrow)}</div>`:''}${c.title?`<h2 class="poster-title">${esc(c.title)}</h2>`:''}${symbol}</div><div class="flexible-content">${blocks.map(renderBlock).join('')}</div>${c.note?`<div class="poster-note">${esc(c.note)}</div>`:''}<footer class="poster-footer"><span>小苋 · 把问题讲明白</span><span class="foot-no">${String(i+1).padStart(2,'0')} / ${String(p.content.cards.length).padStart(2,'0')}</span></footer></article>`;
  for(const [key,value] of Object.entries(palette))html=html.replaceAll('var(--poster-'+key+')',value);
  return html.replaceAll('currentColor',palette.ink);
}
