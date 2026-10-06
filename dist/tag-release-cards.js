const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const lines=value=>String(value||'').split('\n').map(x=>x.trim()).filter(Boolean);
const cleanTitle=value=>esc(String(value||'').replaceAll('\n',' '));
const icon=(name)=>{
  const paths={
    tag:'<path d="M8 5h8l5 5-11 11L3 14Z"/><circle cx="11" cy="9" r="1.6"/>',
    release:'<path d="M12 3v11m-4-4 4 4 4-4"/><path d="M5 17v3h14v-3"/>',
    file:'<path d="M7 3h7l4 4v14H7Z"/><path d="M14 3v5h5M10 12h5m-5 4h5"/>',
    route:'<circle cx="6" cy="6" r="3"/><circle cx="18" cy="18" r="3"/><path d="M6 9v3c0 2 2 3 4 3h2c2 0 3 1 3 3"/>',
    check:'<path d="m5 12 4 4L19 6"/>',
    prompt:'<path d="M5 5h14v11H9l-4 4Z"/><path d="M9 9h6m-6 3h4"/>',
    warn:'<path d="M12 3 2.8 20h18.4Z"/><path d="M12 9v5m0 3v.1"/>'
  };
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]||paths.check}</svg>`;
};
const shell=(p,i,body,iconName)=>`<article class="poster tagrelease-poster tagrelease-${i+1}" data-poster="${i}">
  <div class="tr-orb tr-orb-a"></div><div class="tr-orb tr-orb-b"></div>
  <header class="tr-header"><span class="tr-kicker">GITHUB 小白自救</span><span class="tr-index">0${i+1} / 0${p.content.cards.length}</span></header>
  <main class="tr-main">${body}</main>
  <footer class="tr-footer"><span>先留住能用的版本，再放心继续改</span><span class="tr-footer-icon">${icon(iconName)}</span></footer>
</article>`;
const page2=(p,c,i)=>{
  const a=c.blocks?.[0],b=c.blocks?.[1];
  return shell(p,i,`<div class="tr-eyebrow">${esc(c.eyebrow)}</div><h2>${cleanTitle(c.title)}</h2><p class="tr-lead">${esc(c.body)}</p>
    <div class="tr-duo">
      <section class="tr-concept tr-yellow"><div class="tr-concept-icon">${icon('tag')}</div><b>${esc(a?.heading||'Tag｜版本标签')}</b><p>${esc(a?.text||'')}</p></section>
      <div class="tr-plus">＋</div>
      <section class="tr-concept tr-white"><div class="tr-concept-icon">${icon('release')}</div><b>${esc(b?.heading||'Release｜版本说明页')}</b><p>${esc(b?.text||'')}</p></section>
    </div><div class="tr-ribbon">一句话：Tag 找代码，Release 讲清这版。</div><p class="tr-note">${esc(c.note)}</p>`,'tag');
};
const page3=(p,c,i)=>{
  const sample=c.blocks?.[0],explain=c.blocks?.[1];
  const rows=lines(sample?.text);
  return shell(p,i,`<div class="tr-eyebrow">${esc(c.eyebrow)}</div><h2>${cleanTitle(c.title)}</h2><p class="tr-lead">${esc(c.body)}</p>
    <section class="tr-release-sheet"><div class="tr-sheet-top"><span class="tr-dot red"></span><span class="tr-dot yellow"></span><span class="tr-dot blue"></span><b>${esc(sample?.heading||'版本记录')}</b></div>
      <div class="tr-sheet-version">v0.1.0</div>${rows.map((x,n)=>{const [k,...rest]=x.split('：');return `<div class="tr-sheet-row"><span>${esc(k)}${rest.length?'：':''}</span><b>${esc(rest.join('：')||x)}</b>${n<2?'<i>✓</i>':''}</div>`;}).join('')}
    </section><div class="tr-tip"><b>${esc(explain?.heading||'写清楚更有用')}</b><span>${esc(explain?.text||'')}</span></div><p class="tr-note">${esc(c.note)}</p>`,'file');
};
const page4=(p,c,i)=>{
  const steps=lines(c.blocks?.[0]?.text);
  return shell(p,i,`<div class="tr-eyebrow">${esc(c.eyebrow)}</div><h2>${cleanTitle(c.title)}</h2><p class="tr-lead tr-pill">前提｜${esc(c.body.replace(/^前提：/,'')||c.body)}</p>
    <div class="tr-road">${steps.map((x,n)=>`<section><span>${n+1}</span><p>${esc(x)}</p></section>`).join('')}</div>
    <div class="tr-alert">Save draft 只是保存草稿；Publish release 才是发布版本页。</div><p class="tr-note">${esc(c.note)}</p>`,'route');
};
const page5=(p,c,i)=>{
  const checks=lines(c.blocks?.[0]?.text),tip=c.blocks?.[1];
  return shell(p,i,`<div class="tr-eyebrow">${esc(c.eyebrow)}</div><h2>${cleanTitle(c.title)}</h2><p class="tr-lead">${esc(c.body)}</p>
    <div class="tr-checks">${checks.map((x,n)=>`<section><span>${icon('check')}</span><div><b>检查 ${n+1}</b><p>${esc(x)}</p></div></section>`).join('')}</div>
    <div class="tr-tip tr-blue"><b>${esc(tip?.heading||'如果跑不起来')}</b><span>${esc(tip?.text||'')}</span></div><p class="tr-note">${esc(c.note)}</p>`,'check');
};
const page6=(p,c,i)=>{
  const prompt=c.blocks?.[0],result=c.blocks?.[1];
  return shell(p,i,`<div class="tr-eyebrow">${esc(c.eyebrow)}</div><h2>${cleanTitle(c.title)}</h2><p class="tr-lead">${esc(c.body)}</p>
    <section class="tr-prompt"><div class="tr-copy-label">可直接复制</div><p>${esc(prompt?.text||'')}</p></section>
    <div class="tr-output"><b>${esc(result?.heading||'你会拿到')}</b><span>${esc(result?.text||'')}</span></div><p class="tr-note">${esc(c.note)}</p>`,'prompt');
};
const page7=(p,c,i)=>{
  const pairs=lines(c.blocks?.[0]?.text).map(row=>row.split('|').map(x=>x.trim()));
  return shell(p,i,`<div class="tr-eyebrow">${esc(c.eyebrow)}</div><h2>${cleanTitle(c.title)}</h2><p class="tr-lead">${esc(c.body)}</p>
    <div class="tr-myths">${pairs.map((pair,n)=>`<section><span class="tr-myth-no">${n+1}</span><div><b>${esc(pair[0]||'')}</b><p>${esc(pair[1]||'')}</p></div></section>`).join('')}</div>
    <div class="tr-final">能定位 · 能解释 · 能验证</div><p class="tr-note">${esc(c.note)}</p>`,'warn');
};

export function renderTagReleaseCard(p,i){
  const c=p.content.cards[i];if(!c)return '';
  if(i===0)return `<article class="poster tagrelease-cover" data-poster="0"><img src="/issues/github-tag-release-20261006/assets/cover-selected.png" alt="AI改崩了？这招救回来"></article>`;
  return [null,page2,page3,page4,page5,page6,page7][i](p,c,i);
}
