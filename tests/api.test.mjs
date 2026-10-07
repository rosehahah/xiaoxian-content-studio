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
before(async()=>{temp=await mkdtemp(path.join(os.tmpdir(),'xiaoxian-test-'));server=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,STUDIO_PORT:'4399',STUDIO_DATA_DIR:temp,STUDIO_DRAFT_DRIVER:'mock'},stdio:['ignore','pipe','pipe']});await new Promise((resolve,reject)=>{server.stdout.once('data',resolve);server.once('error',reject);server.once('exit',()=>reject(new Error('server stopped')));});p=(await (await req('/api/projects',null,'GET')).json()).projects[0];});
after(async()=>{server?.kill();await new Promise(r=>server.once('exit',r));await rm(temp,{recursive:true,force:true});});
test('未审核不能调用草稿接口，跨站请求被拒绝',async()=>{const r=await req('/api/projects/'+p.id+'/draft',{revision:p.revision,cardFingerprint:cardKey(p),images:[]});assert.equal(r.status,400);assert.match((await r.json()).error,/审核/);const cross=await req('/api/projects/'+p.id,{...p},'PUT',{Origin:'https://external.example'});assert.equal(cross.status,403);});
test('内容确认、逐图审核和版本冲突在服务端强制约束',async()=>{let r=await req('/api/projects/'+p.id+'/cards-approve',{revision:p.revision,cardFingerprint:cardKey(p),viewedCount:5});assert.equal(r.status,400);r=await req('/api/projects/'+p.id+'/content-approve',{revision:p.revision});p=(await r.json()).project;assert.equal(r.status,200);r=await req('/api/projects/'+p.id+'/cards-approve',{revision:p.revision,cardFingerprint:cardKey(p),viewedCount:4});assert.equal(r.status,400);r=await req('/api/projects/'+p.id+'/cards-approve',{revision:p.revision,cardFingerprint:cardKey(p),viewedCount:5});p=(await r.json()).project;assert.equal(r.status,200);const forged={...p,revision:p.revision-1};r=await req('/api/projects/'+p.id,forged,'PUT');assert.equal(r.status,409);p.content.cards[0].title='新的文字';r=await req('/api/projects/'+p.id,p,'PUT');p=(await r.json()).project;assert.equal(p.contentApproval,null);assert.equal(p.cardApproval,null);});
test('不存在正式发布端点，也不会让网页提交凭证',async()=>{const r=await req('/api/projects/'+p.id+'/publish',{revision:p.revision});assert.equal(r.status,404);const projects=await (await req('/api/projects',null,'GET')).json();assert.ok(!JSON.stringify(projects).includes('wechat_secret'));});
test('自动草稿任务只接受审核版本，并保存可核对状态',async()=>{
  let r=await req('/api/projects/'+p.id+'/content-approve',{revision:p.revision});p=(await r.json()).project;
  r=await req('/api/projects/'+p.id+'/cards-approve',{revision:p.revision,cardFingerprint:cardKey(p),viewedCount:p.content.cards.length});p=(await r.json()).project;
  r=await req('/api/platform-sessions/xiaohongshu/check',{});assert.equal(r.status,202);const loginStarted=await r.json();let loginJob;
  for(let i=0;i<20;i++){loginJob=(await (await req('/api/draft-jobs/'+loginStarted.job.id,null,'GET')).json()).job;if(loginJob.status==='logged_in')break;await new Promise(resolve=>setTimeout(resolve,20));}
  assert.equal(loginJob.status,'logged_in');const health=await (await req('/api/health',null,'GET')).json();assert.equal(health.platformSessions.xiaohongshu.status,'logged_in');
  const png=Buffer.alloc(24);Buffer.from('89504e470d0a1a0a','hex').copy(png);png.writeUInt32BE(1080,16);png.writeUInt32BE(1440,20);
  r=await req('/api/projects/'+p.id+'/draft-job',{revision:p.revision,platform:'xiaohongshu',cardFingerprint:cardKey(p),images:p.content.cards.map(()=>`data:image/png;base64,${png.toString('base64')}`)});
  assert.equal(r.status,202);const started=await r.json();assert.equal(started.job.platform,'xiaohongshu');assert.equal('imageFiles' in started.job,false);
  let job;for(let i=0;i<20;i++){job=(await (await req('/api/draft-jobs/'+started.job.id,null,'GET')).json()).job;if(job.status==='draft')break;await new Promise(resolve=>setTimeout(resolve,20));}
  assert.equal(job.status,'draft');p=(await (await req('/api/projects',null,'GET')).json()).projects.find(x=>x.id===p.id);assert.equal(p.platforms.xiaohongshu.delivery.status,'draft');
});

test('真人生图输入缺照片时拒绝，导入结果必须匹配当前版本',async()=>{
 const {seedProject}=await import('../model.mjs');const {newCreative}=await import('../creative.mjs');
 let q=seedProject();q.id='portrait-flow';q.visual.creative=newCreative('portrait');
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
