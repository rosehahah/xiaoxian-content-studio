import {PLATFORMS} from './model.mjs';

export const OVERSEAS_LANGUAGES={en:'English',zh:'中文',bilingual:'中英双语'};

export function overseasCopyText(copy,key=''){
  return [key==='threads'?'':copy.title,copy.subtitle,copy.body,copy.tags?.map(tag=>'#'+tag).join(' ')].filter(Boolean).join('\n\n');
}

export function overseasCanDeliver(state,key,errors=[],copy){
  if(state.mode!=='local'||errors.length)return false;
  if(copy&&[copy.delivery,...(copy.history||[])].some(delivery=>delivery?.outcome==='unknown'&&!delivery.resolvedAt))return false;
  if(key==='substack')return Boolean(state.draftAutomation)&&Boolean(state.overseasConnections?.substack?.publicationUrl)&&state.platformSessions?.substack?.status==='logged_in';
  if(key==='x')return state.overseasConnections?.x?.status==='connected';
  return key==='threads';
}

export function overseasFields(p,key,{esc,field,icon}){
  const copy=p.platforms[key],isThreads=key==='threads',name=PLATFORMS[key].name;
  return `<div class="overseas-copy-intro"><span class="planning-kicker">ONE IDEA, MORE READERS</span><p>${isThreads?'把核心观点整理成 Threads 长文字附件。标题仅用于本机识别；这一版进入本机待发布队列。':'保留事实和个人口吻，按海外读者的背景重新组织成完整文章。'}</p></div>
  <div class="overseas-language"><label for="overseas-language">适配语言</label><select id="overseas-language" data-field="overseas-language">${Object.entries(OVERSEAS_LANGUAGES).map(([value,label])=>`<option value="${value}" ${(p.overseasLanguage||'en')===value?'selected':''}>${label}</option>`).join('')}</select></div>
  <div class="overseas-task-actions"><button class="btn secondary small" data-action="overseas-task">${icon('copy',14)} 复制海外适配任务</button><button class="btn text small" data-action="overseas-import">导入适配结果</button></div><p class="small muted overseas-task-note">把任务发给 Codex 生成平台原生文稿，再导入或在下方编辑。网页保存文稿与交付状态。</p>
  ${field(isThreads?'本机标题':'文章标题','platform-title',copy.title,isThreads?'仅作队列标签，不会拼入 Threads 正文':'清楚表达文章的收益；200 字符为本机保存上限')}
  ${key==='substack'?field('副标题（可选）','platform-subtitle',copy.subtitle||'','补充读者能获得什么，不重复标题'):''}
  <div class="longform-body">${field(isThreads?'长文字附件内容':'文章正文','platform-body',copy.body,isThreads?'最多 10,000 字符，另行配一段简短主帖后发布':'支持 Markdown 标题、列表、链接与图片链接；100,000 字符为本机保存上限',17)}</div>
  ${key==='x'?'<p class="small muted">X Article 用正文表达主题，不额外拼接话题。</p>':field(key==='substack'?'文章标签（可选）':'话题（可选）','platform-tags',copy.tags.join(' '),key==='substack'?'用空格分隔；最多 10 个是本机编辑上限':'最多 1 个话题')}
  <div class="tag-list" data-tag-list>${copy.tags.map(tag=>`<span class="topic-tag">#${esc(tag)}</span>`).join('')}</div>`;
}

export function overseasDeliveryView(p,key,state,check,{esc,icon,draftStatus}){
  const copy=p.platforms[key],delivery=copy.delivery,local=state.mode==='local',ready=overseasCanDeliver(state,key,check.errors,copy),connection=state.overseasConnections?.x||{status:'unconfigured'},session=state.platformSessions?.substack||{status:'unchecked'};
  let content='';
  if(key==='threads')content=`<div class="info-box"><b>本机待发布队列</b><p>保存本期 Threads 文稿和审核版本。此处不写入 Threads 的远程草稿箱；发布时可复制内容或下载文稿。</p></div><button class="btn primary" style="width:100%;margin-top:17px" data-action="overseas-draft" ${ready?'':'disabled'}>${icon('check',15)} ${delivery?.status==='queued_local'?'更新本机待发布稿':'保存到本机待发布队列'}</button>`;
  if(key==='substack')content=`<details class="overseas-publication" ${state.overseasConnections?.substack?.publicationUrl?'':'open'}><summary>Substack 出版物地址</summary><label for="substack-publication-url">你的 Substack 地址</label><input id="substack-publication-url" data-substack-url type="url" placeholder="https://your-name.substack.com" value="${esc(state.overseasConnections?.substack?.publicationUrl||'')}"><p class="small muted">先填写刊物地址，避免写入其他出版物。</p><button class="btn secondary small" data-action="substack-config" ${local?'':'disabled'}>保存地址</button></details><div class="session-check"><div><b>Substack 登录准备</b><p>先检查 Ego Lite 的登录状态，再打开文章编辑器。</p></div><span data-session-status class="badge ${session.status==='logged_in'?'':'grey'}">${draftStatus(session)}</span></div><button class="btn secondary" style="width:100%;margin-bottom:12px" data-action="platform-login" ${local&&state.draftAutomation?'':'disabled'}>${session.status==='logged_in'?'重新检查登录状态':'检查 / 登录 Substack'}</button><p class="delivery-note" data-session-message>${esc(session.message||'')}</p><button class="btn primary" style="width:100%" data-action="overseas-draft" ${ready?'':'disabled'}>${icon('upload',15)} 填写 Substack 草稿</button><p class="small muted overseas-boundary">浏览器填写文章并等待自动保存。登录、验证或编辑器无法识别时由你接管。</p>`;
  if(key==='x')content=`<div class="session-check"><div><b>X Articles 接口</b><p>检查本机凭证和账号连接；Articles 权限仍由 X 决定。</p></div><span data-x-status class="badge ${connection.status==='connected'?'':'grey'}">${({connected:'账号已连接',unchecked:'待检查',unavailable:'暂不可用',unconfigured:'未配置'})[connection.status]||'待检查'}</span></div><button class="btn secondary" style="width:100%;margin-bottom:12px" data-action="x-check" ${local?'':'disabled'}>检查 X 连接</button><p class="delivery-note" data-x-message>${esc(connection.message||'在本机配置 X OAuth 凭证后检查连接。凭证不会显示在网页中。')}</p><button class="btn primary" style="width:100%" data-action="overseas-draft" ${ready?'':'disabled'}>${icon('upload',15)} 创建 X Article 草稿</button><p class="small muted overseas-boundary">仅调用草稿接口。接口返回草稿编号后记录为已接受，正文效果请在 X 手动核对。</p>`;
  if(!local)content=`<div class="info-box warning">请启动本机工作台以连接账号或保存待发布队列。当前文稿可复制或下载。</div>`;
  const url=typeof delivery?.url==='string'&&/^https:\/\//.test(delivery.url)?delivery.url:'';
  const unresolved=[delivery,...(copy.history||[])].some(item=>item?.outcome==='unknown'&&!item.resolvedAt);
  return `${content}${unresolved?'<div class="info-box warning" style="margin-top:16px">上次草稿创建结果未知。请先打开平台核对，确认已保存后记录手动填入，再继续创建。</div>':''}${delivery?.message?`<div class="overseas-delivery-result"><b>${key==='x'&&delivery.status==='draft'?'接口已接受草稿':draftStatus(delivery)}</b><p>${esc(delivery.message)}</p>${delivery.draftId?`<p class="small muted">草稿编号：${esc(delivery.draftId)}</p>`:''}${url?`<a class="btn secondary small" href="${esc(url)}" target="_blank" rel="noopener">打开草稿 ${icon('external',13)}</a>`:''}</div>`:''}${key!=='threads'?`<div class="overseas-manual"><a href="${key==='substack'?'https://substack.com/home':'https://x.com/compose/articles'}" target="_blank" rel="noopener">打开 ${PLATFORMS[key].name} ${icon('external',12)}</a><button class="btn text small" data-action="manual-draft" ${check.errors.length?'disabled':''}>记录已手动填入</button></div>`:''}<p class="small muted overseas-boundary">教程图卡是内容依据，本版海外长文交付不自动附加图卡。最终发布由你完成。</p>`;
}
