import {fileURLToPath} from 'node:url';
import {seedProject,contentKey} from '../model.mjs';
import {creativeInputKey} from '../creative.mjs';
import os from 'node:os';
import path from 'node:path';
import {mkdtemp,writeFile,rm,mkdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('..',import.meta.url));
const project=seedProject();project.id='isolated-cover-qa';project.content.topic='换台电脑，项目怎么迁移？';
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9N8AAAAASUVORK5CYII=';
project.visual.creative={mode:'portrait',style:'vivid',portrait:{name:'test-pixel.png',data:png},result:null};project.visual.creative.result={name:'previous.png',data:png,inputFingerprint:creativeInputKey(project)};project.contentApproval={fingerprint:contentKey(project),by:'isolated-test'};
export async function checkCoverUI(page,outputDir){
  await page.cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:1050,deviceScaleFactor:1,mobile:false});
  await page.goto('http://localhost:4412/?project=isolated-cover-qa&stage=cover');await page.waitForSelector('.cover-reference');
  assert.equal(await page.evaluate(()=>document.querySelectorAll('.cover-reference').length),3);
  await page.click('[data-action="cover-show-all"]');assert.equal(await page.evaluate(()=>document.querySelectorAll('.cover-reference').length),9);
  await page.click('[data-action="cover-reference-zoom"][data-reference="headline"]');await page.waitForSelector('.cover-reference-zoom');await page.click('[data-dismiss] >> nth=-1');
  await page.screenshot({path:path.join(outputDir,'cover-studio-desktop.png'),fullPage:true});
  await page.click('[data-action="cover-reference"][data-reference="headline"]');await page.waitForSelector('[data-cover-panel="prepare"]:not([hidden])');
  await page.fill('#cover-headline','换台电脑\n项目怎么搬？');await page.click('.cover-copy summary');await page.fill('#cover-points','备份代码\n保存草稿\n新电脑检查');await page.fill('#cover-benefit','把现有项目接着做');await page.fill('#cover-direction','保留自然背景，不沿用旧封面动作。');await page.press('#cover-direction','Tab');
  await page.waitForFunction(()=>document.querySelector('[data-save-label]')?.textContent==='已保存');
  let q=(await (await fetch('http://localhost:4412/api/projects')).json()).projects[0];assert.deepEqual(q.content,project.content);assert.deepEqual(q.contentApproval,project.contentApproval);
  const input=await (await fetch('http://localhost:4412/api/projects/'+q.id+'/creative-input')).json();assert.notEqual(input.portraitPath,input.referencePath);assert.ok(input.prompt.includes('备份代码'));
  await page.click('[data-action="cover-phase"][data-phase="references"]');await page.click('[data-action="cover-reference"][data-reference="objects"]');
  assert.equal(await page.evaluate(()=>document.querySelector('#portrait-photo')),null);assert.equal(await page.evaluate(()=>document.querySelector('[data-action="cover-task"]').disabled),false);
  await page.setInputFiles('#cover-result',root+'/dist/cover-references/social-atlas.png');await page.waitForFunction(()=>document.querySelectorAll('.cover-candidate').length===2);
  q=(await (await fetch('http://localhost:4412/api/projects')).json()).projects[0];assert.equal(q.visual.creative.selectedCandidateId,null);const candidate=q.visual.creative.candidates[1];
  await page.reload();await page.waitForSelector('[data-cover-panel="candidates"]:not([hidden])');assert.equal(await page.evaluate(()=>document.querySelectorAll('.cover-candidate.chosen').length),0);
  await page.click('[data-action="cover-candidate-zoom"][data-candidate="'+candidate.id+'"]');await page.waitForSelector('.cover-full');await page.click('[data-dismiss] >> nth=-1');
  await page.click('[data-action="cover-select"][data-candidate="'+candidate.id+'"]');await page.waitForSelector('.cover-candidate.chosen');await page.reload();await page.waitForSelector('.cover-candidate.chosen');
  q=(await (await fetch('http://localhost:4412/api/projects')).json()).projects[0];assert.equal(q.visual.creative.selectedCandidateId,candidate.id);assert.equal(q.cardApproval,null);assert.deepEqual(q.contentApproval,project.contentApproval);
  await page.click('[data-stage="design"] >> nth=0');await page.click('[data-action="creative-style"][data-style="minimal"]');await page.waitForFunction(()=>document.querySelector('[data-save-label]')?.textContent==='已保存');await page.click('[data-stage="cover"] >> nth=0');await page.waitForSelector('.cover-candidate.chosen');
  await page.cdp('Emulation.setDeviceMetricsOverride',{width:430,height:932,deviceScaleFactor:1,mobile:true});
  const widths=await page.evaluate(()=>({viewport:innerWidth,page:document.documentElement.scrollWidth}));assert.ok(widths.page<=widths.viewport,JSON.stringify(widths));await page.screenshot({path:path.join(outputDir,'cover-studio-mobile.png'),fullPage:true});
  await page.click('[data-action="new"] >> nth=0');await page.fill('#new-topic','测试新建，不定封面');await page.click('#create-project');await page.waitForSelector('.planning-input');await page.click('[data-stage="cover"] >> nth=0');
  assert.equal(await page.evaluate(()=>document.querySelectorAll('.cover-reference').length),3);await page.click('[data-action="cover-reference"] >> nth=0');await page.click('[data-action="cover-mode"][data-mode="portrait"]');
  assert.equal(await page.evaluate(()=>document.querySelector('[data-action="cover-task"]').disabled),true);assert.equal(await page.evaluate(()=>document.querySelectorAll('#portrait-photo').length),1);
  console.log(JSON.stringify({passed:true,browser:'ego-lite',referenceCount:9,mobile:widths,isolatedDataOnly:true}));
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const outputDir=path.join(os.tmpdir(),'xiaoxian-cover-ui');await mkdir(outputDir,{recursive:true});const dir=await mkdtemp(path.join(os.tmpdir(),'cover-ui-qa-'));await writeFile(dir+'/projects.json',JSON.stringify([project]));
 const server=spawn(process.execPath,[root+'/server.mjs'],{cwd:root,env:{...process.env,STUDIO_PORT:'4412',STUDIO_DATA_DIR:dir},stdio:['ignore','pipe','pipe']});
 try{
  await new Promise((resolve,reject)=>{server.stdout.once('data',resolve);server.once('error',reject);server.once('exit',()=>reject(Error('QA server exited')));});
  const space=process.env.STUDIO_EGO_SPACE,code=`const task=await taskSpace(${space?Number(space):JSON.stringify('小苋 · 封面浏览器回归')});console.log({spaceId:task.spaceId,url:await task.page('p1').url()});const {checkCoverUI}=await import(${JSON.stringify(fileURLToPath(import.meta.url))});await checkCoverUI(task.page('p1'),${JSON.stringify(outputDir)});${space?'':"await task.finish({keep:[]});"}`;
  const child=spawn('ego-browser',['nodejs','-e',code],{stdio:'inherit'});await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(Error('Ego Lite 封面回归未通过')));});
 }finally{server.kill('SIGINT');await new Promise(r=>server.once('exit',r));await rm(dir,{recursive:true,force:true});}
}
