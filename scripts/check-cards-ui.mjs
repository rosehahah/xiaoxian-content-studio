import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import JSZip from 'jszip';
import {seedProject} from '../model.mjs';

const root=fileURLToPath(new URL('..',import.meta.url));

/**
 * U01: exercise the existing cards UI against the caller's isolated local server.
 * This module does not launch a browser/server, create a task space, or run on import.
 * Call sequentially in the same Ego Lite task used for the longform regression:
 *   await checkCardsUI(task, output, 'http://localhost:14437');
 * Every approval and download belongs to synthetic data, never real user content.
 */
export async function checkCardsUI(task,output,origin,source={}) {
  const packageSha=source.packageSha||process.env.STUDIO_PACKAGE_SHA;
  const address=new URL(origin);
  assert.ok(['http:','https:'].includes(address.protocol),'需要本机 HTTP 地址');
  assert.ok(['localhost','127.0.0.1','[::1]','::1'].includes(address.hostname),'图卡验收只允许本机服务');
  assert.equal(address.username+address.password,'','验收地址不能含凭证');
  const localOrigin=address.origin,page=task.page('p1');
  const outputDir=path.resolve(output);await fs.mkdir(outputDir,{recursive:true});
  const resultPath=path.join(outputDir,'cards-results.json');
  const run={caseId:'U01',runId:'cards-'+Date.now().toString(36),status:'running',startedAt:new Date().toISOString(),browser:'ego-lite',syntheticOnly:true,remoteWrites:0,formalPublishing:0,origin:localOrigin,spaceId:task.spaceId};
  let initialViewport,stage='initial_snapshot';
  const checks=[];
  const passed=name=>{checks.push(name);console.log('PASS '+name);};
  const snapshot=async name=>fs.writeFile(path.join(outputDir,name),await page.snapshot({scope:'full_page'}));
  const localRequest=async(route,options={})=>{
    const response=await fetch(localOrigin+route,{...options,headers:{'Content-Type':'application/json',...options.headers}});
    const body=await response.json();assert.ok(response.ok,`${route}: ${response.status} ${body.error || ''}`);return body;
  };
  const getProject=async id=>(await localRequest('/api/projects/'+encodeURIComponent(id))).project;
  try {
    // Capture the starting surface before local fixture setup or any UI operation.
    await snapshot('cards-initial-snapshot.txt');
    initialViewport=await page.evaluate(()=>({width:innerWidth,height:innerHeight,deviceScaleFactor:devicePixelRatio || 1}));
    run.sha=packageSha||execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();run.sourceKind=packageSha?'release_archive':'git_checkout';
    run.workingTreeDirty=packageSha?null:Boolean(execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}).trim());
    await fs.writeFile(resultPath,JSON.stringify(run,null,2));

    stage='synthetic_setup';
    const fixture=seedProject();
    fixture.id='cards-ui-'+Date.now().toString(36)+'-'+randomUUID().slice(0,8);
    fixture.workKind='cards';fixture.stage='content';fixture.revision=0;
    fixture.content.topic='合成验收：图卡闭环';fixture.content.series='';
    fixture.content.takeaway='先保存本机副本，再核对文字和图片。';
    fixture.content.cards=[{kind:'editorial',eyebrow:'SYNTHETIC QA',title:'先保存，\n再核对。',body:'这是合成验收材料。\n检查文字与图片。\n只下载到本机。',note:'仅用于软件回归，不是真实用户经历。'}];
    fixture.visual={theme:'sage',layout:'airy'};
    delete fixture.contentApproval;delete fixture.cardApproval;delete fixture.planning;
    for(const key of ['wechat','xiaohongshu','douyin']) {
      fixture.platforms[key]={...fixture.platforms[key],title:'合成图卡验收',body:key==='douyin'?'这是一份合成图卡回归材料，用来检查本机工作台的旧流程：先修改正文，确认内容，再检查视觉与每张图卡，最后下载包含图片、配文和源文件的交付包。所有文字与图片只服务于软件验收，不代表真实用户经历，也不会发布到任何社媒。下载后还要核对图片尺寸、正文末尾和审核记录，确保这份内容能够重新打开并继续使用。':'合成验收材料。先保存本机副本，核对图卡，再下载完整交付包。本测试不会写入任何社媒平台。',tags:['本机验收'],delivery:null,history:[]};
    }
    const created=(await localRequest('/api/projects',{method:'POST',body:JSON.stringify(fixture)})).project;
    run.projectId=created.id;
    assert.equal(created.contentApproval ?? null,null);assert.equal(created.cardApproval ?? null,null);
    assert.equal(created.visual.creative,undefined);assert.equal(created.content.cards.length,1);
    await fs.writeFile(path.join(outputDir,'cards-synthetic-input.json'),JSON.stringify(created,null,2));

    stage='body_edit_and_save';
    await page.cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:1050,deviceScaleFactor:1,mobile:false});
    await page.goto(localOrigin+'/?project='+encodeURIComponent(created.id)+'&stage=content&tab=body');
    await page.waitForSelector('[data-field="card-body"]');
    await snapshot('cards-content-before-edit.txt');
    const editedTitle='保留一份\n可检查的结果';
    const editedBody='先保存一份本机副本。\n再核对文字与图片。\n末尾检查点：这份图卡完整保留。';
    await page.fill('[data-field="card-title"]',editedTitle);
    await page.fill('[data-field="card-body"]',editedBody);
    await page.press('[data-field="card-body"]','Tab');
    await page.waitForFunction(()=>document.querySelector('[data-save-label]')?.textContent==='已保存');
    let saved=await getProject(created.id);
    assert.equal(saved.content.cards[0].title,editedTitle);assert.equal(saved.content.cards[0].body,editedBody);
    assert.equal(saved.contentApproval,null);assert.equal(saved.cardApproval,null);
    passed('旧图卡正文通过真实UI编辑并保存，未预置审核');

    stage='content_confirmation_and_design';
    await page.click('[data-action="confirm-content"]');
    await page.waitForSelector('[data-action="go-review"]');
    saved=await getProject(created.id);assert.ok(saved.contentApproval?.fingerprint);assert.equal(saved.cardApproval,null);
    await snapshot('cards-design-before-layout.txt');
    await page.click('[data-layout="compact"]');
    await page.waitForFunction(()=>document.querySelector('[data-layout="compact"]')?.classList.contains('active') && document.querySelector('[data-save-label]')?.textContent==='已保存');
    saved=await getProject(created.id);assert.equal(saved.visual.layout,'compact');assert.ok(saved.contentApproval?.fingerprint);assert.equal(saved.cardApproval,null);
    await page.screenshot({path:path.join(outputDir,'cards-design-desktop.png'),fullPage:true});
    passed('真实UI确认内容并调整内页，视觉修改不撤销内容确认');

    stage='per_card_review_and_confirmation_modal';
    await page.click('[data-action="go-review"]');await page.waitForSelector('[data-reviewed="0"]');
    await snapshot('cards-review-before-check.txt');
    assert.equal(await page.evaluate(()=>document.querySelector('[data-action="confirm-cards"]').disabled),true);
    await page.click('[data-reviewed="0"]');
    await page.waitForFunction(()=>document.querySelector('[data-reviewed="0"]')?.getAttribute('aria-pressed')==='true' && !document.querySelector('[data-action="confirm-cards"]')?.disabled);
    await page.screenshot({path:path.join(outputDir,'cards-review-desktop.png'),fullPage:true});
    await page.click('[data-action="confirm-cards"]');await page.waitForSelector('#approve-final');
    await snapshot('cards-review-confirmation-modal.txt');
    await page.click('#approve-final');await page.waitForSelector('[data-action="package"]');
    saved=await getProject(created.id);assert.ok(saved.contentApproval?.fingerprint);assert.ok(saved.cardApproval?.fingerprint);assert.equal(saved.stage,'drafts');
    passed('真实UI逐图检查、审核确认弹窗与进入草稿');

    stage='draft_copy_and_mobile';
    await page.click('[data-platform="wechat"]');await page.waitForSelector('[data-field="platform-body"]');
    await snapshot('cards-drafts-before-edit.txt');
    const copyTitle='合成图卡闭环';
    const copyBody='这是合成验收配文。先保存本机副本，再核对文字和真实图卡。\n\n配文末尾检查点：下载包应完整保留这一段。';
    await page.fill('[data-field="platform-title"]',copyTitle);await page.fill('[data-field="platform-body"]',copyBody);await page.fill('[data-field="platform-tags"]','本机验收');await page.press('[data-field="platform-body"]','Tab');
    await page.waitForFunction(()=>document.querySelector('[data-save-label]')?.textContent==='已保存' && !document.querySelector('[data-action="package"]')?.disabled);
    saved=await getProject(created.id);assert.equal(saved.platforms.wechat.body,copyBody);assert.ok(saved.cardApproval?.fingerprint);
    await page.screenshot({path:path.join(outputDir,'cards-drafts-desktop.png'),fullPage:true});
    await page.cdp('Emulation.setDeviceMetricsOverride',{width:430,height:932,deviceScaleFactor:1,mobile:true});
    await page.waitForFunction(()=>innerWidth===430);
    const bounds=await page.evaluate(()=>({viewport:innerWidth,page:document.documentElement.scrollWidth,body:document.body.scrollWidth,packageButton:document.querySelector('[data-action="package"]')?.getBoundingClientRect().toJSON()}));
    assert.ok(bounds.page<=bounds.viewport+1,JSON.stringify(bounds));
    assert.ok(bounds.body<=bounds.viewport+1,JSON.stringify(bounds));
    await fs.writeFile(path.join(outputDir,'cards-mobile-430.json'),JSON.stringify(bounds,null,2));
    await page.screenshot({path:path.join(outputDir,'cards-mobile-430.png'),fullPage:true});
    passed('草稿配文真实UI独立编辑，430视口根页面无横向溢出');

    stage='real_zip_download_and_artifact_verification';
    const downloadPending=page.waitForEvent('download',{timeout:60000});
    await page.click('[data-action="package"]');const download=await downloadPending;
    const zipPath=path.join(outputDir,'legacy-cards.zip');await download.saveAs(zipPath);
    const zip=await JSZip.loadAsync(await fs.readFile(zipPath));
    const imageNames=Object.keys(zip.files).filter(name=>/^images\/\d+\.png$/.test(name));
    assert.deepEqual(imageNames,['images/01.png']);
    const png=await zip.file('images/01.png').async('nodebuffer');
    assert.ok(png.length>1000,'真实图卡PNG不应是空壳图片');
    assert.deepEqual([...png.subarray(0,8)],[137,80,78,71,13,10,26,10]);
    assert.equal(png.readUInt32BE(16),1080);assert.equal(png.readUInt32BE(20),1440);
    await fs.writeFile(path.join(outputDir,'legacy-card.png'),png);
    const copy=await zip.file('配文.txt')?.async('string');assert.equal(copy,copyTitle+'\n\n'+copyBody+'\n\n#本机验收');
    const html=await zip.file('图卡源文件.html')?.async('string');assert.ok(html?.startsWith('<!doctype html>'));assert.match(html,/末尾检查点：这份图卡完整保留/);assert.match(html,/可检查的结果/);assert.match(html,/<style>/);
    const audit=JSON.parse(await zip.file('审核记录.json').async('string'));assert.ok(audit.contentApproval?.fingerprint);assert.ok(audit.cardApproval?.fingerprint);assert.equal(audit.platform,'wechat');assert.equal(audit.copy.body,copyBody);
    assert.ok(zip.file('使用说明.txt'));assert.ok(zip.file('许可/lucide.txt'));assert.ok(zip.file('许可/tabler.txt'));
    saved=await getProject(created.id);assert.ok(Object.values(saved.platforms).every(value=>value.delivery==null),'下载本机包不得伪造远程草稿记录');
    await snapshot('cards-final-snapshot.txt');
    passed('真实UI下载ZIP：1080×1440 PNG、完整配文、HTML源文件、审核与许可齐全');
    const result={...run,status:'pass',finishedAt:new Date().toISOString(),passed:checks.length,results:checks,artifacts:{zip:'legacy-cards.zip',png:'legacy-card.png',mobile:'cards-mobile-430.png',mobileBounds:'cards-mobile-430.json'}};
    await fs.writeFile(resultPath,JSON.stringify(result,null,2));console.log(JSON.stringify(result));return result;
  } catch(error) {
    await fs.writeFile(resultPath,JSON.stringify({...run,status:'fail',failedStage:stage,finishedAt:new Date().toISOString(),passed:checks.length,results:checks,error:error.message},null,2));
    try {await snapshot('cards-failure-snapshot.txt');await page.screenshot({path:path.join(outputDir,'cards-failure.png'),fullPage:true});}catch {}
    throw error;
  } finally {
    // Keep the caller's space and page alive. Never create or finish a task space here.
    if(initialViewport)try {await page.cdp('Emulation.setDeviceMetricsOverride',{...initialViewport,mobile:false});}catch {}
  }
}
