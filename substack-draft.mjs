import {randomUUID} from 'node:crypto';
import {markdownToDraftJS} from './overseas-publishing.mjs';

const normalize=value=>String(value||'').replace(/[\u00a0\u200b\u200c\u200d\ufeff]/g,' ').replace(/\s+/g,' ').trim();
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const substackURL=value=>{try{const u=new URL(value);return u.protocol==='https:'&&(u.hostname==='substack.com'||u.hostname.endsWith('.substack.com'))?u:null;}catch{return null;}};
const safeURL=value=>{try{const u=new URL(value);return ['https:','http:','mailto:'].includes(u.protocol)?u.href:null;}catch{return null;}};
const stopped=error=>/TaskSpace|ownership|inactive|unassigned|lost control|user.*control|用户接管/i.test(error?.message||'');

function renderedBody(markdown){
  const tokenPrefix='\ue000'+randomUUID()+':',tokens=[],links=new Set(),images=[];
  const token=entry=>{tokens.push(entry);return tokenPrefix+(tokens.length-1)+'\ue001';};
  let fence=null;
  const prepared=markdown.replace(/\r\n?/g,'\n').split('\n').map(line=>{
    const match=line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if(match){if(!fence)fence=match[1][0];else if(match[1][0]===fence)fence=null;return line;}
    if(fence)return line;
    return line.replace(/(`+)([^`]*?)\1/g,(_,mark,code)=>token({html:'<code>'+escape(code)+'</code>',text:code}))
      .replace(/!\[([^\]]*)\]\((https?:\/\/[^\s]+?)(?:\s+["'][^"']*["'])?\)/g,(original,alt,target)=>{
        const url=safeURL(target);if(!url)return original;images.push({alt,url});return token({html:'<img src="'+escape(url)+'" alt="'+escape(alt)+'">',text:''});
      });
  }).join('\n');
  const tokenPattern=new RegExp(tokenPrefix.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(\\d+)\ue001','g');
  const expandedText=value=>value.replace(tokenPattern,(_,i)=>tokens[Number(i)]?.text||'');
  const expandedHTML=value=>{
    let result='',offset=0;for(const match of value.matchAll(tokenPattern)){result+=escape(value.slice(offset,match.index))+(tokens[Number(match[1])]?.html||'');offset=match.index+match[0].length;}return result+escape(value.slice(offset));
  };
  const state=markdownToDraftJS(prepared),parts=[],plain=[];
  const rich=block=>{
    const boundaries=new Set([0,block.text.length]);
    for(const range of [...block.inline_style_ranges,...block.entity_ranges]){boundaries.add(range.offset);boundaries.add(range.offset+range.length);}
    const points=[...boundaries].sort((a,b)=>a-b);let html='';
    for(let i=0;i<points.length-1;i++){
      const from=points[i],to=points[i+1];let segment=expandedHTML(block.text.slice(from,to));
      for(const range of block.inline_style_ranges.filter(r=>r.offset<=from&&r.offset+r.length>=to)){
        const tag={bold:'strong',italic:'em',strikethrough:'s'}[range.style];if(tag)segment='<'+tag+'>'+segment+'</'+tag+'>';
      }
      const range=block.entity_ranges.find(r=>r.offset<=from&&r.offset+r.length>=to),entity=range?state.entities[range.key]?.value:null,url=entity?.type==='link'?safeURL(entity.data.url):null;
      if(url){links.add(url);segment='<a href="'+escape(url)+'">'+segment+'</a>';}
      html+=segment;
    }
    return html.replace(/\n/g,'<br>');
  };
  let list=null;
  const closeList=()=>{if(list){parts.push('</'+list+'>');list=null;}};
  for(const block of state.blocks){
    if(block.type==='atomic'){
      closeList();const entity=state.entities[block.entity_ranges[0]?.key]?.value;
      if(entity?.type==='divider'){parts.push('<hr>');continue;}
      const source=entity?.data?.markdown||block.text,lines=source.split('\n');
      if(/^\s{0,3}(`{3,}|~{3,})/.test(lines[0])){
        const code=lines.slice(1,-1).join('\n');parts.push('<pre><code>'+escape(code)+'</code></pre>');plain.push(code);continue;
      }
      if(lines.length>1&&lines[0].includes('|')){
        const rows=lines.filter((_,i)=>i!==1).map(line=>line.trim().replace(/^\||\|$/g,'').split('|').map(cell=>cell.trim()));
        parts.push('<table>');rows.forEach((row,i)=>{parts.push('<tr>'+row.map(cell=>'<'+(i?'td':'th')+'>'+expandedHTML(cell)+'</'+(i?'td':'th')+'>').join('')+'</tr>');plain.push(row.map(expandedText).join(' '));});parts.push('</table>');continue;
      }
      parts.push('<p>'+expandedHTML(source).replace(/\n/g,'<br>')+'</p>');plain.push(expandedText(source));continue;
    }
    const nextList=block.type==='unordered-list-item'?'ul':block.type==='ordered-list-item'?'ol':null;
    if(nextList!==list){closeList();if(nextList){parts.push('<'+nextList+'>');list=nextList;}}
    const tag=nextList?'li':({'header-one':'h1','header-two':'h2','header-three':'h3',blockquote:'blockquote'}[block.type]||'p');
    parts.push('<'+tag+'>'+rich(block)+'</'+tag+'>');plain.push(expandedText(block.text));
  }
  closeList();return {html:parts.join('\n'),text:plain.join('\n'),links:[...links],images};
}
export function markdownToSubstackHTML(markdown){return renderedBody(markdown).html;}

// This callback is self-contained because Ego serializes it into the Page.
function readSubstackDOM(){
  const visible=node=>Boolean(node&&node.getClientRects().length&&getComputedStyle(node).display!=='none'&&getComputedStyle(node).visibility!=='hidden');
  const path=node=>{const parts=[];while(node&&node.nodeType===1){const tag=node.tagName.toLowerCase();let index=1;for(let sibling=node.previousElementSibling;sibling;sibling=sibling.previousElementSibling)if(sibling.tagName===node.tagName)index++;parts.unshift(tag+':nth-of-type('+index+')');if(tag==='body')break;node=node.parentElement;}return parts.join(' > ');};
  const value=node=>node?('value' in node?node.value:node.innerText||''):'';
  const inputs=[...document.querySelectorAll('input,textarea,[contenteditable="true"]')].filter(visible);
  const meta=node=>[node.getAttribute('placeholder'),node.getAttribute('data-placeholder'),node.getAttribute('aria-label'),node.getAttribute('name')].filter(Boolean).join(' ');
  const one=nodes=>nodes.length===1?nodes[0]:null;
  const titles=inputs.filter(n=>['placeholder','data-placeholder','aria-label','name'].some(key=>/^(?:title|post title|标题)$/i.test((n.getAttribute(key)||'').trim())||/^(?:add|write|enter)(?: a| your| the)? title(?:…|\.\.\.)?$/i.test((n.getAttribute(key)||'').trim())));
  const title=one(titles),subtitle=one(inputs.filter(n=>/subtitle|sub-title|副标题/i.test(meta(n))));
  const body=one([...document.querySelectorAll('.tiptap[contenteditable="true"],.ProseMirror[contenteditable="true"]')].filter(visible).filter(n=>n!==title&&n!==subtitle));
  const actions=[...document.querySelectorAll('button,a,[role="button"],[role="menuitem"]')].filter(visible).map(n=>({selector:path(n),text:(n.innerText||n.getAttribute('aria-label')||'').trim(),href:n.getAttribute('href')||'',disabled:Boolean(n.disabled||n.getAttribute('aria-disabled')==='true')}));
  const pageText=(document.body?.innerText||'').slice(0,15000);
  const challenge=[...document.querySelectorAll('[class*="captcha"],[id*="captcha"],iframe,[role="dialog"]')].filter(visible).some(n=>/captcha|verification|security check|验证|滑块/i.test([n.id,n.className,n.title,n.getAttribute('src'),n.innerText].join(' ')))||/verify you are human|complete the security check|请完成验证/i.test(pageText);
  const loginForm=inputs.some(n=>n.type==='password')||(inputs.some(n=>n.type==='email')&&actions.some(a=>/^(sign in|log in|continue with email|continue)$/i.test(a.text)));
  const editor=Boolean(title&&body),dashboard=/\/(?:publish|dashboard)(?:\/|$)/.test(location.pathname)&&/drafts|posts|stats|subscribers|草稿|文章|订阅者/i.test(pageText)&&actions.some(a=>/^(create|create post|new post|write|write a post|新建|新建文章|创作)$/i.test(a.text));
  const saves=[...document.querySelectorAll('[role="status"],span,small,div')].filter(n=>visible(n)&&!body?.contains(n)&&n!==body&&!n.children.length).map(n=>(n.innerText||'').trim());
  const saved=saves.some(text=>/^(?:all changes saved|saved(?: just now| at .+| \d+ \w+ ago)?|已保存|所有更改已保存)[.!。]?$/i.test(text));
  const tagInput=one(inputs.filter(n=>n.tagName!=='DIV'&&/^(?:add tags?|tags?|添加标签|标签)(?:…|\.\.\.)?$/i.test(meta(n).trim())));
  const tags=[...document.querySelectorAll('[data-tag-name],[data-testid="tag-chip"],[class*="tag-chip"]')].filter(visible).map(n=>n.getAttribute('data-tag-name')||(n.innerText||'').replace(/\s*[×✕]\s*$/,'').trim()).filter(Boolean);
  const field=node=>node?{selector:path(node),text:value(node),disabled:Boolean(node.disabled||node.getAttribute('aria-disabled')==='true'||node.readOnly)}:null;
  return {url:location.href,text:pageText,challenge,loginForm,editor,dashboard,actions,saved,title:field(title),subtitle:field(subtitle),body:body?{...field(body),links:[...body.querySelectorAll('a[href]')].map(a=>a.href),images:[...body.querySelectorAll('img')].map(img=>({src:img.src,alt:img.alt||''}))}:null,tagInput:field(tagInput),tags};
}
export function classifySubstackSession(evidence){
  const url=substackURL(evidence?.url);if(!url)return {status:'unknown',message:'尚未到达 Substack 创作中心。'};
  if(evidence.challenge)return {status:'needs_attention',message:'Substack 要求安全验证，请在 Ego Lite 完成验证后重新检查。'};
  if(evidence.loginForm||/\/(?:sign-in|signin|login)(?:\/|$)/i.test(url.pathname))return {status:'waiting_login',message:'请在 Ego Lite 登录 Substack，再重新检查。'};
  if(evidence.editor||evidence.dashboard)return {status:'logged_in',message:'已识别 Substack 文章编辑器或创作者后台。'};
  return {status:'unknown',message:'当前页面无法确认 Substack 创作者登录状态。'};
}
export async function inspectSubstackSession(page){return classifySubstackSession(await page.evaluate(readSubstackDOM));}

export function verifySubstackContent(evidence,{title,subtitle='',body,tags=[]},{checkTags=true}={}){
  const expected=renderedBody(body),reasons=[];
  if(normalize(evidence.title?.text)!==normalize(title))reasons.push('标题不完整');
  if(normalize(evidence.subtitle?.text)!==normalize(subtitle))reasons.push('副标题不完整');
  if(normalize(evidence.body?.text)!==normalize(expected.text))reasons.push('正文不完整');
  const actualLinks=new Set((evidence.body?.links||[]).map(safeURL).filter(Boolean));
  if(expected.links.some(url=>!actualLinks.has(url))||[...actualLinks].some(url=>!expected.links.includes(url)))reasons.push('正文链接未完整保留');
  const actualImages=evidence.body?.images||[];
  if(actualImages.length!==expected.images.length||expected.images.some((img,i)=>normalize(img.alt)!==normalize(actualImages[i]?.alt)))reasons.push('正文图片未完整保留');
  if(checkTags){const selected=new Set((evidence.tags||[]).map(normalize)),requested=new Set(tags.map(normalize));if(selected.size!==requested.size||[...requested].some(tag=>!selected.has(tag)))reasons.push('分类标签需手动补充或核对');}
  return {ok:reasons.length===0,message:reasons.join('；')};
}

function validateInput({title,subtitle,body,tags,publicationUrl}){
  if(typeof title!=='string'||!title.trim()||Array.from(title).length>200)throw Error('Substack 标题不能为空，且不得超过本机 200 字符资源上限。');
  if(typeof subtitle!=='string'||subtitle.length>500)throw Error('Substack 副标题超过本机资源上限。');
  if(typeof body!=='string'||!body.trim()||body.length>100000)throw Error('Substack 正文不能为空，且不得超过本机 100000 字符资源上限。');
  if(!Array.isArray(tags)||tags.length>20||tags.some(t=>typeof t!=='string'||!t.trim()||t.length>100))throw Error('Substack 标签格式错误。');
  if(publicationUrl&&!substackURL(publicationUrl))throw Error('Substack 站点必须使用 HTTPS 的 substack.com 地址。');
}
function rightPublication(evidence,publicationUrl){return !publicationUrl||new URL(publicationUrl).hostname==='substack.com'||substackURL(evidence.url)?.hostname===new URL(publicationUrl).hostname;}
function safeCreation(evidence,names){
  const matches=(evidence.actions||[]).filter(a=>!a.disabled&&names.test(a.text)&&!/(?:continue|publish|schedule|send|next|发布|发送|下一步)/i.test(a.text));
  return matches.length===1?matches[0]:null;
}
async function awaitEditorOrMenu(page){
  await page.waitForFunction(()=>Boolean(document.querySelector('.tiptap[contenteditable="true"],.ProseMirror[contenteditable="true"]'))||[...document.querySelectorAll('button,a,[role="menuitem"]')].some(n=>n.getClientRects().length&&/^(?:article|text post|文章)$/i.test((n.innerText||'').trim())),undefined,{timeout:10000});
}
async function savedEvidence(page){
  await page.waitForFunction(()=>{
    const editor=document.querySelector('.tiptap[contenteditable="true"],.ProseMirror[contenteditable="true"]');
    return [...document.querySelectorAll('[role="status"],span,small,div')].some(n=>n.getClientRects().length&&!n.children.length&&!editor?.contains(n)&&/^(?:all changes saved|saved(?: just now| at .+| \d+ \w+ ago)?|已保存|所有更改已保存)[.!。]?$/i.test((n.innerText||'').trim()));
  },undefined,{timeout:15000});
  return page.evaluate(readSubstackDOM);
}

export async function fillSubstackDraft({page,title,subtitle='',body,tags=[],onUpdate=async()=>{},publicationUrl}={}){
  validateInput({title,subtitle,body,tags,publicationUrl});
  const input={title,subtitle,body,tags},rendered=renderedBody(body);
  let mutationPossible=false;
  const finish=async(status,message,evidence)=>{const url=substackURL(evidence?.url);const result={status,message,outcome:status==='draft'?'created':mutationPossible?'unknown':'not-created',...(url?{draftUrl:url.origin+url.pathname}:{})};await onUpdate(status,message,{draftUrl:result.draftUrl,outcome:result.outcome});return result;};
  await page.snapshot();let evidence=await page.evaluate(readSubstackDOM),session=classifySubstackSession(evidence);
  if(session.status!=='logged_in')return finish('needs_attention',session.message,evidence);
  if(!rightPublication(evidence,publicationUrl))return finish('needs_attention','当前 Substack 站点与本期配置不一致，请核对后再填写。',evidence);
  if(!evidence.editor){
    const create=safeCreation(evidence,/^(?:create|create post|new post|write|write a post|新建|新建文章|创作)$/i);
    if(!create)return finish('needs_attention','已登录，但没有识别到安全的新建文章入口，请手动打开一个空白文章草稿。',evidence);
    await onUpdate('opening','正在打开 Substack 空白文章编辑器');mutationPossible=true;await page.click(create.selector);await awaitEditorOrMenu(page);await page.snapshot();evidence=await page.evaluate(readSubstackDOM);
    if(!evidence.editor){
      const article=safeCreation(evidence,/^(?:article|text post|文章)$/i);
      if(!article)return finish('needs_attention','没有识别到 Article / Text post 入口，请手动打开空白文章草稿。',evidence);
      await page.click(article.selector);await page.waitForSelector('.tiptap[contenteditable="true"],.ProseMirror[contenteditable="true"]',{state:'visible',timeout:10000});await page.snapshot();evidence=await page.evaluate(readSubstackDOM);
    }
  }
  session=classifySubstackSession(evidence);
  if(session.status!=='logged_in'||!evidence.editor)return finish('needs_attention',session.status==='logged_in'?'尚未识别到文章编辑器，请手动打开空白文章草稿。':session.message,evidence);
  if(!rightPublication(evidence,publicationUrl))return finish('needs_attention','文章编辑器所属站点与配置不一致，请手动核对。',evidence);
  if(evidence.title.disabled||evidence.body.disabled||evidence.subtitle?.disabled)return finish('needs_attention','Substack 编辑器当前不可编辑，请手动检查。',evidence);
  if(subtitle&&!evidence.subtitle)return finish('needs_attention','未识别到副标题输入框，请在 Substack 中核对页面。',evidence);
  const hasBody=e=>Boolean(normalize(e.body?.text)||e.body?.images?.length||e.body?.links?.length);
  const nonempty=normalize(evidence.title.text)||normalize(evidence.subtitle?.text)||hasBody(evidence);
  if(nonempty){
    const titleConflict=normalize(evidence.title.text)&&normalize(evidence.title.text)!==normalize(title),subtitleConflict=normalize(evidence.subtitle?.text)&&normalize(evidence.subtitle.text)!==normalize(subtitle),bodyConflict=hasBody(evidence)&&!verifySubstackContent({...evidence,title:{text:title},subtitle:{text:subtitle}},input,{checkTags:false}).ok;
    if(titleConflict||subtitleConflict||bodyConflict)return finish('needs_attention','当前编辑器已有其他内容；为避免覆盖，请手动打开一个空白文章草稿。',evidence);
  }
  await onUpdate('filling','正在填写 Substack 标题、副标题和完整富文本正文');
  if(!normalize(evidence.title.text)){mutationPossible=true;await page.fill(evidence.title.selector,title);}
  if(subtitle&&!normalize(evidence.subtitle.text)){mutationPossible=true;await page.fill(evidence.subtitle.selector,subtitle);}
  // Recheck both session and body immediately before clipboard mutation.
  evidence=await page.evaluate(readSubstackDOM);session=classifySubstackSession(evidence);
  if(session.status!=='logged_in'||!evidence.editor)return finish('needs_attention',session.message,evidence);
  if(!hasBody(evidence)){
    mutationPossible=true;await page.focus(evidence.body.selector);await page.keyboard.paste({text:rendered.text,html:rendered.html});
  }else if(!verifySubstackContent({...evidence,title:{text:title},subtitle:{text:subtitle}},input,{checkTags:false}).ok)return finish('needs_attention','正文在填写期间发生变化，请手动核对；未覆盖已有正文。',evidence);
  evidence=await page.evaluate(readSubstackDOM);let checked=verifySubstackContent(evidence,input,{checkTags:false});
  if(!checked.ok)return finish('needs_attention','Substack 填写后的完整回读未通过：'+checked.message+'。请手动核对。',evidence);
  if(tags.length&&evidence.tagInput&&!evidence.tagInput.disabled){
    for(const tag of tags){if(!(evidence.tags||[]).map(normalize).includes(normalize(tag))){mutationPossible=true;await page.fill(evidence.tagInput.selector,tag);await page.press(evidence.tagInput.selector,'Enter');evidence=await page.evaluate(readSubstackDOM);}}
  }
  await onUpdate('ready_to_save','完整内容已填写，正在等待 Substack 自动保存');
  try{evidence=await savedEvidence(page);}catch(error){if(stopped(error))throw error;return finish('filled','内容已填好，但没有识别到明确的已保存状态；请在 Substack 手动核对和保存。',evidence);}
  if(!evidence.saved)return finish('filled','内容已填好，但自动保存尚未得到确认，请手动核对。',evidence);
  await page.reload();await page.snapshot();
  try{await page.waitForSelector('.tiptap[contenteditable="true"],.ProseMirror[contenteditable="true"]',{state:'visible',timeout:10000});}catch(error){if(stopped(error))throw error;return finish('needs_attention','自动保存后重新加载未恢复编辑器，请在 Substack 核对草稿。',evidence);}
  evidence=await page.evaluate(readSubstackDOM);checked=verifySubstackContent(evidence,input);
  if(classifySubstackSession(evidence).status!=='logged_in'||!evidence.editor||!rightPublication(evidence,publicationUrl))return finish('needs_attention','重新加载后无法确认 Substack 草稿，请手动核对。',evidence);
  if(!checked.ok){
    const content=verifySubstackContent(evidence,input,{checkTags:false});
    return finish(content.ok?'filled':'needs_attention',content.ok?'正文已自动保存并通过重载回读；分类标签需手动补充或核对。':'重新加载后的完整回读未通过：'+checked.message+'。请手动核对草稿。',evidence);
  }
  return finish('draft','Substack 草稿已自动保存，并通过重载后的标题、副标题、全文、链接和图片回读；最终发布由你完成。',evidence);
}
