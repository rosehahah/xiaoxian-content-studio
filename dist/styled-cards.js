import {CREATIVE_STYLES,creativeOf,currentCover} from './creative.mjs';
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const rows=x=>String(x||'').split('\n').filter(x=>x.trim());
function block(b){
 const heading=b.heading?`<h3>${esc(b.heading)}</h3>`:'';
 const content=b.type==='compare'?`<div class="sc-pairs">${rows(b.text).map(x=>`<div>${x.split('|').map(t=>`<span>${esc(t.trim())}</span>`).join('')}</div>`).join('')}</div>`:b.type==='steps'||b.type==='list'?`<${b.type==='steps'?'ol':'ul'}>${rows(b.text).map((x,i)=>`<li><span class="sc-marker">${b.type==='steps'?i+1:'✓'}</span><span>${esc(x)}</span></li>`).join('')}</${b.type==='steps'?'ol':'ul'}>`:`<p>${esc(b.text)}</p>`;
 return `<section class="sc-block sc-${esc(b.type)}">${b.type==='callout'?'<span class="sc-copy">可直接复制</span>':''}${heading}${content}</section>`;
}
export function renderStyledCard(p,i){
 const c=p.content.cards[i],creative=creativeOf(p),style=CREATIVE_STYLES[creative?.style];if(!c||!style)return '';
 const result=currentCover(p);if(i===0&&result)return `<article class="poster sc-image" data-poster="0"><img src="${esc(result.data)}" alt="${esc(c.title)}"></article>`;
 const palette=`--sc-bg:${style.background};--sc-ink:${style.ink};--sc-panel:${style.panel};--sc-accent:${style.accent};--sc-signal:${style.signal}`;
 if(i===0&&(creative.workflow===2||creative.mode!=='text'))return `<article class="poster sc-poster sc-waiting" style="${palette}" data-poster="0"><span class="sc-label">封面准备</span><h2>${esc(c.title)}</h2><div class="sc-pending">${creative.workflow===2?'请在封面制作中看参考、生成候选并挑选成品':creative.mode==='ask'?'请先选择真人封面或文字封面':!creative.portrait?'请先上传一张本人照片':'照片已准备，等待生成当前真人封面'}</div><p>封面制作入口在流程导航中。此页是准备状态，不是生成结果。</p></article>`;
 const blocks=[...(c.body?[{type:'text',heading:'',text:c.body}]:[]),...(c.blocks||[])];
 const layout=p.visual.pageLayouts?.[i]||(blocks.some(b=>b.type==='callout')?'feature':blocks.some(b=>b.type==='compare')?'split':'flow');
 return `<article class="poster sc-poster sc-designed sc-layout-${esc(layout)} ${i===0?'sc-text-cover':''}" style="${palette}" data-poster="${i}"><header class="sc-header"><span class="sc-label">${esc(p.content.series)}</span><b>${String(i+1).padStart(2,'0')} / ${String(p.content.cards.length).padStart(2,'0')}</b></header>${c.eyebrow?`<div class="sc-eyebrow">${esc(c.eyebrow)}</div>`:''}<h2 class="sc-title">${esc(c.title)}</h2><main class="sc-content">${blocks.map(block).join('')}</main>${c.note?`<p class="sc-note">${esc(c.note)}</p>`:''}<footer class="sc-footer">${esc(i===0?'':p.content.series)}</footer></article>`;
}
