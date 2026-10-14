/* Standalone local content workspace. Models run in the user's Codex conversation. */
const CHANNELS = {
  domestic: [
    {id:'wechat',name:'微信公众号',mark:'微',formats:['article','cards'],hint:'完整长文 / 多图内容'},
    {id:'zhihu',name:'知乎',mark:'知',formats:['article'],hint:'围绕一个具体问题'},
    {id:'juejin',name:'掘金',mark:'掘',formats:['article'],hint:'可以复现的技术教程'},
    {id:'xiaohongshu',name:'小红书',mark:'红',formats:['cards'],hint:'图卡与配文'},
    {id:'douyin',name:'抖音',mark:'抖',formats:['cards'],hint:'图文内容包'},
  ],
  overseas: [
    {id:'substack',name:'Substack',mark:'S',formats:['article'],hint:'有个人判断的完整文章'},
    {id:'linkedin',name:'LinkedIn',mark:'in',formats:['post','cards'],hint:'工作经验与专业观察'},
    {id:'x',name:'X',mark:'𝕏',formats:['post','cards','article'],hint:'一个清楚的观点或过程'},
    {id:'threads',name:'Threads',mark:'@',formats:['post','cards'],hint:'自然交流与过程分享'},
  ],
};
const FORMAT = {article:'长文',post:'短帖',cards:'图卡配文'};
const VERIFICATION = {unverified:'待核实',user_reported:'本人提供',verified:'已实测',code_inspected:'代码已检查',official_document:'官方文档'};
const VERIFIED_STATES = new Set(['user_reported','verified','code_inspected','official_document','confirmed']);
const TABS = [{id:'sources',name:'素材'},{id:'article',name:'长文'},{id:'domestic',name:'国内适配'},{id:'overseas',name:'海外适配'},{id:'delivery',name:'交付与反馈'}];
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const clone = value => JSON.parse(JSON.stringify(value));
const uid = prefix => `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
const arr = value => Array.isArray(value) ? value : [];
const pick = (value,keys) => Object.fromEntries(keys.filter(key=>value[key]!==undefined).map(key=>[key,value[key]]));
const ARTICLE_FIELDS=['storyType','locale','title','digest','bodyMd','assets','coverAssetId','sourceDeps'];
const VARIANT_FIELDS=['channel','format','locale','title','subtitle','digest','bodyMd','assets','coverAssetId','sourceDeps','profileVersion','tags','aiDisclosure','target','cards','visual'];
const emptyArticle = () => ({id:'article-main',storyType:'tutorial',locale:'zh-CN',title:'',digest:'',bodyMd:'',assets:[],coverAssetId:null,sourceDeps:[],revision:0,approval:null});
const labelField = (label,name,value,{area=false,rows=3,help='',placeholder=''}={}) => `<label class="lf-field"><span>${esc(label)}</span>${area ? `<textarea rows="${rows}" data-lf-field="${esc(name)}" placeholder="${esc(placeholder)}">${esc(value)}</textarea>` : `<input data-lf-field="${esc(name)}" value="${esc(value)}" placeholder="${esc(placeholder)}">`}${help ? `<small>${esc(help)}</small>` : ''}</label>`;
const button = (action,text,kind='secondary',extra='') => `<button type="button" class="lf-button lf-${kind}" data-lf-action="${action}" ${extra}>${text}</button>`;

function downloadText(name,text,type='text/plain;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text],{type}));
  const anchor = document.createElement('a'); anchor.href=url; anchor.download=name; anchor.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}

function safePreviewHTML(html,assetPrefix) {
  const doc = new DOMParser().parseFromString(String(html || ''),'text/html');
  doc.querySelectorAll('script,iframe,object,embed,form,link,base,meta').forEach(el=>el.remove());
  for (const el of doc.querySelectorAll('*')) {
    for (const attr of [...el.attributes]) if (/^on/i.test(attr.name) || ['srcdoc','formaction','action'].includes(attr.name)) el.removeAttribute(attr.name);
    if (el.hasAttribute('href')) {
      const href=el.getAttribute('href') || '';
      if (!/^(https?:|mailto:|#)/i.test(href)) el.removeAttribute('href');
      el.setAttribute('target','_blank'); el.setAttribute('rel','noopener noreferrer');
    }
    if (el.hasAttribute('src')) {
      const src=el.getAttribute('src') || '';
      let allowed=/^data:image\/(png|jpeg|webp|gif);base64,/i.test(src);
      try {const url=new URL(src,location.origin); if (url.origin===location.origin && url.pathname.startsWith(assetPrefix)) allowed=true;} catch {}
      if (!allowed) el.removeAttribute('src');
    }
  }
  const csp=doc.createElement('meta'); csp.httpEquiv='Content-Security-Policy';
  csp.content=`default-src 'none'; img-src data: ${location.origin}; style-src 'unsafe-inline'; font-src 'none'; object-src 'none'; form-action 'none'; connect-src 'none'; base-uri 'none'`;
  doc.head.prepend(csp);
  return '<!doctype html>'+doc.documentElement.outerHTML;
}

function simpleVariantPreview(variant,assetPrefix) {
  // A readable, escaped review aid. The exported platform renderer remains authoritative.
  const text=String(variant.bodyMd || '');
  const blocks=text.split(/\n{2,}/).map(part=>{
    const image=part.trim().match(/^!\[([^\]]*)\]\(asset:([\w.-]+)\)$/);
    if (image) return `<figure><img src="${assetPrefix}${encodeURIComponent(image[2])}" alt="${esc(image[1])}"><figcaption>${esc(image[1])}</figcaption></figure>`;
    const heading=part.match(/^(#{1,3})\s+(.+)$/);
    if (heading) return `<h${heading[1].length+1}>${esc(heading[2])}</h${heading[1].length+1}>`;
    return `<p>${esc(part).replaceAll('\n','<br>')}</p>`;
  }).join('');
  return `<html><head><style>body{margin:0;padding:28px 24px;font:15px/1.9 Georgia,"Songti SC",serif;color:#343a32;background:#fffdf8;overflow-wrap:anywhere}h1{font-size:27px;line-height:1.4}h2,h3,h4{line-height:1.5}img{max-width:100%;height:auto}figure{margin:24px 0}figcaption{font-size:12px;color:#7c8176}p{white-space:normal}pre,table{max-width:100%;overflow:auto}</style></head><body><h1>${esc(variant.title)}</h1>${blocks || '<p>正文会显示在这里。</p>'}</body></html>`;
}

export function mountLongform(container,{project,api,onProject=()=>{},onBack=()=>{},onRenderCards}={}) {
  if (!container || typeof api !== 'function' || !project?.id) throw new Error('长文工作室需要项目与本机 API。');
  const styleURL=new URL('./longform.css',import.meta.url).href;
  if (![...document.querySelectorAll('link[rel="stylesheet"]')].some(link=>link.href===styleURL)) {
    const link=document.createElement('link'); link.rel='stylesheet'; link.href=styleURL; document.head.append(link);
  }
  let p=clone(project),tab='sources',destroyed=false,pending=Promise.resolve(),busy=0,conflict=null,preview=null,previewWidth='desktop',previewResizeObserver=null;
  let dirty={sources:false,article:false,channels:false,variants:new Set(),feedback:false};
  const editEpoch={sources:0,article:0,channels:0,feedback:0,variants:new Map()};
  let sources=clone(p.sourceBundle || {revision:0,sources:[],facts:[],assets:[],voiceSampleRefs:[]});
  let article=clone(p.article || emptyArticle()),channels=clone(p.selectedChannels || {domestic:[],overseas:[]}),feedback=clone(arr(p.feedback));
  const variants=new Map(),taskInputs={},taskText={},importText={},variantChoice={domestic:'',overseas:''},jsonDrafts=new Map(),jsonErrors=new Map();
  const feedbackForm={channel:'wechat',metric:'读者反馈',value:'',note:''};
  let pendingFeedbackForm=null;
  const options={domestic:{sourceWorkId:'article-main',locale:'zh-CN',formats:{}},overseas:{sourceWorkId:'article-main',locale:'en-US',formats:{}}};
  const base=()=>`/api/projects/${encodeURIComponent(p.id)}`;
  const assetPrefix=()=>`${base()}/assets/`;
  const allVariants=()=>arr(p.variants);
  const assets=()=>arr(p.sourceBundle?.assets);
  const revision=()=>p.revision;
  const root=document.createElement('section'); root.className='lf-workspace'; container.replaceChildren(root);
  for (const group of ['domestic','overseas']) for (const channel of CHANNELS[group]) options[group].formats[channel.id]=channel.formats[0];

  function notice(message,kind='info') {
    if (destroyed) return;
    const box=root.querySelector('[data-lf-notice]');
    if (box) {box.textContent=message;box.dataset.kind=kind;box.hidden=!message;}
  }
  function setBusy(delta) {busy=Math.max(0,busy+delta);root.setAttribute('aria-busy',String(busy>0));paintStatus();}
  function statusOfError(error) {return Number(error?.status || error?.statusCode || error?.response?.status || (/409|版本冲突|revision conflict/i.test(error?.message || '') ? 409 : 0));}
  function request(path,config={}) {return Promise.resolve().then(()=>api(path,config)).then(result=>{if (result?.error && !result?.project) {const error=new Error(result.error);error.status=result.status;throw error;}return result;});}
  function accept(result) {
    const next=result?.project || (result?.id===p.id ? result : null);
    if (next) {p=clone(next);onProject(clone(p));}
    paintStatus();return result;
  }
  async function guarded(fn) {
    setBusy(1);
    try {return await fn();}
    catch(error) {
      if (statusOfError(error)===409) {conflict={server:null};showConflict();notice('版本发生变化。当前文字已保留，请比较或下载编辑副本。','error');}
      else notice(error?.message || '操作没有完成，请重试。','error');
      throw error;
    } finally {setBusy(-1);}
  }
  function serial(fn) {const result=pending.then(()=>guarded(fn));pending=result.catch(()=>{});return result;}
  function localVariant(id) {if (!variants.has(id)) {const item=allVariants().find(v=>v.id===id);if (item) variants.set(id,clone(item));}return variants.get(id);}
  function currentVariants(group) {const ids=new Set((CHANNELS[group] || []).map(c=>c.id));return allVariants().filter(v=>ids.has(v.channel));}
  function currentVariant(group=tab) {const list=currentVariants(group);const id=variantChoice[group] || list[0]?.id;return id ? localVariant(id) : null;}
  function feedbackDraftExists(){return Boolean(feedbackForm.note.trim() || feedbackForm.value.trim());}
  function dependencyProblems() {
    return arr(article.sourceDeps).flatMap(dep=>{
      const fact=arr(p.sourceBundle?.facts).find(f=>f.id===dep.factId);
      if(!fact)return [`引用的事实 ${dep.factId} 已移除`];
      if(!fact.fingerprint || dep.fingerprint!==fact.fingerprint)return [`事实“${fact.statement}”已变化，需要重新核对`];
      if(!VERIFIED_STATES.has(fact.verification))return [`事实“${fact.statement}”仍待核实`];
      return [];
    });
  }
  function currentDirty() {return tab==='sources' ? dirty.sources : tab==='article' ? dirty.article || dirty.sources : ['domestic','overseas'].includes(tab) ? dirty.channels || (currentVariant()?.id && dirty.variants.has(currentVariant().id)) : dirty.feedback || feedbackDraftExists();}
  function mark(section,id) {if (section==='variants'){dirty.variants.add(id);editEpoch.variants.set(id,(editEpoch.variants.get(id)||0)+1);const ack=root.querySelector('[data-lf-variant-ack]');if(ack)ack.checked=false;}else{dirty[section]=true;editEpoch[section]++;}if (section==='article'){preview=null;const ack=root.querySelector('[data-lf-article-ack]');if(ack)ack.checked=false;}paintStatus();}
  function paintStatus() {
    const status=root.querySelector('[data-lf-save-state]');
    if (status) status.textContent=busy ? '正在保存 / 读取…' : conflict ? '存在版本冲突 · 文字已保留' : currentDirty() ? '有未保存修改' : '已保存在本机';
    const articleBadge=root.querySelector('[data-lf-article-badge]');
    if (articleBadge) articleBadge.textContent=p.runtime?.articleApproved && !dirty.article ? '本版长文已审核' : '长文待审核';
    const approve=root.querySelector('[data-lf-action="article-approve"]');
    if (approve) approve.disabled=busy>0 || dirty.article || dirty.sources || dependencyProblems().length>0 || !preview?.artifactHash || (p.runtime?.articleHash && preview.artifactHash!==p.runtime.articleHash) || !root.querySelector('[data-lf-article-ack]')?.checked;
    const v=currentVariant(['domestic','overseas'].includes(tab)?tab:'domestic');
    const variantApprove=root.querySelector('[data-lf-action="variant-approve"]');
    if (variantApprove) variantApprove.disabled=busy>0 || !v || dirty.variants.has(v.id) || !p.runtime?.variantHashes?.[v.id] || !root.querySelector('[data-lf-variant-ack]')?.checked;
    const variantBadge=root.querySelector('[data-lf-variant-badge]');if(variantBadge && v){const approved=p.runtime?.variantApproved?.[v.id] && !dirty.variants.has(v.id);variantBadge.textContent=approved?'本版已审核':'本版待审核';variantBadge.classList.toggle('lf-approved',Boolean(approved));}
    const profileNote=root.querySelector('[data-lf-profile-note]');if(profileNote && v){profileNote.innerHTML=profileMarkup(v);profileNote.classList.toggle('lf-profile-stale',p.runtime?.profiles?.[v.id]?.status==='needs_recheck');}
    for (const el of root.querySelectorAll('[data-lf-export-source]')) el.hidden=!(p.runtime?.articleApproved && !dirty.article && !dirty.sources);
  }
  async function saveSources() {
    if (!dirty.sources) return;
    const epoch=editEpoch.sources,snapshot=clone(sources);
    const result=await request(`${base()}/sources`,{method:'PUT',body:{revision:revision(),sourceBundle:snapshot}});accept(result);
    if(epoch===editEpoch.sources){dirty.sources=false;sources=clone(p.sourceBundle || sources);}refreshDependencies();
  }
  async function saveArticle() {
    if (!dirty.article) return;
    const stale=arr(article.sourceDeps).some(dep=>{const fact=arr(p.sourceBundle?.facts).find(f=>f.id===dep.factId);return !fact?.fingerprint || fact.fingerprint!==dep.fingerprint;});
    if(stale)throw new Error('引用事实已变化或已移除。文章文字已保留，请在“这篇引用的事实”中核对后重新引用，或移除对应引用。');
    const epoch=editEpoch.article,snapshot=clone(pick(article,ARTICLE_FIELDS));
    const result=await request(`${base()}/article`,{method:'PATCH',body:{revision:revision(),article:snapshot}});accept(result);
    if(epoch===editEpoch.article){dirty.article=false;article=clone(p.article || article);}
  }
  async function saveChannels() {
    if (!dirty.channels) return;
    const epoch=editEpoch.channels,snapshot=clone(channels);
    accept(await request(`${base()}/channels`,{method:'PATCH',body:{revision:revision(),selectedChannels:snapshot}}));
    if(epoch===editEpoch.channels){dirty.channels=false;channels=clone(p.selectedChannels || channels);}
  }
  async function saveVariant(id) {
    if (!id || !dirty.variants.has(id)) return;
    if(jsonErrors.has(id))throw new Error(jsonErrors.get(id));
    const variant=localVariant(id),epoch=editEpoch.variants.get(id),snapshot=clone(pick(variant,VARIANT_FIELDS));
    accept(await request(`${base()}/variants/${encodeURIComponent(id)}`,{method:'PATCH',body:{revision:revision(),variant:snapshot}}));
    if(epoch===editEpoch.variants.get(id)){dirty.variants.delete(id);jsonDrafts.delete(id);jsonErrors.delete(id);const saved=allVariants().find(v=>v.id===id);if(saved)variants.set(id,clone(saved));}
  }
  async function saveFeedback() {
    if (!dirty.feedback) return;
    accept(await request(`${base()}/feedback`,{method:'PATCH',body:{revision:revision(),feedback}}));dirty.feedback=false;feedback=clone(arr(p.feedback));
  }
  async function recordFeedbackDraft() {
    const form=clone(feedbackForm);
    if(!dirty.feedback && feedbackDraftExists()){
      const raw=form.value.trim(),metric=form.metric.trim();if(!metric)throw new Error('请填写反馈指标。');
      feedback.push({channel:form.channel,observedAt:new Date().toISOString(),metric,value:raw!==''&&Number.isFinite(Number(raw))?Number(raw):raw,note:form.note.trim(),source:'manual'});dirty.feedback=true;pendingFeedbackForm=clone(form);
    }
    await saveFeedback();
    if(pendingFeedbackForm && JSON.stringify(pendingFeedbackForm)===JSON.stringify(feedbackForm)){feedbackForm.note='';feedbackForm.value='';}pendingFeedbackForm=null;
  }
  async function saveCurrentRaw() {
    if (conflict) throw new Error('请先处理版本冲突；当前文字仍然保留。');
    if(dirty.sources)await saveSources();
    if (tab==='article') await saveArticle();
    else if (tab==='domestic' || tab==='overseas') {await saveChannels();await saveVariant(currentVariant()?.id);}
    else if(tab==='delivery')await recordFeedbackDraft();
    if(currentDirty())throw new Error('保存期间又有新的修改，文字已保留。请再保存一次后继续。');
    paintStatus();
  }
  const save=()=>serial(async()=>{await saveCurrentRaw();notice('本机修改已保存。','success');});
  function showConflict() {
    let box=root.querySelector('[data-lf-conflict]');if (!box) return;
    box.hidden=false;box.innerHTML=`<b>另一处编辑已经更新了项目</b><p>这里的输入不会被替换。先保存一份本地副本，再比较服务器版本。</p><div class="lf-actions">${button('backup-edits','下载当前编辑副本')}${button('compare-server','查看服务器新版')}${conflict?.server?button('use-server','使用服务器版'):''}</div><div data-lf-comparison></div>`;
  }
  function exportEdits() {downloadText(`小苋-${p.id}-未保存编辑.json`,JSON.stringify({projectId:p.id,basedOnRevision:revision(),sourceBundle:sources,article,selectedChannels:channels,variants:[...variants.values()],feedback,unsavedFeedback:feedbackForm,rawVariantJSON:Object.fromEntries(jsonDrafts),pendingImports:importText},null,2),'application/json');}
  function factMarkup() {
    return arr(sources.facts).map((fact,index)=>`<div class="lf-fact" data-lf-fact="${esc(fact.id)}"><span class="lf-fact-no">${String(index+1).padStart(2,'0')}</span><div><textarea rows="2" data-lf-fact-field="statement" data-id="${esc(fact.id)}" placeholder="一条能被材料支持的事实">${esc(fact.statement)}</textarea><details><summary>出处与适用范围 · ${esc(VERIFICATION[fact.verification] || fact.verification || '待核实')}</summary><label class="lf-field"><span>核验状态</span><select data-lf-fact-field="verification" data-id="${esc(fact.id)}">${Object.entries(VERIFICATION).map(([value,name])=>`<option value="${value}" ${fact.verification===value?'selected':''}>${name}</option>`).join('')}</select><small>按真实依据选择：亲自验证、代码检查或官方文档应有对应记录。选择状态不会替你完成事实核验。</small></label><label class="lf-field"><span>材料出处</span><select data-lf-fact-field="sourceId" data-id="${esc(fact.id)}"><option value="">待补出处</option>${arr(sources.sources).map(src=>`<option value="${esc(src.id)}" ${fact.sourceRefs?.[0]?.sourceId===src.id?'selected':''}>${esc(src.locator || src.text?.slice(0,40) || src.id)}</option>`).join('')}</select></label><label class="lf-field"><span>适用范围</span><input data-lf-fact-field="scope" data-id="${esc(fact.id)}" value="${esc(fact.scope)}" placeholder="例如：仅适用于本次实测环境"></label></details></div>${button('remove-fact','移除','quiet',`data-id="${esc(fact.id)}" aria-label="移除事实 ${index+1}"`)}</div>`).join('') || '<p class="lf-muted">把确定的事实单独记下来，写作时更容易核对。</p>';
  }
  function dependenciesMarkup() {
    const facts=arr(p.sourceBundle?.facts),deps=arr(article.sourceDeps),problems=dependencyProblems();
    const rows=facts.map(fact=>{
      const dep=deps.find(d=>d.factId===fact.id),stale=dep && dep.fingerprint!==fact.fingerprint;
      const status=stale?'事实已变化 · 需要重新核对':VERIFICATION[fact.verification] || fact.verification || '待核实';
      return `<div class="lf-dependency ${stale?'lf-dependency-stale':''}"><label><input type="checkbox" data-lf-fact-dep="${esc(fact.id)}" ${dep?'checked':''} ${dirty.sources || !fact.fingerprint?'disabled':''}><span><b>${esc(fact.statement)}</b><small>${esc(status)}${fact.scope?' · '+esc(fact.scope):''}</small></span></label>${stale?button('refresh-dependency','核对后重新引用','secondary',`data-id="${esc(fact.id)}"`):''}</div>`;
    }).join('');
    const missing=deps.filter(dep=>!facts.some(f=>f.id===dep.factId)).map(dep=>`<div class="lf-dependency lf-dependency-stale"><span>引用的事实 ${esc(dep.factId)} 已移除</span>${button('remove-dependency','移除这条引用','quiet',`data-id="${esc(dep.factId)}"`)}</div>`).join('');
    return `<details class="lf-dependencies"><summary>这篇引用的事实 <span>${deps.length} 条${problems.length?' · 需要核对':''}</span></summary><p>勾选正文实际用到的事实。引用绑定已保存材料的版本；事实改变后，需要你重新核对，系统不会自动替换引用。</p>${dirty.sources?`<div class="lf-rule-note">素材还有未保存修改，先保存后再添加引用。${button('save-sources-for-deps','保存素材并更新列表','quiet')}</div>`:''}<div>${rows || '<p class="lf-muted">还没有登记事实。可以先到“素材”补充并保存，再回来选择。</p>'}${missing}</div>${problems.length?`<p class="lf-dependency-warning">引用中存在待核实、已移除或已变化的事实。处理后才能审核长文。</p>`:''}</details>`;
  }
  function refreshDependencies() {
    const host=root.querySelector('[data-lf-dependencies]');if(!host)return;
    const open=host.querySelector('details')?.open;host.innerHTML=dependenciesMarkup();if(open && host.querySelector('details'))host.querySelector('details').open=true;
  }
  function assetMarkup({insert=false}={}) {
    return assets().map(asset=>`<article class="lf-asset"><img src="${assetPrefix()}${encodeURIComponent(asset.id)}" alt="${esc(asset.alt || asset.name)}" loading="lazy"><div><b>${esc(asset.name)}</b><small>${esc(asset.mimeType)}${asset.mimeType==='image/gif'?' · 动图':''}</small><label class="lf-field"><span>图注</span><input data-lf-asset-field="caption" data-id="${esc(asset.id)}" value="${esc(sources.assets?.find(a=>a.id===asset.id)?.caption || asset.caption)}"></label><label class="lf-field"><span>图片说明</span><input data-lf-asset-field="alt" data-id="${esc(asset.id)}" value="${esc(sources.assets?.find(a=>a.id===asset.id)?.alt || asset.alt)}"></label>${insert?button('insert-asset','插入正文','quiet',`data-id="${esc(asset.id)}"`):`<code>asset:${esc(asset.id)}</code>`}</div></article>`).join('') || '<div class="lf-empty-compact">还没有素材图。真实截图和操作动图可以放在这里。</div>';
  }
  function sourcesView() {
    const notes=arr(sources.sources).filter(s=>s.type==='note');
    if (!notes.length) {sources.sources=arr(sources.sources);sources.sources.push({id:uid('source'),type:'note',text:'',locator:'',verification:'user_reported',publicScope:'reference_only'});}
    const noteFields=arr(sources.sources).filter(s=>s.type==='note').map((src,index)=>`<label class="lf-field"><span>${index?'补充材料':'把故事和资料放进来'}</span><textarea rows="${index?4:10}" data-lf-source-note="${esc(src.id)}" placeholder="发生了什么？你做了哪些尝试？有哪些真实结果、操作步骤或原始记录？">${esc(src.text)}</textarea></label>`).join('');
    const links=arr(sources.sources).filter(s=>s.type==='url').map(s=>s.locator || s.text).join('\n');
    return `<div class="lf-grid"><section class="lf-panel lf-paper"><div class="lf-section-top"><span class="lf-kicker">01 / 先给足资料</span><span class="lf-chip">原始材料</span></div><h2>好内容，从真实材料开始。</h2><p class="lf-muted">先保留发生过的事，再决定怎么讲。链接用作资料，网页内容需要另行读取与核验。</p>${noteFields}${labelField('参考链接，一行一条','source-links',links,{area:true,rows:3,placeholder:'https://…'})}<div class="lf-rule-note">材料默认仅供创作参考，不自动视为已核实、可公开或已取得素材授权。</div></section><section class="lf-panel"><div class="lf-section-top"><span class="lf-kicker">02 / 把依据记清楚</span>${button('add-fact','＋ 添加事实','quiet')}</div><h2>哪些事，是确定的？</h2><div data-lf-facts>${factMarkup()}</div><div class="lf-divider"></div><h3>图片与操作动图</h3><p class="lf-muted">支持本地 PNG、JPEG、WebP、GIF。上传只登记素材，不代表审核通过。</p><label class="lf-upload">＋ 选择本地图片 / GIF<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple data-lf-upload></label><div class="lf-assets" data-lf-assets>${assetMarkup()}</div></section></div>`;
  }
  function taskPanel(kind) {
    return `<details class="lf-task" ${taskText[kind] || importText[kind]?'open':''}><summary>创作任务与 JSON 导入 <span>在 Codex 中完成写作</span></summary><p>准备任务后，把资料交给 Codex。完成后将结果 JSON 粘贴回来；这里不会自动调用模型，也不会替你审核。</p><div class="lf-actions">${button('prepare-task','准备并复制任务','primary',`data-kind="${kind}"`)}${taskText[kind]?button('copy-task','再次复制','quiet',`data-kind="${kind}"`):''}</div><textarea rows="4" data-lf-task-output="${kind}" readonly placeholder="任务准备完成后显示在这里">${esc(taskText[kind] || '')}</textarea><label class="lf-field"><span>结果 JSON</span><textarea rows="5" data-lf-import="${kind}" spellcheck="false" placeholder="粘贴 Codex 返回的完整 JSON">${esc(importText[kind] || '')}</textarea></label><div class="lf-actions">${button('import-result','导入结果','secondary',`data-kind="${kind}"`)}<label class="lf-file-button">或选择 JSON 文件<input type="file" accept="application/json,.json" data-lf-json-file="${kind}"></label></div></details>`;
  }
  function previewMarkup() {
    return `<section class="lf-preview-panel"><div class="lf-section-top"><span class="lf-kicker">阅读预览</span><span class="lf-chip" data-lf-article-badge>长文待审核</span></div><div class="lf-preview-tools"><div class="lf-widths" role="group" aria-label="预览宽度">${[['desktop','桌面'],['375','375'],['390','390'],['430','430']].map(([width,label])=>`<button type="button" data-lf-action="preview-width" data-width="${width}" aria-pressed="${previewWidth===width}">${label}</button>`).join('')}</div>${button('article-preview','保存并预览','quiet')}</div><div class="lf-preview-stage" data-lf-preview-stage><div class="lf-preview-empty"><span>文</span><h3>用读者的方式看一遍</h3><p>先保存并预览，再核对事实、段落、图片与正文末尾。</p></div></div><div class="lf-review"><label><input type="checkbox" data-lf-article-ack> 我已核对本版长文的事实、来源、文字和配图</label>${button('article-approve','确认本版长文','primary','disabled')}<p>审核只属于当前长文版本。图卡和各平台稿分别确认。</p></div></section>`;
  }
  function articleView() {
    return `<div class="lf-article-layout"><section class="lf-panel lf-editor"><span class="lf-kicker">把材料写成一篇有用的文章</span><div class="lf-story-types" role="group" aria-label="长文类型"><button type="button" data-lf-action="story-type" data-value="tutorial" aria-pressed="${article.storyType!=='diary'}"><b>经验教程</b><small>收益、证据、步骤与成功标准</small></button><button type="button" data-lf-action="story-type" data-value="diary" aria-pressed="${article.storyType==='diary'}"><b>创业日志</b><small>真实事件、选择与个人感受</small></button></div>${labelField('文章标题','article-title',article.title,{placeholder:'这篇文章，能给读者带来什么？'})}${labelField('摘要','article-digest',article.digest,{area:true,rows:2})}${labelField('正文 · Markdown','article-bodyMd',article.bodyMd,{area:true,rows:23,help:'图片用 ![说明](asset:素材ID) 引用；平台改写不会覆盖这里。'})}<div data-lf-dependencies>${dependenciesMarkup()}</div><details class="lf-inline-assets"><summary>插入已登记图片 / GIF</summary><div class="lf-assets">${assetMarkup({insert:true})}</div></details>${taskPanel('article')}<div class="lf-actions lf-source-exports" data-lf-export-source hidden><a class="lf-button lf-secondary" href="${base()}/export?format=zip&amp;workId=article-main" data-lf-action="export-source" data-format="zip" download>下载完整离线包</a><a class="lf-button lf-quiet" href="${base()}/export?format=html&amp;workId=article-main" download>下载离线 HTML</a></div></section>${previewMarkup()}</div>`;
  }
  function variantEditor(group) {
    const list=currentVariants(group),variant=currentVariant(group);
    if (!variant) return `<div class="lf-empty"><span>↗</span><h2>先选读者所在的平台</h2><p>准备适配任务，再导入对应版本。中文原稿是材料，海外稿重新考虑背景、表达与平台习惯。</p></div>`;
    variantChoice[group]=variant.id;
    const approved=p.runtime?.variantApproved?.[variant.id] && !dirty.variants.has(variant.id);
    const cards=variant.format==='cards'?cardsVariantMarkup(variant):'';
    return `<section class="lf-panel lf-variant-editor"><div class="lf-section-top"><label class="lf-field lf-variant-select"><span>当前平台版本</span><select data-lf-variant-select>${list.map(v=>`<option value="${esc(v.id)}" ${v.id===variant.id?'selected':''}>${esc(CHANNELS[group].find(c=>c.id===v.channel)?.name || v.channel)} · ${esc(FORMAT[v.format] || v.format)} · ${esc(v.locale)}</option>`).join('')}</select></label><span class="lf-chip ${approved?'lf-approved':''}" data-lf-variant-badge>${approved?'本版已审核':'本版待审核'}</span></div><aside class="lf-profile-note ${p.runtime?.profiles?.[variant.id]?.status==='needs_recheck'?'lf-profile-stale':''}" data-lf-profile-note>${profileMarkup(variant)}</aside>${labelField('平台标题','variant-title',variant.title)}${labelField(variant.format==='cards'?'平台配文 · Markdown':'平台正文 · Markdown','variant-bodyMd',variant.bodyMd,{area:true,rows:variant.format==='cards'?8:18,help:'修改只影响这个平台版本，源长文和其他平台稿保留。'})}${cards}<details class="lf-variant-reading"><summary>展开文稿阅读检查</summary><iframe title="平台适配稿阅读检查" sandbox="" referrerpolicy="no-referrer" data-lf-variant-preview></iframe><p class="lf-muted">这是本机文字阅读辅助。图卡还需核对每页内容及实际 PNG。</p></details><div class="lf-review"><label><input type="checkbox" data-lf-variant-ack> 我已核对这个渠道、语言和内容形式的完整文稿${variant.format==='cards'?'，包括每页图中文字':''}</label><div class="lf-actions">${button('save','保存本版','secondary')}${button('variant-approve','确认这个平台版本','primary','disabled')}</div><p>原稿审核不代替平台稿审核；修改后需重新确认。</p></div></section>`;
  }
  function profileMarkup(variant) {
    const profile=p.runtime?.profiles?.[variant.id];
    if(!profile)return '<span>平台规则资料尚未返回，当前仅导出内容包。</span>';
    const dates=`资料核验日期：${esc(profile.verifiedDate || '尚未核验')}${profile.recheckAfter?` · 复查日期：${esc(profile.recheckAfter)}`:''}`;
    return `<span>${dates}</span>${profile.status==='needs_recheck'?'<p>平台规则资料需要重新核对。当前保持仅导出，不会向平台发送内容。</p>':'<p>规则资料日期不代表远程连接已验证。当前仅导出。</p>'}`;
  }
  function cardsVariantMarkup(variant) {
    const drafts=jsonDrafts.get(variant.id) || {};
    const cardsText=drafts.cards ?? JSON.stringify(arr(variant.cards),null,2),visualText=drafts.visual ?? JSON.stringify(variant.visual || {},null,2);
    const pages=arr(variant.cards).map((card,index)=>`<article class="lf-card-proof"><span>${String(index+1).padStart(2,'0')}</span><div><b>${esc(card.title || card.headline || '无标题页')}</b><p>${esc([card.body,card.text,card.subtitle,...arr(card.blocks).map(block=>[block.title,block.heading,block.text,block.body,...arr(block.items).map(item=>typeof item==='string'?item:JSON.stringify(item))].filter(Boolean).join('\n'))].filter(Boolean).join('\n\n'))}</p></div></article>`).join('');
    return `<section class="lf-card-version"><div class="lf-section-top"><h3>这套图卡 · ${arr(variant.cards).length} 页</h3><span class="lf-chip">图中文字独立适配</span></div><p class="lf-muted">配文和图片里的文字分别检查。导出前会生成本版真实 PNG；没有图卡内容时，不能把配文翻译称作整套图卡翻译。</p><div data-lf-card-proofs>${pages || '<div class="lf-empty-compact">这一版尚未导入图卡。请让 Codex 返回完整 cards 与 visual。</div>'}</div><details><summary>编辑图卡内容与编排 JSON</summary>${labelField('每页 cards','variant-cardsJson',cardsText,{area:true,rows:10})}${labelField('视觉与编排 visual','variant-visualJson',visualText,{area:true,rows:5})}<p class="lf-muted" data-lf-json-error>${esc(jsonErrors.get(variant.id) || '')}</p></details></section>`;
  }
  function channelsView(group) {
    const config=options[group],chosen=arr(channels[group]);
    return `<div class="lf-channels-layout"><aside class="lf-panel lf-channel-plan"><span class="lf-kicker">${group==='domestic'?'给熟悉中文的读者':'给另一种背景的读者'}</span><h2>${group==='domestic'?'选择这一轮要去的地方。':'从资料出发，重新写。'}</h2><p class="lf-muted">只为勾选的渠道准备任务。资料与事实复用，内容按平台重新组织。</p><label class="lf-field"><span>这次使用的材料</span><select data-lf-option="sourceWorkId"><option value="article-main" ${config.sourceWorkId==='article-main'?'selected':''}>源长文</option><option value="cards-main" ${config.sourceWorkId==='cards-main'?'selected':''}>原图卡内容</option></select></label><label class="lf-field"><span>这一轮适配语言</span><select data-lf-option="locale">${[['zh-CN','简体中文'],['en-US','English'],['zh-TW','繁體中文']].map(([value,name])=>`<option value="${value}" ${config.locale===value?'selected':''}>${name}</option>`).join('')}</select></label><div class="lf-channel-list">${CHANNELS[group].map(channel=>`<div class="lf-channel-row"><label><input type="checkbox" data-lf-channel="${channel.id}" ${chosen.includes(channel.id)?'checked':''}><span class="lf-channel-mark">${esc(channel.mark)}</span><span><b>${esc(channel.name)}</b><small>${esc(channel.hint)}</small></span></label><select aria-label="${esc(channel.name)}内容形式" data-lf-format="${channel.id}">${channel.formats.map(format=>`<option value="${format}" ${config.formats[channel.id]===format?'selected':''}>${FORMAT[format]}</option>`).join('')}</select></div>`).join('')}</div><div class="lf-export-only"><span>↗</span><div><b>本轮只导出内容包</b><p>远程草稿连接尚未验证。这里不会向任何社媒发送内容。</p></div></div>${taskPanel(group)}</aside><div data-lf-variant-editor>${variantEditor(group)}</div></div>`;
  }
  function deliveryStatus(item) {
    const labels={local_ready:'本机包就绪',api_accepted:'接口已受理 · 待核对',needs_attention:'需要核对',unknown_outcome:'结果未知',queued_local:'已保存本机队列',running:'准备中',needs_login:'需要登录',draft_verified:'草稿已核对',exported:'本机包已生成',ready:'本机包就绪',completed:'本机任务完成',unknown:'结果未知',uncertain:'结果未知',unverified:'待核对',failed:'未完成',error:'未完成',pending:'准备中',preparing:'准备中',queued:'排队中',saved_local:'已保存在本机'};
    return labels[item.status] || item.status || '待检查';
  }
  function localURL(url) {if (typeof url!=='string')return '';try {const parsed=new URL(url,location.origin);return parsed.origin===location.origin && parsed.pathname.startsWith('/api/') ? parsed.href : '';}catch{return '';}}
  function deliveriesMarkup() {
    return arr(p.deliveries).map(item=>{
      const unknown=['unknown_outcome','unknown','uncertain'].includes(item.status) || item.outcome==='unknown';
      const local=item.mode==='export' || item.destination==='local';
      return `<article class="lf-delivery-row"><div><b>${esc(item.channel || item.variantId || '本机交付')}</b><span class="lf-chip">${esc(deliveryStatus(item))}</span><p>${esc(item.message || item.note || (item.destination==='local'?'保存在本机，没有写入远程平台。':''))}</p>${unknown?'<p class="lf-delivery-caution">需要人工核对原任务；结果未确认前，不会自动重新创建。</p>':''}<small>${esc(item.id)}</small></div><div class="lf-actions">${localURL(item.url)?`<a class="lf-button lf-secondary" href="${esc(localURL(item.url))}" download>下载</a>`:''}${button('delivery-check','重查状态','quiet',`data-id="${esc(item.id)}"`)}${unknown?button('delivery-manual-help','人工核对说明','secondary'):local&&['needs_attention','unverified'].includes(item.status)?button('delivery-reconcile','核对本机包','secondary',`data-id="${esc(item.id)}"`):''}</div></article>`;
    }).join('') || '<p class="lf-muted">还没有交付记录。生成包后，会留下对应审核版本与状态。</p>';
  }
  function deliveryView() {
    const reviewed=allVariants().filter(v=>p.runtime?.variantApproved?.[v.id]);
    return `<div class="lf-grid"><section class="lf-panel"><span class="lf-kicker">把完成的内容带走</span><h2>审核过，再交付。</h2><div class="lf-export-only"><span>↗</span><div><b>仅导出 · 远程连接未验证</b><p>生成本机包不代表已保存到平台或已发布。最终发布由你完成。</p></div></div><div class="lf-source-exports" data-lf-export-source hidden><h3>源长文</h3><div class="lf-actions"><a class="lf-button lf-secondary" href="${base()}/export?format=zip&amp;workId=article-main" data-lf-action="export-source" data-format="zip" download>完整离线包</a><a class="lf-button lf-quiet" href="${base()}/export?format=html&amp;workId=article-main" download>离线 HTML</a></div></div><label class="lf-field"><span>选择已审核的平台版本</span><select data-lf-delivery-variant><option value="">请选择一个版本</option>${reviewed.map(v=>`<option value="${esc(v.id)}">${esc(v.channel)} · ${esc(FORMAT[v.format] || v.format)} · ${esc(v.locale)} · ${esc(v.title)}</option>`).join('')}</select></label>${button('export-variant','生成本机交付包','primary')}<p class="lf-muted">图片、文稿与必要说明按所选版本打包。LinkedIn 图卡包不等于已生成 PDF。</p><div class="lf-divider"></div><h3>交付记录</h3><div data-lf-deliveries>${deliveriesMarkup()}</div></section><section class="lf-panel lf-paper"><span class="lf-kicker">从真实反馈继续改</span><h2>这次，读者怎么回应？</h2><p class="lf-muted">手动记下一条具体反馈。只记录你看到的结果，不自动获取平台数据。</p><div class="lf-inline-fields"><label class="lf-field"><span>渠道</span><select data-lf-feedback-channel>${Object.values(CHANNELS).flat().map(c=>`<option value="${c.id}" ${feedbackForm.channel===c.id?'selected':''}>${esc(c.name)}</option>`).join('')}</select></label><label class="lf-field"><span>指标</span><input data-lf-feedback-metric value="${esc(feedbackForm.metric)}" placeholder="例如：收藏数 / 读者反馈"></label></div><label class="lf-field"><span>数值（可选）</span><input data-lf-feedback-value value="${esc(feedbackForm.value)}" placeholder="只记录实测数字"></label><label class="lf-field"><span>发生了什么</span><textarea rows="4" data-lf-feedback-note placeholder="读者提出了哪个问题？下一次想改什么？">${esc(feedbackForm.note)}</textarea></label>${button('add-feedback','记录并保存','secondary')}<div class="lf-feedback-list" data-lf-feedback-list>${feedbackMarkup()}</div></section></div>`;
  }
  function feedbackMarkup() {return [...feedback].reverse().map(item=>`<article><small>${esc(item.channel)} · ${esc(item.observedAt?.slice(0,10))}</small><b>${esc(item.metric)}${item.value!==''&&item.value!=null?` · ${esc(item.value)}`:''}</b><p>${esc(item.note)}</p></article>`).join('');}
  function render() {
    if (destroyed) return;
    previewResizeObserver?.disconnect();previewResizeObserver=null;
    root.innerHTML=`<header class="lf-heading"><div><span class="lf-kicker">小苋 · 内容工作室</span><h1>一个故事，更多有用的表达。</h1><p>素材、长文与平台版本各自保存，确认好这一版，再把它带走。</p></div>${button('back','返回原图卡','quiet')}</header><nav class="lf-nav" aria-label="内容工作室步骤">${TABS.map((item,index)=>`<button type="button" data-lf-action="tab" data-tab="${item.id}" aria-current="${tab===item.id?'step':'false'}"><span>${String(index+1).padStart(2,'0')}</span>${item.name}</button>`).join('')}</nav><div class="lf-savebar"><span data-lf-save-state>已保存在本机</span>${button('save','保存当前修改','secondary')}</div><div class="lf-notice" role="status" aria-live="polite" data-lf-notice hidden></div><aside class="lf-conflict" data-lf-conflict hidden></aside><div class="lf-content">${tab==='sources'?sourcesView():tab==='article'?articleView():tab==='delivery'?deliveryView():channelsView(tab)}</div>`;
    if (conflict) showConflict();paintStatus();paintVariantPreview();if (tab==='article' && preview) paintPreview();
  }
  function paintPreview() {
    const stage=root.querySelector('[data-lf-preview-stage]');if (!stage || !preview) return;
    previewResizeObserver?.disconnect();previewResizeObserver=null;
    const iframe=document.createElement('iframe');iframe.title='长文安全阅读预览';iframe.setAttribute('sandbox','');iframe.referrerPolicy='no-referrer';iframe.srcdoc=safePreviewHTML(preview.html,assetPrefix());iframe.dataset.lfArticleFrame='';
    const fit=document.createElement('div');fit.className='lf-preview-fit';fit.append(iframe);
    stage.replaceChildren(fit);stage.dataset.width=previewWidth;
    if(typeof ResizeObserver==='function'){previewResizeObserver=new ResizeObserver(fitPreview);previewResizeObserver.observe(stage);}
    fitPreview();paintStatus();
  }
  function fitPreview() {
    if(destroyed)return;
    const stage=root.querySelector('[data-lf-preview-stage]'),iframe=stage?.querySelector('[data-lf-article-frame]'),fit=stage?.querySelector('.lf-preview-fit');
    if(!stage || !iframe || !fit)return;
    const style=getComputedStyle(stage),padding=(parseFloat(style.paddingLeft)||0)+(parseFloat(style.paddingRight)||0);
    const available=Math.max(1,Math.floor(stage.clientWidth-padding));
    const logicalWidth=previewWidth==='desktop'?available:Number(previewWidth),height=640;
    const scale=Math.min(1,available/logicalWidth);
    iframe.style.width=`${logicalWidth}px`;iframe.style.height=`${height}px`;iframe.style.transform=scale<1?`scale(${scale})`:'none';
    fit.style.width=`${logicalWidth*scale}px`;fit.style.height=`${height*scale}px`;
    stage.dataset.fitScale=String(scale);stage.dataset.logicalWidth=String(logicalWidth);
  }
  function paintVariantPreview() {const frame=root.querySelector('[data-lf-variant-preview]'),variant=currentVariant();if (frame && variant) frame.srcdoc=safePreviewHTML(simpleVariantPreview(variant,assetPrefix()),assetPrefix());}
  function updateDeliveryPanel() {const panel=root.querySelector('[data-lf-deliveries]');if (panel)panel.innerHTML=deliveriesMarkup();paintStatus();}
  async function clipboard(text) {
    try {await navigator.clipboard.writeText(text);return true;}catch {notice('任务已准备。浏览器未允许复制，请在任务框中全选复制。','info');return false;}
  }
  function selectedKeys(group) {return arr(channels[group]).filter(id=>CHANNELS[group].some(c=>c.id===id)).map(channel=>({channel,format:options[group].formats[channel],locale:options[group].locale}));}
  async function prepareTask(kind) {
    await saveCurrentRaw();let input;
    if (kind==='article') input=await request(`${base()}/article-input`);
    else {const keys=selectedKeys(kind);if (!keys.length) throw new Error('先勾选这一轮需要适配的渠道。');input=await request(`${base()}/variant-input?keys=${encodeURIComponent(JSON.stringify(keys))}&sourceWorkId=${encodeURIComponent(options[kind].sourceWorkId)}`);}
    taskInputs[kind]=clone(input);taskText[kind]=typeof input.task==='string'?input.task:typeof input.prompt==='string'?input.prompt:JSON.stringify(input,null,2);
    const out=root.querySelector(`[data-lf-task-output="${kind}"]`);if(out)out.value=taskText[kind];const panel=out?.closest('details');if(panel)panel.open=true;
    if(await clipboard(taskText[kind]))notice('任务已复制。交给 Codex 写作后，再导入 JSON 结果。','success');
  }
  async function importResult(kind) {
    await saveCurrentRaw();const field=root.querySelector(`[data-lf-import="${kind}"]`);let payload;
    try {payload=JSON.parse(field?.value || '');}catch {throw new Error('结果不是有效 JSON，请保留完整对象后重试。');}
    if(!payload || Array.isArray(payload) || typeof payload!=='object')throw new Error('请导入完整 JSON 对象。');
    const envelope=taskInputs[kind];
    if(envelope)for(const key of ['revision','sourceWorkId','sourceWorkHash','keys','inputFingerprint','sourceBundleHash'])if(payload[key]===undefined && envelope[key]!==undefined)payload[key]=clone(envelope[key]);
    accept(await request(`${base()}/${kind==='article'?'article-import':'variant-import'}`,{method:'POST',body:payload}));
    importText[kind]='';
    if(kind==='article'){article=clone(p.article || emptyArticle());dirty.article=false;preview=null;}
    else {for(const variant of allVariants())if(!dirty.variants.has(variant.id))variants.set(variant.id,clone(variant));variantChoice[kind]=currentVariants(kind).at(-1)?.id || '';}
    render();notice('结果已导入本机。请逐版检查并由你确认审核。','success');
  }
  async function uploadFiles(files) {
    await saveCurrentRaw();
    for (const file of files) {
      if(!['image/png','image/jpeg','image/webp','image/gif'].includes(file.type))throw new Error(`${file.name}：请选择 PNG、JPEG、WebP 或 GIF。`);
      if(file.size>20*1024*1024)throw new Error(`${file.name} 超过本机上传保护上限 20 MiB。`);
      const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('读取本地文件失败。'));reader.readAsDataURL(file);});
      accept(await request(`${base()}/assets`,{method:'POST',body:{revision:revision(),name:file.name,mime:file.type,data,caption:'',alt:file.name}}));
    }
    sources=clone(p.sourceBundle || sources);const gallery=root.querySelector('[data-lf-assets]');if(gallery)gallery.innerHTML=assetMarkup();notice('素材已登记。GIF 保留为动图，尚未进入审核。','success');
  }
  async function action(el) {
    const name=el.dataset.lfAction;
    if(name==='save')return saveCurrentRaw().then(()=>notice('本机修改已保存。','success'));
    if(name==='tab'){await saveCurrentRaw();tab=el.dataset.tab;render();return;}
    if(name==='back'){await saveCurrentRaw();onBack();return;}
    if(name==='backup-edits'){exportEdits();notice('编辑副本已下载。','success');return;}
    if(name==='compare-server'){
      const result=await request(base());const server=result.project || result;conflict={server};showConflict();
      const box=root.querySelector('[data-lf-comparison]');if(box){box.innerHTML='<p>服务器版本仅供比较，不会替换当前输入。</p><pre></pre>';box.querySelector('pre').textContent=JSON.stringify({revision:server.revision,article:server.article,selectedChannels:server.selectedChannels,variants:server.variants},null,2);}return;
    }
    if(name==='use-server'){
      if(!conflict?.server)return;exportEdits();p=clone(conflict.server);onProject(clone(p));sources=clone(p.sourceBundle || sources);article=clone(p.article || emptyArticle());channels=clone(p.selectedChannels || channels);feedback=clone(arr(p.feedback));variants.clear();dirty={sources:false,article:false,channels:false,variants:new Set(),feedback:false};conflict=null;preview=null;render();notice('本地编辑副本已下载，现已载入服务器版。','info');return;
    }
    if(conflict)throw new Error('请先处理版本冲突，或下载当前编辑副本。');
    if(name==='add-fact'){sources.facts=arr(sources.facts);sources.facts.push({id:uid('fact'),statement:'',sourceRefs:[],provenance:'user_reported',verification:'unverified',scope:'',fingerprint:''});mark('sources');root.querySelector('[data-lf-facts]').innerHTML=factMarkup();return;}
    if(name==='remove-fact'){sources.facts=arr(sources.facts).filter(f=>f.id!==el.dataset.id);mark('sources');root.querySelector('[data-lf-facts]').innerHTML=factMarkup();return;}
    if(name==='story-type'){article.storyType=el.dataset.value;mark('article');root.querySelectorAll('[data-lf-action="story-type"]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.value===article.storyType)));return;}
    if(name==='save-sources-for-deps'){await saveSources();if(dirty.sources)throw new Error('素材保存期间又有修改，请再保存一次。');refreshDependencies();paintStatus();notice('已显示当前保存的事实版本，请选择正文实际引用的内容。','success');return;}
    if(name==='remove-dependency'){article.sourceDeps=arr(article.sourceDeps).filter(dep=>dep.factId!==el.dataset.id);mark('article');refreshDependencies();return;}
    if(name==='refresh-dependency'){
      await saveSources();if(dirty.sources)throw new Error('先保存素材，再核对事实引用。');
      const fact=arr(p.sourceBundle?.facts).find(f=>f.id===el.dataset.id);if(!fact?.fingerprint)throw new Error('这条事实没有当前已保存的指纹，请先核对素材。');
      article.sourceDeps=arr(article.sourceDeps).filter(dep=>dep.factId!==fact.id).concat({factId:fact.id,fingerprint:fact.fingerprint});mark('article');refreshDependencies();notice('已按你的操作重新引用当前事实。请保存、预览并重新审核长文。','info');return;
    }
    if(name==='insert-asset'){
      const asset=assets().find(a=>a.id===el.dataset.id);if(!asset)return;
      const input=root.querySelector('[data-lf-field="article-bodyMd"]');const text=`\n\n![${(asset.alt || asset.caption || asset.name || '').replace(/[\[\]\n]/g,' ')}](asset:${asset.id})\n\n`;const start=input.selectionStart ?? input.value.length,end=input.selectionEnd ?? start;
      input.setRangeText(text,start,end,'end');article.bodyMd=input.value;article.assets=arr(article.assets);if(!article.assets.some(a=>(typeof a==='string'?a:a.assetId)===asset.id))article.assets.push(asset.id);mark('article');input.focus();return;
    }
    if(name==='prepare-task')return prepareTask(el.dataset.kind);
    if(name==='copy-task'){await clipboard(taskText[el.dataset.kind] || '');return;}
    if(name==='import-result')return importResult(el.dataset.kind);
    if(name==='article-preview'){await saveCurrentRaw();preview=await request(`${base()}/article-preview`);paintPreview();notice('预览已更新。确认完整文稿后，可以独立审核这一版。','success');return;}
    if(name==='preview-width'){previewWidth=el.dataset.width;root.querySelectorAll('[data-lf-action="preview-width"]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.width===previewWidth)));paintPreview();return;}
    if(name==='article-approve'){
      if(dependencyProblems().length)throw new Error('引用事实尚未核实或已变化，请在“这篇引用的事实”中核对。');
      if(dirty.article || !preview?.artifactHash || !root.querySelector('[data-lf-article-ack]')?.checked)throw new Error('先保存、预览并勾选核对说明。');
      accept(await request(`${base()}/article-approve`,{method:'POST',body:{revision:revision(),artifactHash:preview.artifactHash,actor:'user'}}));article=clone(p.article || article);paintStatus();notice('当前长文已由你确认。平台版本仍需分别审核。','success');return;
    }
    if(name==='variant-approve'){
      const variant=currentVariant();if(!variant || dirty.variants.has(variant.id) || !root.querySelector('[data-lf-variant-ack]')?.checked)throw new Error('先保存并核对当前平台稿。');
      const hash=p.runtime?.variantHashes?.[variant.id];if(!hash)throw new Error('当前版本指纹尚未返回，请先保存。');
      accept(await request(`${base()}/variants/${encodeURIComponent(variant.id)}/approve`,{method:'POST',body:{revision:revision(),artifactHash:hash,actor:'user'}}));const saved=allVariants().find(v=>v.id===variant.id);if(saved)variants.set(variant.id,clone(saved));root.querySelector('[data-lf-variant-editor]').innerHTML=variantEditor(tab);paintVariantPreview();paintStatus();notice('这个平台版本已由你确认。','success');return;
    }
    if(name==='export-source'){
      await saveCurrentRaw();
      const result=accept(await request(`${base()}/deliveries`,{method:'POST',body:{revision:revision(),variantId:'article-main',mode:'export',destination:'local'}}));
      updateDeliveryPanel();const url=localURL(result.url || result.delivery?.url);
      if(!url)throw new Error('本机交付记录已更新，但下载地址尚未返回。请在交付记录中重查状态。');
      const anchor=document.createElement('a');anchor.href=url;anchor.download='';anchor.click();notice('源长文离线包已准备，本机版本记录已同步。','success');return;
    }
    if(name==='export-variant'){
      await saveCurrentRaw();const id=root.querySelector('[data-lf-delivery-variant]')?.value;if(!id)throw new Error('先选择一个已审核的平台版本。');
      const variant=allVariants().find(v=>v.id===id);
      if(variant?.format==='cards'){
        if(!arr(variant.cards).length)throw new Error('这版还没有完整图卡，不能仅凭翻译配文导出整套图卡。');
        if(typeof onRenderCards!=='function')throw new Error('本机图卡渲染尚未连接，请保留版本并返回图卡检查。');
        notice('正在为已审核版本生成真实 PNG…','info');
        const rendered=await onRenderCards(clone(variant));
        if(Array.isArray(rendered))accept(await request(`${base()}/variants/${encodeURIComponent(id)}/images`,{method:'POST',body:{revision:revision(),artifactHash:p.runtime?.variantHashes?.[id],images:rendered}}));
        else if(Array.isArray(rendered?.images) && !rendered.project)accept(await request(`${base()}/variants/${encodeURIComponent(id)}/images`,{method:'POST',body:{revision:revision(),artifactHash:p.runtime?.variantHashes?.[id],images:rendered.images}}));
        else if(rendered?.project || rendered?.id===p.id)accept(rendered);
        else throw new Error('图卡 PNG 没有返回完整保存结果，尚未生成交付包。');
      }
      const result=accept(await request(`${base()}/deliveries`,{method:'POST',body:{revision:revision(),variantId:id,mode:'export',destination:'local'}}));updateDeliveryPanel();const url=localURL(result.url || result.delivery?.url);notice('本机交付包已准备；没有向社媒发布。','success');if(url){const a=document.createElement('a');a.href=url;a.download='';a.click();}return;
    }
    if(name==='delivery-manual-help'){notice('请根据原任务编号核对已有结果；如涉及平台草稿，需人工查看原编辑页。结果未知不会触发自动重新创建，也不会重新提交远程内容。','info');return;}
    if(name==='delivery-check' || name==='delivery-reconcile'){
      const path=`/api/deliveries/${encodeURIComponent(el.dataset.id)}${name==='delivery-reconcile'?'/reconcile':''}`;
      const result=accept(await request(path,name==='delivery-reconcile'?{method:'POST',body:{revision:revision()}}:{}));
      if(!result.project && result.delivery){p.deliveries=arr(p.deliveries).map(d=>d.id===result.delivery.id?result.delivery:d);onProject(clone(p));}
      updateDeliveryPanel();notice('状态已重查。结果未知时请保留原任务，避免重复创建。','info');return;
    }
    if(name==='add-feedback'){
      const channel=root.querySelector('[data-lf-feedback-channel]').value,metric=root.querySelector('[data-lf-feedback-metric]').value.trim(),note=root.querySelector('[data-lf-feedback-note]').value.trim(),raw=root.querySelector('[data-lf-feedback-value]').value.trim();
      if(!metric || (!note && !raw))throw new Error('填写一条具体反馈或实测数字。');
      Object.assign(feedbackForm,{channel,metric,note,value:raw});await recordFeedbackDraft();root.querySelector('[data-lf-feedback-list]').innerHTML=feedbackMarkup();root.querySelector('[data-lf-feedback-note]').value=feedbackForm.note;root.querySelector('[data-lf-feedback-value]').value=feedbackForm.value;paintStatus();notice('这条手动反馈已保存。','success');
    }
  }
  function onInput(event) {
    const el=event.target;if(!(el instanceof HTMLElement))return;
    const field=el.dataset.lfField;
    if(el.dataset.lfImport)importText[el.dataset.lfImport]=el.value;
    if(field==='source-links') {
      const existing=arr(sources.sources).filter(s=>s.type==='url'),links=el.value.split(/\n/).map(v=>v.trim()).filter(Boolean);
      sources.sources=arr(sources.sources).filter(s=>s.type!=='url').concat([...new Set(links)].map(locator=>existing.find(s=>s.locator===locator)||{id:uid('source'),type:'url',text:'',locator,verification:'user_reported',publicScope:'reference_only'}));mark('sources');
    } else if(field?.startsWith('article-')) {article[field.slice(8)]=el.value;mark('article');}
    else if(field==='variant-cardsJson' || field==='variant-visualJson'){
      const v=currentVariant();if(v){const key=field==='variant-cardsJson'?'cards':'visual',draft=jsonDrafts.get(v.id) || {};draft[key]=el.value;jsonDrafts.set(v.id,draft);
        try {for(const [draftKey,text] of Object.entries(draft)){const parsed=JSON.parse(text);if(draftKey==='cards'&&!Array.isArray(parsed))throw new Error('cards 需要是数组');if(draftKey==='visual'&&(!parsed || Array.isArray(parsed) || typeof parsed!=='object'))throw new Error('visual 需要是对象');v[draftKey]=parsed;}jsonErrors.delete(v.id);}catch{jsonErrors.set(v.id,'图卡 JSON 尚不完整，文字已保留。请修正后再保存。');}
        const error=root.querySelector('[data-lf-json-error]');if(error)error.textContent=jsonErrors.get(v.id) || '';mark('variants',v.id);
      }
    }
    else if(field?.startsWith('variant-')) {const v=currentVariant();if(v){v[field.slice(8)]=el.value;mark('variants',v.id);}}
    if(el.dataset.lfSourceNote){const source=arr(sources.sources).find(s=>s.id===el.dataset.lfSourceNote);if(source){source.text=el.value;mark('sources');}}
    if(el.dataset.lfFactField){const fact=arr(sources.facts).find(f=>f.id===el.dataset.id);if(fact){if(el.dataset.lfFactField==='sourceId')fact.sourceRefs=el.value?[{sourceId:el.value,anchor:''}]:[];else fact[el.dataset.lfFactField]=el.value;if(el.dataset.lfFactField==='verification'){const summary=el.closest('details')?.querySelector('summary');if(summary)summary.textContent=`出处与适用范围 · ${VERIFICATION[el.value] || el.value}`;}mark('sources');}}
    if(el.dataset.lfAssetField){const asset=arr(sources.assets).find(a=>a.id===el.dataset.id);if(asset){asset[el.dataset.lfAssetField]=el.value;mark('sources');}}
    for(const key of ['channel','metric','value','note'])if(el.hasAttribute(`data-lf-feedback-${key}`)){feedbackForm[key]=el.value;paintStatus();}
    if(el.matches('[data-lf-article-ack],[data-lf-variant-ack]'))paintStatus();
  }
  function onChange(event) {
    const el=event.target;
    if(el.hasAttribute('data-lf-fact-dep')){
      const factId=el.dataset.lfFactDep,checked=el.checked;
      serial(async()=>{
        if(!checked){article.sourceDeps=arr(article.sourceDeps).filter(dep=>dep.factId!==factId);mark('article');refreshDependencies();return;}
        await saveSources();if(dirty.sources)throw new Error('先保存素材，再添加事实引用。');
        const fact=arr(p.sourceBundle?.facts).find(f=>f.id===factId);if(!fact?.fingerprint)throw new Error('这条事实尚未取得已保存版本，请先保存素材。');
        const existing=arr(article.sourceDeps).find(dep=>dep.factId===factId);
        if(existing && existing.fingerprint!==fact.fingerprint){refreshDependencies();throw new Error('这条已选事实已变化，请使用“核对后重新引用”。');}
        if(!existing)article.sourceDeps=arr(article.sourceDeps).concat({factId:fact.id,fingerprint:fact.fingerprint});mark('article');refreshDependencies();
      }).catch(()=>{});
    }
    if(el.dataset.lfChannel){const group=tab;const set=new Set(arr(channels[group]));el.checked?set.add(el.dataset.lfChannel):set.delete(el.dataset.lfChannel);channels[group]=[...set];mark('channels');}
    if(el.dataset.lfOption && options[tab])options[tab][el.dataset.lfOption]=el.value;
    if(el.dataset.lfFormat && options[tab])options[tab].formats[el.dataset.lfFormat]=el.value;
    if(el.hasAttribute('data-lf-variant-select')){
      const selected=el.value,old=variantChoice[tab];el.value=old || selected;
      serial(async()=>{await saveCurrentRaw();variantChoice[tab]=selected;root.querySelector('[data-lf-variant-editor]').innerHTML=variantEditor(tab);paintVariantPreview();paintStatus();}).catch(()=>{});
    }
    if(el.hasAttribute('data-lf-upload')){const files=[...el.files];serial(()=>uploadFiles(files)).catch(()=>{});}
    if(el.dataset.lfJsonFile){const file=el.files?.[0],kind=el.dataset.lfJsonFile;if(file)file.text().then(text=>{importText[kind]=text;const input=root.querySelector(`[data-lf-import="${kind}"]`);if(input)input.value=text;}).catch(()=>notice('读取 JSON 文件失败。','error'));}
  }
  function onClick(event) {const el=event.target.closest?.('[data-lf-action]');if(!el || !root.contains(el))return;event.preventDefault();serial(()=>action(el)).catch(()=>{});}
  function onBeforeUnload(event) {if(dirty.sources || dirty.article || dirty.channels || dirty.variants.size || dirty.feedback || feedbackDraftExists()){event.preventDefault();event.returnValue='';}}
  root.addEventListener('input',onInput);root.addEventListener('change',onChange);root.addEventListener('click',onClick);window.addEventListener('beforeunload',onBeforeUnload);window.addEventListener('resize',fitPreview);
  render();
  return {
    save,
    hasUnsaved:()=>Boolean(dirty.sources || dirty.article || dirty.channels || dirty.variants.size || dirty.feedback || feedbackDraftExists()),
    getProject:()=>clone(p),
    updateProject(next) {if(destroyed || !next || next.id!==p.id)return;p=clone(next);if(!dirty.sources)sources=clone(p.sourceBundle || sources);if(!dirty.article)article=clone(p.article || article);if(!dirty.channels)channels=clone(p.selectedChannels || channels);if(!dirty.feedback)feedback=clone(arr(p.feedback));for(const v of allVariants())if(!dirty.variants.has(v.id))variants.set(v.id,clone(v));refreshDependencies();paintStatus();updateDeliveryPanel();},
    destroy() {destroyed=true;previewResizeObserver?.disconnect();root.removeEventListener('input',onInput);root.removeEventListener('change',onChange);root.removeEventListener('click',onClick);window.removeEventListener('beforeunload',onBeforeUnload);window.removeEventListener('resize',fitPreview);root.remove();},
  };
}

export {CHANNELS as LONGFORM_CHANNELS};
