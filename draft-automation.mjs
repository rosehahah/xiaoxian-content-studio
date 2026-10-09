import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {StringDecoder} from 'node:string_decoder';
import {EgoPageAdapter} from './ego-adapter.mjs';
import {configureCreatorPermissions} from './creator-permissions.mjs';
import {appendXiaohongshuTopics,verifyXiaohongshuCopy} from './xiaohongshu-topics.mjs';

const run=promisify(execFile);
const workerPath=fileURLToPath(import.meta.url);
const EVENT='STUDIO_EGO_EVENT ';
const driverError='Ego Lite 不可用，请安装并连接 ego-browser；不会改用 Chrome。';
const PLATFORM={
  xiaohongshu:{name:'小红书',url:'https://creator.xiaohongshu.com/publish/publish?source=official',imageTabs:/上传图文|发布图文|图文发布/},
  douyin:{name:'抖音',url:'https://creator.douyin.com/creator-micro/content/upload',imageTabs:/发布图文|图文发布|发图文/},
};

const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const controlStopped=e=>/TaskSpace|ownership|inactive|unassigned|lost control|user.*control|用户接管/i.test(e?.message||'');
const rethrowControl=e=>{if(controlStopped(e))throw e;};
async function visible(locator){try{return await locator.first().isVisible();}catch(error){rethrowControl(error);return false;}}
async function firstVisible(page,selectors){for(const selector of selectors){const item=page.locator(selector).first();if(await visible(item))return item;}return null;}
async function fillEditable(locator,value){
  if(!locator)return false;
  const tag=await locator.evaluate(el=>el.tagName.toLowerCase());
  if(tag==='input'||tag==='textarea')await locator.fill(value);
  else{
    // Ego Lite dispatches native editing events; keep keyboard input for custom editors.
    try{await locator.fill(value);}
    catch(error){rethrowControl(error);await locator.click();await locator.press(process.platform==='darwin'?'Meta+A':'Control+A');await locator.press('Backspace');await locator.pressSequentially(value,{delay:4});}
  }
  return true;
}
async function editableText(locator){
  if(!locator)return '';
  try{const tag=await locator.evaluate(el=>el.tagName.toLowerCase());return (tag==='input'||tag==='textarea'?await locator.inputValue():await locator.innerText()).replace(/\u00a0/g,' ').trim();}catch(error){rethrowControl(error);return '';}
}
async function findBodyEditor(page){
  const direct=await firstVisible(page,[
    'textarea[placeholder*="正文"]','textarea[placeholder*="描述"]','textarea[placeholder*="介绍"]','textarea[placeholder*="分享"]',
    '[contenteditable="true"][data-placeholder*="正文"]','[contenteditable="true"][data-placeholder*="描述"]','[contenteditable="true"][data-placeholder*="分享"]','[contenteditable="true"][data-placeholder*="笔记"]',
    '[contenteditable="true"][placeholder*="正文"]','[contenteditable="true"][placeholder*="描述"]','[contenteditable="true"][placeholder*="分享"]','[contenteditable="true"][placeholder*="笔记"]',
    '[contenteditable="true"][aria-label*="正文"]','[contenteditable="true"][aria-label*="描述"]','[contenteditable="true"][aria-label*="分享"]',
    '.ql-editor[contenteditable="true"]','.ProseMirror[contenteditable="true"]','[role="textbox"][contenteditable="true"]'
  ]);
  if(direct)return direct;

  // 小红书会不定期更换编辑器类名和 placeholder。找不到明确字段时，
  // 从可见富文本区域中选择尺寸最大、最像正文编辑器的一个。
  const editors=page.locator('[contenteditable="true"]');let best=null,bestScore=-Infinity;
  for(let i=0;i<await editors.count();i++){
    const item=editors.nth(i);if(!await visible(item))continue;
    const score=await item.evaluate(el=>{
      const box=el.getBoundingClientRect(),meta=[el.getAttribute('placeholder'),el.getAttribute('data-placeholder'),el.getAttribute('aria-label'),el.className,el.getAttribute('role')].filter(Boolean).join(' ');
      let value=0;if(/正文|描述|介绍|分享|笔记|内容/i.test(meta))value+=120;if(/editor|content|desc|note|rich|ql-editor|prosemirror|textbox/i.test(meta))value+=45;
      if(box.width>300)value+=25;if(box.height>80)value+=35;if(box.height<35)value-=80;if(el.closest('button,nav,header,[role="dialog"]'))value-=120;if(/title|标题/i.test(meta))value-=100;
      return value+Math.min(box.width*box.height/10000,40);
    }).catch(error=>{rethrowControl(error);return -Infinity;});
    if(score>bestScore){best=item;bestScore=score;}
  }
  return bestScore>0?best:null;
}
async function waitForEditor(page,finder,attempts=24){
  for(let i=0;i<attempts;i++){const found=await finder(page);if(found)return found;await wait(500);}return null;
}
async function chooseImageMode(page,regex){
  const candidates=page.getByText(regex,{exact:false});
  for(let i=0;i<Math.min(await candidates.count(),6);i++){const item=candidates.nth(i);if(await visible(item)){try{await item.click({timeout:2500});await wait(700);return true;}catch(error){rethrowControl(error);}}}
  return false;
}
async function findUpload(page){
  const inputs=page.locator('input[type="file"]');
  for(let i=0;i<await inputs.count();i++){const item=inputs.nth(i),accept=(await item.getAttribute('accept')||'').toLowerCase();if(!accept||accept.includes('image')||accept.includes('.png')||accept.includes('.jpg'))return item;}
  return null;
}
export function classifyCreatorSession(evidence,platform){
  const host=PLATFORM[platform]?new URL(PLATFORM[platform].url).hostname:null;
  let url;try{url=new URL(evidence.url);}catch{}
  if(!host||url?.hostname!==host)return {status:'unknown',message:'尚未到达创作中心，请检查页面和网络。'};
  const text=evidence.text||'';
  if(evidence.challenge)return {status:'needs_attention',message:'页面要求安全验证，请在 Ego Lite 中完成验证后重新检查。'};
  if(evidence.loginForm||/扫码登录|扫描二维码登录|手机号登录|短信登录|账号密码登录/.test(text)||/\/(login|signin)(?:[/?]|$)/i.test(url.pathname))return {status:'waiting_login',message:'请在 Ego Lite 中完成登录，再点击“重新检查”。'};
  if(evidence.editor||evidence.uploadArea||evidence.creatorNavigation)return {status:'logged_in',message:'已识别到登录后的创作中心。'};
  return {status:'unknown',message:'页面仍在加载，或创作入口尚未识别；当前不能确认登录状态。'};
}
export async function inspectCreatorSession(page,platform){
  const evidence=await page.evaluate(()=>{
    const visible=n=>Boolean(n&&n.getClientRects().length&&getComputedStyle(n).visibility!=='hidden'&&getComputedStyle(n).display!=='none');
    const text=document.body?.innerText||'';
    const inputs=[...document.querySelectorAll('input,textarea')].filter(visible);
    const editor=inputs.some(n=>/标题/.test(n.placeholder||''));
    const loginForm=inputs.some(n=>n.type==='password'||/手机号|验证码/.test(n.placeholder||''));
    const challenge=[...document.querySelectorAll('[role="dialog"],iframe,[class*="captcha"],[id*="captcha"]')].filter(visible).some(n=>/captcha|verify|验证|滑块/i.test([n.id,n.className,n.title,n.getAttribute('src'),n.innerText].join(' ')))||/拖动滑块|完成安全验证|请完成验证|访问受限/.test(text);
    // A hidden input alone says nothing about login. Require the visible creator UI.
    const uploadArea=/拖拽.*(?:图片|视频)|点击上传|选择图片|上传图片/.test(text)&&[...document.querySelectorAll('input[type="file"]')].length>0;
    const creatorNavigation=/笔记管理|作品管理/.test(text)&&/发布笔记|发布作品|上传图文|发布图文/.test(text);
    return {url:location.href,text:text.slice(0,12000),editor,loginForm,challenge,uploadArea,creatorNavigation};
  });
  return classifyCreatorSession(evidence,platform);
}
async function hasLoginState(page,platform){return (await inspectCreatorSession(page,platform)).status==='logged_in';}
async function waitForLogin(page,platform,onUpdate){
  const deadline=Date.now()+30000;let previous='';
  while(Date.now()<deadline){
    const result=await inspectCreatorSession(page,platform);
    if(result.status!=='unknown')return result;
    if(previous!==result.message){previous=result.message;await onUpdate('checking',result.message);}
    await wait(1000);
  }
  return {status:'needs_attention',message:'页面加载后仍未识别到登录或创作入口，请在 Ego Lite 检查页面，再重新检查。'};
}
async function saveDraft(page){
  // 只匹配明确的草稿动作；任何包含“发布”的按钮都不会被点击。
  const safe=/^(存草稿|保存草稿|保存到草稿箱|暂存|暂存草稿|保存并退出)$/;
  const buttons=page.getByRole('button');
  for(let i=0;i<await buttons.count();i++){
    const button=buttons.nth(i);let text='';try{text=(await button.innerText()).trim();}catch(error){rethrowControl(error);}
    if(text.includes('发布'))continue;
    if(safe.test(text)&&await visible(button)&&await button.isEnabled()){await button.click();return true;}
  }
  return false;
}
async function runMock({onUpdate}){await onUpdate('opening','模拟打开创作中心');await onUpdate('uploading','模拟上传审核图卡');await onUpdate('filling','模拟填写配文');await onUpdate('draft','模拟草稿已保存');}

export async function fillCreatorDraft({platform,title,body,tags,imageFiles,onUpdate,page,sessionCheck=hasLoginState}){
  if(!PLATFORM[platform])throw new Error('不支持的平台');
  if(process.env.STUDIO_DRAFT_DRIVER==='mock')return runMock({onUpdate});
  const config=PLATFORM[platform];await onUpdate('opening','正在打开'+config.name+'创作中心');
  if(!await waitForEditor(page,async p=>await sessionCheck(p,platform)?true:null,16))throw new Error('登录状态已失效或页面需要验证，请先在工作台重新检查登录状态');
  await chooseImageMode(page,config.imageTabs);
  let upload=await findUpload(page);
  for(let i=0;!upload&&i<8;i++){await wait(500);await chooseImageMode(page,config.imageTabs);upload=await findUpload(page);}
  if(!upload)throw new Error('已登录，但没有识别到图文上传入口，请在浏览器中确认已进入图文发布页');
  await onUpdate('uploading','正在上传 '+imageFiles.length+' 张审核图卡');await upload.setInputFiles(imageFiles);await wait(2500);
  await onUpdate('filling','正在填写标题、正文和话题');
  const titleField=await waitForEditor(page,p=>firstVisible(p,['input[placeholder*="标题"]','textarea[placeholder*="标题"]','[contenteditable="true"][data-placeholder*="标题"]','[contenteditable="true"][aria-label*="标题"]']),20);
  const bodyField=await waitForEditor(page,findBodyEditor,24),tagText=tags.map(tag=>'#'+tag).join(' ');
  const titleDone=await fillEditable(titleField,title);
  let bodyDone=false;
  if(platform==='xiaohongshu'&&bodyField){
    bodyDone=await fillEditable(bodyField,body);
    try{await appendXiaohongshuTopics(page,bodyField,body,tags);}
    catch(error){rethrowControl(error);await onUpdate('needs_attention','正文或话题填写未完成：'+error.message+'。请在浏览器中核对；脚本不会继续保存。');return;}
  }else{
    const description=[body,tagText].filter(Boolean).join('\n\n');bodyDone=await fillEditable(bodyField,titleDone?description:[title,description].filter(Boolean).join('\n\n'));
  }
  if(!titleDone&&!bodyDone){await onUpdate('needs_attention','图片已上传，但页面字段结构暂未识别。请在浏览器中检查并手动粘贴配文。');return;}
  const written=await editableText(bodyField);
  if(platform==='xiaohongshu'){
    const check=verifyXiaohongshuCopy(written,body,tags);
    if(!bodyDone||!check.ok){await onUpdate('needs_attention','正文或话题未通过完整回读校验：'+(check.message||'正文未填写')+'。请在浏览器中核对；脚本不会继续保存。');return;}
  }else{
    const bodyProbe=String(body||'').replace(/\s+/g,' ').trim().slice(0,12),missingBody=body&&bodyProbe&&!written.replace(/\s+/g,' ').includes(bodyProbe),missingTags=tags.some(tag=>!written.includes(String(tag).replace(/^#+/,'')));
    if(!bodyDone||missingBody||missingTags){await onUpdate('needs_attention','图片和标题已填写，但正文或话题未能通过页面回读校验。请在浏览器中核对；脚本不会继续保存。');return;}
  }
  await onUpdate('ready_to_save','图片和配文已填好，正在寻找安全的“保存草稿”按钮');
  if(await saveDraft(page)){await wait(1800);await onUpdate('draft','已执行保存草稿；请在创作中心做最后核对。');}
  else await onUpdate('filled','内容已填好。页面未找到明确的保存草稿按钮，请在浏览器中核对后手动保存。');
}

export async function runEgoCreatorTask(input,{taskSpace,configurePermissions=configureCreatorPermissions,onEvent=event=>console.log(EVENT+JSON.stringify(event))}){
  const config=PLATFORM[input.platform];if(!config)throw Error('不支持的平台');
  const task=await taskSpace('小苋 · '+config.name+(input.kind==='session'?'登录检查':'草稿填写'));
  let handedOff=false,page;
  const onUpdate=async(status,message)=>onEvent({status,message,browser:'ego-lite',spaceId:task.spaceId});
  try{
    await onUpdate('opening','正在使用 Ego Lite 打开'+config.name+'创作中心');
    if(task.pages){
      const managed=await task.pages();page=managed.find(p=>p.label==='p1')||managed[0];
      if(!page){const active=(await task.tabs()).find(tab=>tab.active);page=active?await task.adopt(active.page):await task.newPage();}
    }else page=task.page('p1');
    await configurePermissions(page,input.platform);
    await page.goto(config.url);
    await page.snapshot();
    const adapted=new EgoPageAdapter(page);
    if(input.kind==='session'){
      const result=await waitForLogin(adapted,input.platform,onUpdate);
      await onUpdate(result.status,result.status==='logged_in'?config.name+'登录状态已确认，可以填写草稿。':result.message);
      if(result.status!=='logged_in'){await task.handOff();return;}
    }else await fillCreatorDraft({...input,page:adapted,onUpdate});
    // Leave the result for the user to verify or save. Never click publish.
    await task.finish({keep:[page.label||'p1']});
  }catch(error){
    if(controlStopped(error))throw error;
    try{await task.handOff();handedOff=true;}catch{}
    throw Error(error.message+(handedOff?'；Ego Lite 页面已交给你检查。':''));
  }
}
const statuses=new Set(['opening','checking','waiting_login','logged_in','uploading','filling','ready_to_save','draft','filled','needs_attention','error']);
const terminalStatuses=new Set(['waiting_login','logged_in','draft','filled','needs_attention']);
export function eventReader(receive){
  const decoder=new StringDecoder('utf8');let pending='';
  const line=value=>{if(!value.startsWith(EVENT))return;const event=JSON.parse(value.slice(EVENT.length));if(!statuses.has(event.status)||typeof event.message!=='string')throw Error('Ego Lite 状态响应格式错误');receive(event);};
  return {push(chunk){pending+=decoder.write(Buffer.from(chunk));const lines=pending.split('\n');pending=lines.pop();for(const value of lines)line(value.trimEnd());},end(){pending+=decoder.end();if(pending)line(pending.trimEnd());pending='';}};
}
export async function executeEgoTask(input,onUpdate){
  // Ego CLI may buffer console output for a whole browser round. A local journal
  // provides live progress and survives an empty/truncated console response.
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'studio-ego-')),journal=path.join(dir,'progress.jsonl');
  const source=`const fs=await import('node:fs/promises');const emit=async e=>await fs.appendFile(${JSON.stringify(journal)},JSON.stringify(e)+"\\n");try{const {runEgoCreatorTask}=await import(${JSON.stringify(workerPath)});await runEgoCreatorTask(${JSON.stringify(input)},{taskSpace:${input.spaceId?'async()=>await claimTaskSpace('+Number(input.spaceId)+')':'async name=>{const existing=(await listTaskSpaces()).find(s=>s.name===name);return existing&&existing.ownership!=="agent"?await claimTaskSpace(existing.id):await taskSpace(name);}'},onEvent:emit});await emit({complete:true});}catch(e){await emit({status:'error',message:e.message||'Ego Lite 执行失败'});throw e;}`;
  try{return await new Promise((resolve,reject)=>{
    const child=spawn('ego-browser',['nodejs','-e',source],{stdio:['ignore','pipe','pipe']});
    let errors='',updates=Promise.resolve(),lastStatus=null,offset=0,reading=false,journalUsed=false,complete=false,parseError=null,terminalEvent=null;
    const receive=event=>{lastStatus=event.status;if(terminalStatuses.has(event.status))terminalEvent=event;else updates=updates.then(()=>onUpdate(event.status,event.message,event));};
    const reader=eventReader(event=>{if(!journalUsed)receive(event);});
    const readProgress=async()=>{
      if(reading)return;reading=true;
      try{const data=await fs.readFile(journal,'utf8'),end=data.lastIndexOf('\n')+1;
        for(const line of data.slice(offset,end).split('\n').filter(Boolean)){const event=JSON.parse(line);journalUsed=true;if(event.complete){complete=true;continue;}if(!statuses.has(event.status)||typeof event.message!=='string')throw Error('Ego Lite 进度文件格式错误');receive(event);}offset=end;
      }catch(e){if(e.code!=='ENOENT')parseError=e;}finally{reading=false;}
    };
    const timer=setInterval(()=>{void readProgress();},250);
    child.stdout.on('data',chunk=>{try{reader.push(chunk);}catch(e){parseError=e;}});
    child.stderr.on('data',chunk=>{errors=(errors+chunk.toString()).slice(-6000);});
    child.on('error',()=>{clearInterval(timer);reject(Error(driverError));});
    child.on('close',async code=>{
      clearInterval(timer);while(reading)await wait(10);await readProgress();
      try{reader.end();await updates;if(parseError)throw parseError;if(lastStatus==='error')throw Error('浏览器执行未完成，请按进度提示检查页面。');if(code!==0)throw Error(errors.trim()||driverError);
        const allowed=input.kind==='session'?['logged_in','waiting_login','needs_attention']:['draft','filled','needs_attention'];
        if(!allowed.includes(lastStatus)||(journalUsed&&!complete))throw Error('浏览器任务未返回完整结果；登录状态尚未确认，请重新检查。');
        await onUpdate(terminalEvent.status,terminalEvent.message,terminalEvent);resolve();
      }catch(error){reject(error);}
    });
  });}finally{await fs.rm(dir,{recursive:true,force:true});}
}
export async function runCreatorDraft({platform,title,body,tags,imageFiles,onUpdate}){
  if(!PLATFORM[platform])throw Error('不支持的平台');
  if(process.env.STUDIO_DRAFT_DRIVER==='mock')return runMock({onUpdate});
  return executeEgoTask({kind:'draft',platform,title,body,tags,imageFiles},onUpdate);
}
export async function prepareCreatorSession({platform,onUpdate,spaceId}){
  if(!PLATFORM[platform])throw Error('不支持的平台');
  if(process.env.STUDIO_DRAFT_DRIVER==='mock'){await onUpdate('opening','模拟打开登录页');await onUpdate('waiting_login','模拟检查登录状态');await onUpdate('logged_in','模拟登录校验通过');return;}
  return executeEgoTask({kind:'session',platform,spaceId},onUpdate);
}
export const draftAutomationAvailable=async()=>{
  if(process.env.STUDIO_DRAFT_DRIVER==='mock')return true;
  try{await run('ego-browser',['--version'],{timeout:5000});return true;}catch(error){rethrowControl(error);return false;}
};
