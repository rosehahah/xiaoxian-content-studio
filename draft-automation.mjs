import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {EgoPageAdapter} from './ego-adapter.mjs';
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
async function hasLoginState(page){
  // Require the creator page's visible upload/editor UI. A stale cookie alone
  // must not unlock a job. No session tokens are read or exported.
  if(await firstVisible(page,['input[placeholder*="标题"]','textarea[placeholder*="标题"]']))return true;
  return Boolean(await findUpload(page));
}
async function waitForLogin(page,config,onUpdate){
  const deadline=Date.now()+10*60*1000;let announced=false;
  while(Date.now()<deadline){
    await chooseImageMode(page,config.imageTabs);if(await hasLoginState(page))return;
    if(!announced){announced=true;await onUpdate('waiting_login','请在打开的 Ego Lite 中完成扫码登录；检测到图文创作入口后，工作台会解锁草稿填写。');}
    await wait(1800);
  }
  throw new Error('等待扫码登录超时，请重新检查登录状态');
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

export async function fillCreatorDraft({platform,title,body,tags,imageFiles,onUpdate,page}){
  if(!PLATFORM[platform])throw new Error('不支持的平台');
  if(process.env.STUDIO_DRAFT_DRIVER==='mock')return runMock({onUpdate});
  const config=PLATFORM[platform];await onUpdate('opening','正在打开'+config.name+'创作中心');
  await chooseImageMode(page,config.imageTabs);
  if(!await waitForEditor(page,async p=>await hasLoginState(p)?true:null,16))throw new Error('登录状态已失效，请先在工作台重新检查登录状态');
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

export async function runEgoCreatorTask(input,{taskSpace}){
  const config=PLATFORM[input.platform];if(!config)throw Error('不支持的平台');
  const task=await taskSpace('小苋 · '+config.name+(input.kind==='session'?'登录检查':'草稿填写'));
  const page=task.page('p1');let handedOff=false;
  const onUpdate=async(status,message)=>console.log(EVENT+JSON.stringify({status,message,browser:'ego-lite',spaceId:task.spaceId}));
  try{
    await onUpdate('opening','正在使用 Ego Lite 打开'+config.name+'创作中心');
    await page.goto(config.url);
    await page.snapshot();
    const adapted=new EgoPageAdapter(page);
    if(input.kind==='session'){
      await waitForLogin(adapted,config,onUpdate);
      await onUpdate('logged_in',config.name+'登录状态已确认，可以填写草稿。');
    }else await fillCreatorDraft({...input,page:adapted,onUpdate});
    // Leave the result for the user to verify or save. Never click publish.
    await task.finish({keep:['p1']});
  }catch(error){
    if(controlStopped(error))throw error;
    try{await task.handOff();handedOff=true;}catch{}
    throw Error(error.message+(handedOff?'；Ego Lite 页面已交给你检查。':''));
  }
}
export async function executeEgoTask(input,onUpdate){
  const source=`const {runEgoCreatorTask}=await import(${JSON.stringify(workerPath)});await runEgoCreatorTask(${JSON.stringify(input)},{taskSpace});`;
  return new Promise((resolve,reject)=>{
    const child=spawn('ego-browser',['nodejs','-e',source],{stdio:['ignore','pipe','pipe']});
    let pending='',errors='',updates=Promise.resolve(),lastStatus=null;
    child.stdout.on('data',chunk=>{
      pending+=chunk.toString();const lines=pending.split('\n');pending=lines.pop();
      for(const line of lines)if(line.startsWith(EVENT)){
        try{const event=JSON.parse(line.slice(EVENT.length));lastStatus=event.status;updates=updates.then(()=>onUpdate(event.status,event.message));}catch{errors+='Ego Lite 状态响应无法解析';}
      }
    });
    child.stderr.on('data',chunk=>{errors=(errors+chunk.toString()).slice(-6000);});
    child.on('error',()=>reject(Error(driverError)));
    child.on('close',async code=>{
      try{await updates;if(code!==0)throw Error(errors.trim()||driverError);if(!lastStatus)throw Error('Ego Lite 未返回执行状态，请检查浏览器连接。');resolve();}catch(error){reject(error);}
    });
  });
}
export async function runCreatorDraft({platform,title,body,tags,imageFiles,onUpdate}){
  if(!PLATFORM[platform])throw Error('不支持的平台');
  if(process.env.STUDIO_DRAFT_DRIVER==='mock')return runMock({onUpdate});
  return executeEgoTask({kind:'draft',platform,title,body,tags,imageFiles},onUpdate);
}
export async function prepareCreatorSession({platform,onUpdate}){
  if(!PLATFORM[platform])throw Error('不支持的平台');
  if(process.env.STUDIO_DRAFT_DRIVER==='mock'){await onUpdate('opening','模拟打开登录页');await onUpdate('waiting_login','模拟检查登录状态');await onUpdate('logged_in','模拟登录校验通过');return;}
  return executeEgoTask({kind:'session',platform},onUpdate);
}
export const draftAutomationAvailable=async()=>{
  if(process.env.STUDIO_DRAFT_DRIVER==='mock')return true;
  try{await run('ego-browser',['--version'],{timeout:5000});return true;}catch(error){rethrowControl(error);return false;}
};
