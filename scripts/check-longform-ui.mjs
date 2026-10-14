import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawn,execFileSync} from 'node:child_process';
import JSZip from 'jszip';
import {checkCardsUI} from './check-cards-ui.mjs';
const root=fileURLToPath(new URL('..',import.meta.url));
const port=14437,origin='http://localhost:'+port;
const field=name=>'[data-lf-field="'+name+'"]';
const action=(name,extra='')=>'[data-lf-action="'+name+'"]'+extra;

// The preview is sandboxed. Read its real document through an isolated CDP world;
// use native Ego pointer/keyboard actions for interaction rather than DOM clicks.
async function readPreviewDocument(page){
  const response=await page.cdp('Page.getFrameTree'),frames=[];
  const collect=tree=>{if(!tree)return;frames.push(tree.frame);for(const child of tree.childFrames||[])collect(child);};
  collect(response.frameTree||response.result?.frameTree);
  const previews=frames.filter(frame=>frame?.url==='about:srcdoc');
  assert.equal(previews.length,1,'长文验收应定位到唯一的安全预览iframe');
  const world=await page.cdp('Page.createIsolatedWorld',{frameId:previews[0].id,worldName:'xiaoxian-longform-mobile-readonly'});
  const contextId=world.executionContextId||world.result?.executionContextId;assert.ok(contextId,'预览只读检查需要有效执行上下文');
  const result=await page.cdp('Runtime.evaluate',{contextId,returnByValue:true,awaitPromise:true,expression:`(async()=>{
    if(document.readyState==='loading')await new Promise(resolve=>document.addEventListener('DOMContentLoaded',resolve,{once:true}));
    if(document.fonts)await document.fonts.ready;
    const tail=[...document.querySelectorAll('p,li,blockquote,figcaption')].find(node=>node.textContent.trim()==='末尾检查点：全文完整保留。');
    const rect=tail?.getBoundingClientRect(),style=tail?getComputedStyle(tail):null;
    return {width:innerWidth,height:innerHeight,pageWidth:document.documentElement.scrollWidth,scrollTop:document.scrollingElement?.scrollTop,scrollHeight:document.scrollingElement?.scrollHeight,tail:tail?{text:tail.textContent,rect:rect.toJSON(),visible:rect.width>0&&rect.height>0&&rect.top>=-1&&rect.bottom<=innerHeight+1&&style.visibility!=='hidden'&&style.display!=='none'}:null};
  })()`});
  assert.ok(!result.exceptionDetails,JSON.stringify(result.exceptionDetails));
  const value=result.result?.value||result.value;assert.ok(value?.tail,'实际预览文档应保留末尾检查点');return value;
}

export async function checkLongformUI(task,output,source={}){
  const packageSha=source.packageSha||process.env.STUDIO_PACKAGE_SHA;
  const page=task.page('p1');await fs.mkdir(output,{recursive:true});
  const run={runId:Date.now().toString(36),sha:packageSha||execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),sourceKind:packageSha?'release_archive':'git_checkout',workingTreeDirty:packageSha?null:Boolean(execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}).trim()),startedAt:new Date().toISOString(),status:'running'};await fs.writeFile(path.join(output,'results.json'),JSON.stringify(run,null,2));
  const results=[];const passed=name=>{results.push(name);console.log('PASS '+name);};
  const tab=async name=>{await page.click(action('tab','[data-tab="'+name+'"]'));await page.waitForSelector(action('tab','[data-tab="'+name+'"][aria-current="step"]'));};
  const save=async()=>{await page.click('.lf-savebar '+action('save'));await page.waitForFunction(()=>document.querySelector('[data-lf-save-state]')?.textContent==='已保存在本机');};
  const get=async()=>{const id=new URL(await page.url()).searchParams.get('project');return (await (await fetch(origin+'/api/projects/'+id)).json()).project;};
  await page.cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:1050,deviceScaleFactor:1,mobile:false});
  await page.goto(origin);await page.waitForSelector('[data-action="new"]');
  await fs.writeFile(path.join(output,'initial-snapshot.txt'),await page.snapshot());
  await page.click('[data-action="new"] >> nth=0');await page.fill('#new-topic','合成验收：材料到长文');await page.selectOption('#new-kind','article');await page.click('#create-project');await page.waitForSelector('[data-lf-source-note]');
  assert.equal((await get()).content.cards.length,0);
  await page.fill('[data-lf-source-note]','这是一份合成验收材料，不是真实用户经历。先保存来源，再核对成品。');
  await page.click(action('add-fact'));await page.fill('[data-lf-fact-field="statement"]','合成验收事实：本页可保存资料。');
  await page.click('.lf-fact details summary');await page.selectOption('[data-lf-fact-field="verification"]','user_reported');await save();
  const gif=Buffer.from('47494638396101000100800000f2eadd36564021ff0b4e45545343415045322e30030100000021f904002d0000002c000000000100010000020244010021f904002d0000002c00000000010001000002024c01003b','hex');
  const gifPath=path.join(output,'synthetic-ui.gif');await fs.writeFile(gifPath,gif);await page.setInputFiles('[data-lf-upload]',[gifPath]);await page.waitForSelector('.lf-asset');
  let p=await get();const asset=p.sourceBundle.assets[0];assert.equal(asset.mimeType,'image/gif');passed('无图卡新建长文、保存材料事实与GIF');
  await tab('article');await page.click('.lf-dependencies summary');await page.click('[data-lf-fact-dep]');
  const body='# 先保留一个可检查的结果\n\n这是合成测试，不代表真实使用效果。\n\n## 操作步骤\n\n1. 保存资料。\n2. 核对结果。\n\n> 结果应当能重新打开。\n\n```js\nconst syntheticLongLine = "'+ 'local_only_'.repeat(30)+'";\n```\n\n| 输入 | 成品 |\n| --- | --- |\n| 原始材料 | 可检查文稿 |\n\n![合成 [操作]](asset:'+asset.id+')\n\n`![引用语法](asset:example)`\n\n```md\n![引用语法](asset:example)\n```\n\n\\![转义引用](asset:example)\n\n末尾检查点：全文完整保留。';
  await page.fill(field('article-bodyMd'),body);await save();
  await page.click(action('article-preview'));await page.waitForSelector('[data-lf-article-frame]');
  assert.equal(await page.evaluate(()=>document.querySelector('[data-lf-action="article-approve"]').disabled),true);
  await page.click('[data-lf-article-ack]');await page.click(action('article-approve'));await page.waitForFunction(()=>document.querySelector('[data-lf-article-badge]')?.textContent==='本版长文已审核');
  p=await get();assert.equal(p.runtime.articleApproved,true);assert.equal(p.cardApproval,null);passed('经验教程长文独立预览与审核');
  await page.screenshot({path:path.join(output,'longform-desktop.png'),fullPage:true});
  run.mobileViewports=[];
  for(const {width,height} of [{width:375,height:812},{width:390,height:844},{width:430,height:932}]){
    const size=width+'x'+height;
    await page.cdp('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:true});await page.click(action('preview-width','[data-width="'+width+'"]'));
    await page.waitForFunction(({width,height})=>innerWidth===width&&innerHeight===height,{width,height});
    await page.waitForFunction(()=>{const f=document.querySelector('[data-lf-article-frame]'),s=document.querySelector('[data-lf-preview-stage]');return f&&s&&f.getBoundingClientRect().right<=s.getBoundingClientRect().right+1;});
    const bounds=await page.evaluate(()=>{const f=document.querySelector('[data-lf-article-frame]'),s=document.querySelector('[data-lf-preview-stage]');return {viewport:innerWidth,viewportHeight:innerHeight,page:document.documentElement.scrollWidth,body:document.body.scrollWidth,frame:f.getBoundingClientRect().toJSON(),stage:s.getBoundingClientRect().toJSON(),logicalWidth:Number(s.dataset.logicalWidth),fitScale:Number(s.dataset.fitScale),fullText:f.srcdoc.includes('末尾检查点：全文完整保留。'),gif:f.srcdoc.includes('image/gif')||f.srcdoc.includes('/assets/')};});
    assert.equal(bounds.viewport,width);assert.equal(bounds.viewportHeight,height);assert.equal(bounds.logicalWidth,width);
    assert.ok(bounds.page<=width+1);assert.ok(bounds.body<=width+1);assert.ok(bounds.frame.left>=bounds.stage.left);assert.ok(bounds.frame.right<=bounds.stage.right+1);assert.equal(bounds.fullText,true);assert.equal(bounds.gif,true);
    await page.screenshot({path:path.join(output,'longform-mobile-'+size+'.png'),fullPage:true});
    await fs.copyFile(path.join(output,'longform-mobile-'+size+'.png'),path.join(output,'longform-mobile-'+width+'.png'));

    // Scroll the real iframe with the pointer inside its visible intersection.
    await page.click('[data-lf-article-frame]');
    let tail=await readPreviewDocument(page),wheelActions=0;
    for(;!tail.tail.visible&&wheelActions<6;wheelActions++){
      const pointer=await page.evaluate(()=>{const r=document.querySelector('[data-lf-article-frame]').getBoundingClientRect();return {x:(Math.max(0,r.left)+Math.min(innerWidth,r.right))/2,y:(Math.max(0,r.top)+Math.min(innerHeight,r.bottom))/2,visibleWidth:Math.min(innerWidth,r.right)-Math.max(0,r.left),visibleHeight:Math.min(innerHeight,r.bottom)-Math.max(0,r.top)};});
      assert.ok(pointer.visibleWidth>20&&pointer.visibleHeight>40,JSON.stringify(pointer));
      await page.mouse.move(pointer.x,pointer.y,{label:'定位长文预览内'});await page.mouse.wheel(0,1000,{label:'滚动核对正文末尾'});
      tail=await readPreviewDocument(page);
    }
    assert.equal(tail.width,width,'iframe内部排版宽度不应被手机容器改变');
    assert.ok(tail.pageWidth<=tail.width+1,'代码与表格应局部滚动，不撑破iframe正文');
    assert.equal(tail.tail.visible,true,'实际正文尾段必须滚动可达并完整可见');
    const tailScreen=await page.evaluate(({tail,logicalWidth})=>{const r=document.querySelector('[data-lf-article-frame]').getBoundingClientRect(),scale=r.width/logicalWidth;return {viewportHeight:innerHeight,frame:r.toJSON(),tailTop:r.top+tail.top*scale,tailBottom:r.top+tail.bottom*scale,scale};},{tail:tail.tail.rect,logicalWidth:tail.width});
    assert.ok(tailScreen.tailTop>=-1&&tailScreen.tailBottom<=height+1,JSON.stringify(tailScreen));
    await fs.writeFile(path.join(output,'longform-mobile-'+size+'-tail-snapshot.txt'),await page.snapshot());
    await page.screenshot({path:path.join(output,'longform-mobile-'+size+'-tail.png')});
    await fs.copyFile(path.join(output,'longform-mobile-'+size+'-tail.png'),path.join(output,'longform-mobile-'+width+'-tail.png'));

    // Native clicks prove the acknowledgement and approval controls are reachable.
    if(await page.evaluate(()=>document.querySelector('[data-lf-article-ack]').checked))await page.click('[data-lf-article-ack]');
    assert.equal(await page.evaluate(()=>document.querySelector('[data-lf-action="article-approve"]').disabled),true);
    await page.click('[data-lf-article-ack]');
    await page.waitForFunction(()=>!document.querySelector('[data-lf-action="article-approve"]')?.disabled);
    const approveBefore=await page.evaluate(()=>document.querySelector('[data-lf-action="article-approve"]').getBoundingClientRect().toJSON());
    await page.click(action('article-approve'));await page.waitForFunction(()=>document.querySelector('[data-lf-article-badge]')?.textContent==='本版长文已审核'&&document.querySelector('[data-lf-save-state]')?.textContent==='已保存在本机');
    const reviewed=await get();assert.equal(reviewed.runtime.articleApproved,true);
    await page.screenshot({path:path.join(output,'longform-mobile-'+size+'-controls.png')});

    // Download a real local ZIP at each phone size; clickability alone is insufficient.
    const exportPending=page.waitForEvent('download',{timeout:60000});
    await page.click('a[href*="export?format=zip"] >> nth=0');const mobileDownload=await exportPending;
    const mobileZipPath=path.join(output,'source-article-'+size+'.zip');await mobileDownload.saveAs(mobileZipPath);
    const mobileZip=await JSZip.loadAsync(await fs.readFile(mobileZipPath));
    const mobileHTML=await mobileZip.file('article.html').async('string');assert.ok(mobileHTML.includes('末尾检查点：全文完整保留。'));assert.equal((mobileHTML.match(/<img\b/g)||[]).length,1);assert.equal(mobileHTML.includes('class="article-missing-asset"'),false);assert.ok((await mobileZip.file('article.md').async('string')).includes('`![引用语法](asset:example)`'));
    assert.deepEqual(await mobileZip.file('assets/'+asset.sha256+'.gif').async('nodebuffer'),gif);
    const controls=await page.evaluate(()=>{const selector='a[href*="export?format=zip"]',a=document.querySelector(selector),r=a.getBoundingClientRect(),x=Math.max(1,Math.min(innerWidth-1,r.left+r.width/2)),y=Math.max(1,Math.min(innerHeight-1,r.top+r.height/2)),hit=document.elementFromPoint(x,y);return {viewport:innerWidth,height:innerHeight,page:document.documentElement.scrollWidth,body:document.body.scrollWidth,export:r.toJSON(),exportHit:hit===a||a.contains(hit),notice:document.querySelector('[data-lf-notice]')?.textContent};});
    assert.ok(controls.page<=width+1&&controls.body<=width+1,JSON.stringify(controls));
    assert.equal(controls.exportHit,true,'导出入口应在实际手机视口可命中');
    await page.screenshot({path:path.join(output,'longform-mobile-'+size+'-export.png')});
    const evidence={...bounds,size,tail:{...tail,screen:tailScreen,wheelActions},approval:{clicked:true,approved:true,revision:reviewed.revision,buttonBeforeClick:approveBefore},export:{clicked:true,zip:path.basename(mobileZipPath),fullArticleVerified:true,gifBytesVerified:true,...controls}};
    await fs.writeFile(path.join(output,'mobile-'+size+'.json'),JSON.stringify(evidence,null,2));
    await fs.writeFile(path.join(output,'mobile-'+width+'.json'),JSON.stringify(evidence,null,2));
    run.mobileViewports.push({width,height,status:'pass',evidence:'mobile-'+size+'.json',zip:path.basename(mobileZipPath)});
    await fs.writeFile(path.join(output,'results.json'),JSON.stringify({...run,status:'running',results},null,2));
    passed(size+'实际尾段可达、审核与ZIP导出可操作、根页面无横向溢出');
  }passed('375×812 / 390×844 / 430×932完整预览与操作区可达');
  await page.cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:1050,deviceScaleFactor:1,mobile:false});
  const downloadPromise=page.waitForEvent('download');await page.click('a[href*="export?format=zip"] >> nth=0');const download=await downloadPromise;const zipPath=path.join(output,'source-article.zip');await download.saveAs(zipPath);
  const zip=await JSZip.loadAsync(await fs.readFile(zipPath));assert.ok((await zip.file('article.html').async('string')).includes('末尾检查点'));assert.deepEqual(await zip.file('assets/'+asset.sha256+'.gif').async('nodebuffer'),gif);passed('真实UI下载离线包，全文和GIF字节完整');
  const projectURL=await page.url(),offline=path.join(output,'offline-article');await fs.mkdir(path.join(offline,'assets'),{recursive:true});
  await fs.writeFile(path.join(offline,'article.html'),await zip.file('article.html').async('nodebuffer'));await fs.writeFile(path.join(offline,'assets',asset.sha256+'.gif'),gif);
  await page.goto(pathToFileURL(path.join(offline,'article.html')).href);await page.waitForSelector('article');await page.waitForFunction(()=>[...document.images].every(image=>image.complete&&image.naturalWidth>0));
  assert.ok(await page.evaluate(()=>document.body.textContent.includes('末尾检查点：全文完整保留。')));await page.screenshot({path:path.join(output,'offline-article-opened.png'),fullPage:true});
  await page.goto(projectURL);await page.waitForSelector('[data-lf-source-note]');passed('实际离线打开HTML，正文末尾与GIF可读');
  await tab('domestic');await page.click('[data-lf-channel="wechat"]');await save();
  await tab('overseas');assert.equal(await page.evaluate(()=>document.querySelectorAll('[data-lf-channel]:checked').length),0);
  for(const channel of ['substack','linkedin'])await page.click('[data-lf-channel="'+channel+'"]');await page.selectOption('[data-lf-format="linkedin"]','cards');await save();
  await page.click('.lf-task summary');await page.click(action('prepare-task','[data-kind="overseas"]'));await page.waitForFunction(()=>document.querySelector('[data-lf-task-output="overseas"]')?.value.includes('所选平台档案'));
  p=await get();const keys=[{channel:'substack',format:'article',locale:'en-US'},{channel:'linkedin',format:'cards',locale:'en-US'}];const input=await (await fetch(origin+'/api/projects/'+p.id+'/variant-input?keys='+encodeURIComponent(JSON.stringify(keys)))).json();
  const variants=input.keys.map(k=>({...k,profileVersion:input.profileVersion,title:k.channel==='substack'?'A working version you can inspect':'Make the result easy to check',bodyMd:k.channel==='substack'?'A synthetic walkthrough with evidence, tradeoffs, and steps.\n\n![Synthetic [demo]](asset:'+asset.id+')\n\n`![Example](asset:example)`\n\nCheck the output before scaling the workflow.':'One practical habit: save and inspect a complete result.',assets:[],sourceDeps:p.article.sourceDeps,...(k.format==='cards'?{cards:[{kind:'editorial',eyebrow:'SYNTHETIC QA',title:'Keep a checkable result',body:'Save the input.\nInspect the output.\nKeep evidence of what changed.',note:'Local test fixture only'}],visual:{theme:'sage',layout:'airy'}}:{})}));
  // Keep automatic wheel input outside the scrollable task-output textarea.
  await page.mouse.move(900,600,{label:'准备导入平台结果'});
  await page.fill('[data-lf-import="overseas"]',JSON.stringify({revision:input.revision,inputFingerprint:input.inputFingerprint,keys:input.keys,sourceWorkId:input.sourceWorkId,variants}));await page.click(action('import-result','[data-kind="overseas"]'));await page.waitForSelector('[data-lf-variant-select]');
  p=await get();assert.equal(p.variants.length,2);assert.deepEqual(p.selectedChannels.domestic,['wechat']);assert.deepEqual(p.selectedChannels.overseas,['substack','linkedin']);assert.ok(p.variants.every(v=>!v.approval));passed('海外独立选择，平台任务与JSON导入，不自动审核');
  for(const variant of variants){await page.selectOption('[data-lf-variant-select]',variant.id);if(variant.channel==='substack'){await page.click('.lf-variant-reading summary');const reading=await page.evaluate(()=>document.querySelector('[data-lf-variant-preview]').srcdoc);assert.equal((reading.match(/<img\b/g)||[]).length,1);assert.ok(reading.includes('alt="Synthetic [demo]"'));assert.ok(reading.includes('<code>![Example](asset:example)</code>'));}await page.click('[data-lf-variant-ack]');await page.click(action('variant-approve'));await page.waitForFunction(()=>document.querySelector('[data-lf-variant-badge]')?.textContent==='本版已审核');}
  await tab('delivery');const cardId=variants.find(v=>v.format==='cards').id;await page.selectOption('[data-lf-delivery-variant]',cardId);
  const pngDownload=page.waitForEvent('download',{timeout:60000});await page.click(action('export-variant'));const cardDownload=await pngDownload;await cardDownload.saveAs(path.join(output,'english-cards.zip'));
  const cardsZip=await JSZip.loadAsync(await fs.readFile(path.join(output,'english-cards.zip'))),png=await cardsZip.file('images/01.png')?.async('nodebuffer');
  assert.ok(png,'真实图卡PNG应入包');assert.equal(png.readUInt32BE(16),1080);assert.equal(png.readUInt32BE(20),1440);await fs.writeFile(path.join(output,'english-card.png'),png);
  assert.match(await page.evaluate(()=>document.querySelector('.lf-content').textContent),/本机包就绪/);passed('独立平台审核，英文图中文字重排与实际1080×1440 PNG导出');
  await page.fill('[data-lf-feedback-note]','合成验收反馈：下一版应补充成功检查。');await page.click(action('add-feedback'));await page.waitForSelector('.lf-feedback-list article');passed('手动反馈保存，不编造运营指标');
  await tab('overseas');await page.selectOption('[data-lf-variant-select]',variants[0].id);await page.fill(field('variant-bodyMd'),'A revised synthetic English argument, with the same evidence.');await save();p=await get();assert.equal(p.runtime.variantApproved[variants[0].id],false);assert.equal(p.runtime.variantApproved[cardId],true);assert.equal(p.runtime.articleApproved,true);passed('单平台改稿只撤销本版审核');
  await tab('article');await page.fill(field('article-bodyMd'),body+'\n\n修订说明：这是源稿的新版本。');await save();p=await get();assert.equal(p.runtime.articleApproved,false);assert.ok(Object.values(p.runtime.variantApproved).every(v=>!v));passed('源长文改稿使相关海外版本过期');
  const other=await task.newPage();await other.goto(await page.url());await other.waitForSelector('[data-lf-source-note]');await other.click(action('tab','[data-tab="article"]'));await other.waitForSelector(field('article-title'));
  await page.fill(field('article-title'),'窗口A未保存的文字，应保留');await other.fill(field('article-title'),'窗口B已保存的新版本');await other.click('.lf-savebar '+action('save'));await other.waitForFunction(()=>document.querySelector('[data-lf-save-state]')?.textContent==='已保存在本机');
  await page.click('.lf-savebar '+action('save'));await page.waitForSelector('[data-lf-conflict]:not([hidden])');assert.equal(await page.evaluate(()=>document.querySelector('[data-lf-field="article-title"]').value),'窗口A未保存的文字，应保留');
  const backupPromise=page.waitForEvent('download');await page.click(action('backup-edits'));await (await backupPromise).saveAs(path.join(output,'conflict-edits.json'));await page.click(action('compare-server'));await page.waitForFunction(()=>document.querySelector('[data-lf-comparison]')?.textContent.includes('窗口B已保存的新版本'));await page.screenshot({path:path.join(output,'conflict-desktop.png'),fullPage:true});await other.close();passed('两个实际页面409冲突保留输入，可下载副本与比较新版');
  await page.goto(origin);await page.click('[data-action="new"] >> nth=0');await page.fill('#new-topic','合成验收：创业日志');await page.selectOption('#new-kind','article');await page.click('#create-project');await page.waitForSelector('[data-lf-source-note]');await tab('article');await page.click(action('story-type','[data-value="diary"]'));await page.fill(field('article-bodyMd'),'今天只记录一次选择。这是合成验收，不是用户真实裸辞经历。');await save();await page.click('.lf-task summary');await page.click(action('prepare-task','[data-kind="article"]'));await page.waitForFunction(()=>document.querySelector('[data-lf-task-output="article"]')?.value.includes('Viral Writer'));
  assert.match(await page.evaluate(()=>document.querySelector('[data-lf-task-output="article"]').value),/Humanizer-zh/);await page.click(action('article-preview'));await page.waitForSelector('[data-lf-article-frame]');await page.click('[data-lf-article-ack]');await page.click(action('article-approve'));await page.waitForFunction(()=>document.querySelector('[data-lf-article-badge]')?.textContent==='本版长文已审核');await page.reload();await page.waitForSelector('[data-lf-source-note]');p=await get();assert.equal(p.article.storyType,'diary');assert.equal(p.tasks.length,0);assert.equal(p.runtime.articleApproved,true);passed('创业日志技能路由、独立审核、重载无重复任务');
  await page.click('[data-action="library"] >> nth=0');await page.waitForSelector('.projects-grid');await page.click('[data-filter="approved"]');
  assert.equal(await page.evaluate(id=>Boolean(document.querySelector('[data-open="'+id+'"]')),p.id),true);assert.match(await page.evaluate(id=>document.querySelector('[data-open="'+id+'"] .project-meta').textContent,p.id),/1 篇长文/);passed('内容库已审核筛选保留独立长文并显示文章标识');
  await checkCardsUI(task,path.join(output,'cards'),origin,{packageSha});passed('旧短图卡全链路与430真图导出回归');
  const result={...run,status:'pass',finishedAt:new Date().toISOString(),passed:results.length,browser:'ego-lite',syntheticOnly:true,remoteWrites:0,formalPublishing:0,results};await fs.writeFile(path.join(output,'results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'xiaoxian-longform-ui-')),output=path.resolve(process.env.STUDIO_UI_OUTPUT||path.join(os.tmpdir(),'xiaoxian-longform-ui'));
  const env={...process.env,STUDIO_PORT:String(port),STUDIO_DATA_DIR:directory};delete env.STUDIO_DRAFT_DRIVER;
  const server=spawn(process.execPath,[path.join(root,'server.mjs')],{cwd:root,env,stdio:['ignore','pipe','pipe']});
  try{await new Promise((resolve,reject)=>{server.stdout.once('data',resolve);server.once('error',reject);server.once('exit',()=>reject(Error('隔离服务未启动')));});
    const space=process.env.STUDIO_EGO_SPACE,code=`const task=await taskSpace(${space?Number(space):JSON.stringify('小苋 · 长文验收')});console.log({spaceId:task.spaceId});const {checkLongformUI}=await import(${JSON.stringify(fileURLToPath(import.meta.url))});await checkLongformUI(task,${JSON.stringify(output)},${JSON.stringify({packageSha:process.env.STUDIO_PACKAGE_SHA||null})});${space?'':'await task.finish({keep:[]});'}`;
    const child=spawn('ego-browser',['nodejs','-e',code],{stdio:'inherit'});await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(Error('长文Ego验收未通过')));});
  }catch(error){let result={};try{result=JSON.parse(await fs.readFile(path.join(output,'results.json'),'utf8'));}catch{}await fs.mkdir(output,{recursive:true});await fs.writeFile(path.join(output,'results.json'),JSON.stringify({...result,status:'fail',finishedAt:new Date().toISOString(),error:error.message},null,2));throw error;}finally{server.kill('SIGINT');await new Promise(r=>server.once('exit',r));await fs.rm(directory,{recursive:true,force:true});}
}
