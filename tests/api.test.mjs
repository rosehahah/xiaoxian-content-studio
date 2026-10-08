import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {cardKey} from '../model.mjs';
let server,temp,p;
const base='http://127.0.0.1:4399';
async function req(route,body,method='POST',extra={}){return fetch(base+route,{method,headers:{...(body?{'Content-Type':'application/json'}:{}),...extra},body:body?JSON.stringify(body):undefined});}
async function waitForJob(id,status){const deadline=Date.now()+5000;let job;while(Date.now()<deadline){job=(await (await req('/api/draft-jobs/'+id,null,'GET')).json()).job;if(job.status===status)return job;if(job.status==='error')throw Error(job.message);await new Promise(resolve=>setTimeout(resolve,20));}assert.fail('任务未完成：'+JSON.stringify(job));}
before(async()=>{temp=await mkdtemp(path.join(os.tmpdir(),'xiaoxian-test-'));server=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,STUDIO_PORT:'4399',STUDIO_DATA_DIR:temp,STUDIO_DRAFT_DRIVER:'mock'},stdio:['ignore','pipe','pipe']});await new Promise((resolve,reject)=>{server.stdout.once('data',resolve);server.once('error',reject);server.once('exit',()=>reject(new Error('server stopped')));});p=(await (await req('/api/projects',null,'GET')).json()).projects[0];});
after(async()=>{server?.kill();await new Promise(r=>server.once('exit',r));await rm(temp,{recursive:true,force:true});});
test('未审核不能调用草稿接口，跨站请求被拒绝',async()=>{const r=await req('/api/projects/'+p.id+'/draft',{revision:p.revision,cardFingerprint:cardKey(p),images:[]});assert.equal(r.status,400);assert.match((await r.json()).error,/审核/);const cross=await req('/api/projects/'+p.id,{...p},'PUT',{Origin:'https://external.example'});assert.equal(cross.status,403);});
test('内容确认、逐图审核和版本冲突在服务端强制约束',async()=>{let r=await req('/api/projects/'+p.id+'/cards-approve',{revision:p.revision,cardFingerprint:cardKey(p),viewedCount:5});assert.equal(r.status,400);r=await req('/api/projects/'+p.id+'/content-approve',{revision:p.revision});p=(await r.json()).project;assert.equal(r.status,200);r=await req('/api/projects/'+p.id+'/cards-approve',{revision:p.revision,cardFingerprint:cardKey(p),viewedCount:4});assert.equal(r.status,400);r=await req('/api/projects/'+p.id+'/cards-approve',{revision:p.revision,cardFingerprint:cardKey(p),viewedCount:5});p=(await r.json()).project;assert.equal(r.status,200);const forged={...p,revision:p.revision-1};r=await req('/api/projects/'+p.id,forged,'PUT');assert.equal(r.status,409);p.content.cards[0].title='新的文字';r=await req('/api/projects/'+p.id,p,'PUT');p=(await r.json()).project;assert.equal(p.contentApproval,null);assert.equal(p.cardApproval,null);});
test('不存在正式发布端点，也不会让网页提交凭证',async()=>{const r=await req('/api/projects/'+p.id+'/publish',{revision:p.revision});assert.equal(r.status,404);const projects=await (await req('/api/projects',null,'GET')).json();assert.ok(!JSON.stringify(projects).includes('wechat_secret'));});
test('自动草稿任务只接受审核版本，并保存可核对状态',async()=>{
  let r=await req('/api/projects/'+p.id+'/content-approve',{revision:p.revision});p=(await r.json()).project;
  r=await req('/api/projects/'+p.id+'/cards-approve',{revision:p.revision,cardFingerprint:cardKey(p),viewedCount:p.content.cards.length});p=(await r.json()).project;
  r=await req('/api/platform-sessions/xiaohongshu/check',{});assert.equal(r.status,202);const loginStarted=await r.json();const loginJob=await waitForJob(loginStarted.job.id,'logged_in');
  assert.equal(loginJob.status,'logged_in');const health=await (await req('/api/health',null,'GET')).json();assert.equal(health.platformSessions.xiaohongshu.status,'logged_in');
  const png=Buffer.alloc(24);Buffer.from('89504e470d0a1a0a','hex').copy(png);png.writeUInt32BE(1080,16);png.writeUInt32BE(1440,20);
  r=await req('/api/projects/'+p.id+'/draft-job',{revision:p.revision,platform:'xiaohongshu',cardFingerprint:cardKey(p),images:p.content.cards.map(()=>`data:image/png;base64,${png.toString('base64')}`)});
  assert.equal(r.status,202);const started=await r.json();assert.equal(started.job.platform,'xiaohongshu');assert.equal('imageFiles' in started.job,false);
  const job=await waitForJob(started.job.id,'draft');
  assert.equal(job.status,'draft');p=(await (await req('/api/projects',null,'GET')).json()).projects.find(x=>x.id===p.id);assert.equal(p.platforms.xiaohongshu.delivery.status,'draft');
});

test('真人生图输入缺照片时拒绝，导入结果必须匹配当前版本',async()=>{
 const {seedProject}=await import('../model.mjs');const {newCreative}=await import('../creative.mjs');
 let q=seedProject();q.id='portrait-flow';q.visual.creative={mode:'portrait',style:'vivid',portrait:null,result:null};
 let r=await req('/api/projects',q);assert.equal(r.status,201);q=(await r.json()).project;
 r=await req('/api/projects/'+q.id+'/creative-input',null,'GET');assert.equal(r.status,400);assert.match((await r.json()).error,/上传/);
 q.visual.creative.portrait={name:'person.png',data:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9N8AAAAASUVORK5CYII='};
 r=await req('/api/projects/'+q.id,q,'PUT');assert.equal(r.status,200);q=(await r.json()).project;
 r=await req('/api/projects/'+q.id+'/content-approve',{revision:q.revision});assert.equal(r.status,200);q=(await r.json()).project;
 r=await req('/api/projects/'+q.id+'/cards-approve',{revision:q.revision,cardFingerprint:cardKey(q),viewedCount:q.content.cards.length});assert.equal(r.status,400);assert.match((await r.json()).error,/先生成/);
 const input=await (await req('/api/projects/'+q.id+'/creative-input',null,'GET')).json();assert.ok(input.portraitPath.startsWith(temp));assert.match(input.prompt,/identity-preserve/);
 const {readFile}=await import('node:fs/promises');assert.ok((await readFile(input.portraitPath)).length>24);
 const body={revision:q.revision,name:'generated.png',data:q.visual.creative.portrait.data,inputFingerprint:input.inputFingerprint};
 r=await req('/api/projects/'+q.id+'/cover-import',{...body,inputFingerprint:'deadbeef'});assert.equal(r.status,400);
 r=await req('/api/projects/'+q.id+'/cover-import',body);assert.equal(r.status,200);q=(await r.json()).project;assert.equal(q.cardApproval,null);assert.equal(q.visual.creative.result.inputFingerprint,input.inputFingerprint);
 q.visual.creative.style='minimal';r=await req('/api/projects/'+q.id,q,'PUT');q=(await r.json()).project;
 r=await req('/api/projects/'+q.id+'/cover-import',{...body,revision:q.revision});assert.equal(r.status,400);
});

test('新封面流程：正文独立确认，多候选导入后须显式选择，版本与身份参考分开',async()=>{
 const {seedProject,contentKey}=await import('../model.mjs');const {newCreative,currentCover,creativeInputKey}=await import('../creative.mjs');
 let q=seedProject();q.id='cover-candidates';q.visual.creative=newCreative();let r=await req('/api/projects',q);q=(await r.json()).project;
 r=await req('/api/projects/'+q.id+'/content-approve',{revision:q.revision});assert.equal(r.status,200);q=(await r.json()).project;const textKey=contentKey(q);
 const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9N8AAAAASUVORK5CYII=';
 Object.assign(q.visual.creative,{mode:'portrait',referenceId:'custom',portrait:{name:'person.png',data:png},reference:{name:'layout.png',data:png}});
 r=await req('/api/projects/'+q.id,q,'PUT');q=(await r.json()).project;assert.equal(contentKey(q),textKey);assert.ok(q.contentApproval);
 const input=await (await req('/api/projects/'+q.id+'/creative-input',null,'GET')).json();assert.notEqual(input.portraitPath,input.referencePath);assert.ok(input.referencePath.startsWith(temp));assert.ok(input.selectionEndpoint.endsWith('/cover-select'));
 const ids=[];for(let i=0;i<3;i++){r=await req('/api/projects/'+q.id+'/cover-import',{revision:q.revision,inputFingerprint:input.inputFingerprint,name:'candidate-'+i+'.png',data:png});assert.equal(r.status,200);const d=await r.json();q=d.project;ids.push(d.candidateId);assert.equal(currentCover(q),null);assert.equal(q.cardApproval,null);assert.ok(q.contentApproval);}
 r=await req('/api/projects/'+q.id+'/cover-import',{revision:input.revision,inputFingerprint:input.inputFingerprint,name:'stale.png',data:png});assert.equal(r.status,409);
 r=await req('/api/projects/'+q.id+'/cover-select',{revision:q.revision,candidateId:'missing'});assert.equal(r.status,400);
 r=await req('/api/projects/'+q.id+'/cover-select',{revision:q.revision,candidateId:ids[1]});assert.equal(r.status,200);q=(await r.json()).project;assert.equal(q.visual.creative.selectedCandidateId,ids[1]);assert.ok(currentCover(q));assert.equal(q.cardApproval,null);
 q.visual.creative.style='minimal';r=await req('/api/projects/'+q.id,q,'PUT');q=(await r.json()).project;assert.ok(currentCover(q));assert.ok(q.contentApproval);
 q.visual.creative.coverDirection='new composition';r=await req('/api/projects/'+q.id,q,'PUT');q=(await r.json()).project;assert.equal(currentCover(q),null);
 r=await req('/api/projects/'+q.id+'/cover-select',{revision:q.revision,candidateId:ids[0]});assert.equal(r.status,400);
 Object.assign(q.visual.creative,{mode:'text',referenceId:'objects'});r=await req('/api/projects/'+q.id,q,'PUT');q=(await r.json()).project;
 const input2=await (await req('/api/projects/'+q.id+'/creative-input',null,'GET')).json();assert.equal(input2.portraitPath,null);assert.ok(input2.referencePath.endsWith('social-atlas.png'));assert.match(input2.prompt,/Do not include any person/);
 r=await req('/api/projects/'+q.id+'/cover-import',{revision:q.revision,inputFingerprint:input2.inputFingerprint,name:'objects.png',data:png});assert.equal(r.status,200);q=(await r.json()).project;assert.equal(q.visual.creative.candidates.length,4);assert.notEqual(creativeInputKey(q),input.inputFingerprint);
});

test('账号偏好独立保存并校验版本，不改旧项目内容和审核',async()=>{
 const old=await(await req('/api/projects',null,'GET')).json();
 let r=await req('/api/account-preferences',null,'GET');assert.equal(r.status,200);const prefs=(await r.json()).preferences;
 r=await req('/api/account-preferences',{...prefs,tone:'面向小白，用短句'},'PUT');assert.equal(r.status,200);const saved=(await r.json()).preferences;assert.equal(saved.revision,prefs.revision+1);
 r=await req('/api/account-preferences',prefs,'PUT');assert.equal(r.status,409);
 assert.deepEqual(await(await req('/api/projects',null,'GET')).json(),old);
 const {readFile}=await import('node:fs/promises');assert.deepEqual(JSON.parse(await readFile(path.join(temp,'account-preferences.json'),'utf8')),saved);
});
test('策划导入保留正文与审核，选定后才更新简报并撤销审核；过期请求被拒绝',async()=>{
 const {seedProject,contentKey}=await import('../model.mjs');const {newPlanning}=await import('../planning.mjs');
 let q=seedProject();q.id='planning-flow';q.planning=newPlanning(q);let r=await req('/api/projects',q);q=(await r.json()).project;
 r=await req('/api/projects/'+q.id+'/content-approve',{revision:q.revision});q=(await r.json()).project;
 const beforeText=contentKey(q),cards=structuredClone(q.content.cards),approval=structuredClone(q.contentApproval);
 const input=await(await req('/api/projects/'+q.id+'/planning-input',null,'GET')).json();assert.match(input.prompt,/只策划/);
 const candidates=[{title:'换电脑先搬什么？',audience:'AI小白',benefit:'分清代码、资料和工具',reason:'先理解概念',outline:['代码存哪里','资料怎么带走'],evidence:['GitHub文档']}];
 r=await req('/api/projects/'+q.id+'/planning-import',{revision:input.revision,inputFingerprint:'wrong',candidates});assert.equal(r.status,400);
 r=await req('/api/projects/'+q.id+'/planning-import',{revision:input.revision,inputFingerprint:input.inputFingerprint,candidates});assert.equal(r.status,200);q=(await r.json()).project;
 assert.equal(contentKey(q),beforeText);assert.deepEqual(q.contentApproval,approval);assert.equal(q.planning.selectedId,null);
 r=await req('/api/projects/'+q.id+'/planning-select',{revision:input.revision,candidateId:q.planning.candidates[0].id});assert.equal(r.status,409);
 r=await req('/api/projects/'+q.id+'/planning-select',{revision:q.revision,candidateId:q.planning.candidates[0].id});assert.equal(r.status,200);q=(await r.json()).project;
 assert.equal(q.contentApproval,null);assert.equal(q.cardApproval,null);assert.deepEqual(q.content.cards,cards);assert.equal(q.content.brief.benefit,candidates[0].benefit);
 q.planning.idea='另一个问题';q.planning.selectedId=null;r=await req('/api/projects/'+q.id,q,'PUT');q=(await r.json()).project;
 r=await req('/api/projects/'+q.id+'/planning-select',{revision:q.revision,candidateId:q.planning.candidates[0].id});assert.equal(r.status,400);
});
