import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {seedProject,cardKey} from '../model.mjs';

let child,dir,p;
const base='http://127.0.0.1:4404';
async function request(route,body,method='POST'){const response=await fetch(base+route,{method,headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});return {status:response.status,...await response.json()};}
async function get(){return (await request('/api/projects',null,'GET')).projects.find(q=>q.id===p.id);}
async function waitJob(id){for(let i=0;i<200;i++){const {job}=await request('/api/draft-jobs/'+id,null,'GET');if(['draft','logged_in','error','uncertain'].includes(job.status))return job;await new Promise(r=>setTimeout(r,15));}throw Error('job timeout');}
before(async()=>{
  dir=await fs.mkdtemp(path.join(os.tmpdir(),'studio-overseas-api-'));
  child=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,STUDIO_DATA_DIR:dir,STUDIO_PORT:'4404',STUDIO_DRAFT_DRIVER:'mock',STUDIO_X_ACCESS_TOKEN:'',STUDIO_SUBSTACK_URL:''},stdio:['ignore','pipe','pipe']});
  await new Promise((resolve,reject)=>{child.stdout.once('data',resolve);child.once('exit',code=>reject(Error('server exit '+code)));child.once('error',reject);});
  p=seedProject();p.id='overseas-test';for(const key of ['substack','x','threads'])Object.assign(p.platforms[key],{title:'Save a working version',body:'# One useful idea\n\nKeep a **working copy** before changing code.\n\n[GitHub docs](https://docs.github.com/)',tags:[]});
  p=(await request('/api/projects',p)).project;
});
after(async()=>{if(child?.exitCode===null){const exited=new Promise(r=>child.once('exit',r));child.kill();await exited;}if(dir)await fs.rm(dir,{recursive:true,force:true});});

test('海外草稿仍受审核、版本和平台边界约束',async()=>{
  let r=await request('/api/projects/'+p.id+'/overseas-draft',{revision:p.revision,platform:'threads',cardFingerprint:cardKey(p)});assert.equal(r.status,400);assert.match(r.error,/审核/);
  p=(await request('/api/projects/'+p.id+'/content-approve',{revision:p.revision})).project;
  p=(await request('/api/projects/'+p.id+'/cards-approve',{revision:p.revision,cardFingerprint:cardKey(p),viewedCount:p.content.cards.length})).project;
  r=await request('/api/projects/'+p.id+'/overseas-draft',{revision:p.revision-1,platform:'threads',cardFingerprint:cardKey(p)});assert.equal(r.status,409);
  r=await request('/api/projects/'+p.id+'/overseas-draft',{revision:p.revision,platform:'threads',cardFingerprint:'wrong'});assert.equal(r.status,400);
  assert.equal((await request('/api/projects/'+p.id+'/publish',{revision:p.revision})).status,404);
});
test('Threads 写入真实本机快照并复用，绝不标记远程草稿',async()=>{
  let r=await request('/api/projects/'+p.id+'/overseas-draft',{revision:p.revision,platform:'threads',cardFingerprint:cardKey(p)});assert.equal(r.status,200);assert.equal(r.queued,true);p=r.project;
  const delivery=p.platforms.threads.delivery;assert.equal(delivery.status,'queued_local');
  const files=await fs.readdir(path.join(dir,'overseas-queue',p.id));assert.equal(files.length,1);
  const snapshot=JSON.parse(await fs.readFile(path.join(dir,'overseas-queue',p.id,files[0]),'utf8'));assert.equal(snapshot.body,p.platforms.threads.body);assert.equal(snapshot.cardFingerprint,cardKey(p));
  r=await request('/api/projects/'+p.id+'/overseas-draft',{revision:p.revision,platform:'threads',cardFingerprint:cardKey(p)});assert.equal(r.reused,true);assert.equal((await fs.readdir(path.join(dir,'overseas-queue',p.id))).length,1);
  const original=cardKey(p);p.platforms.threads.body='A revised local idea';r=await request('/api/projects/'+p.id,p,'PUT');p=r.project;assert.equal(p.platforms.threads.delivery,null);assert.equal(p.platforms.threads.history.at(-1).status,'queued_local');assert.equal(cardKey(p),original);assert.ok(p.cardApproval);
});
test('X 未配置明确返回未连接，网页不提供写入凭证的入口',async()=>{
  const h=await request('/api/health',null,'GET');assert.equal(h.overseasConnections.x.status,'unconfigured');
  const c=await request('/api/overseas-connections/x/check',{});assert.equal(c.connection.status,'unconfigured');
  const r=await request('/api/projects/'+p.id+'/overseas-draft',{revision:p.revision,platform:'x',cardFingerprint:cardKey(p)});assert.equal(r.status,400);assert.match(r.error,/令牌|配置/);assert.equal((await get()).platforms.x.delivery,null);
  assert.equal((await request('/api/overseas-connections/x/config',{token:'no'})).status,404);
});
test('Substack 刊物 URL 严格校验，需先登录才能写入；模拟结果仅测试数据',async()=>{
  for(const url of ['https://substack.com.evil.example','http://valid.substack.com','https://user:pass@valid.substack.com','https://valid.substack.com/p/article'])assert.equal((await request('/api/overseas-connections/substack/config',{publicationUrl:url})).status,400);
  const r=await request('/api/overseas-connections/substack/config',{publicationUrl:'https://my-publication.substack.com/'});assert.equal(r.connection.publicationUrl,'https://my-publication.substack.com');
  assert.equal((await fs.stat(path.join(dir,'overseas-config.json'))).mode&0o777,0o600);
  const notLogged=await request('/api/projects/'+p.id+'/overseas-draft',{revision:p.revision,platform:'substack',cardFingerprint:cardKey(p)});assert.equal(notLogged.status,400);assert.match(notLogged.error,/登录/);
  const login=await request('/api/platform-sessions/substack/check',{});assert.equal((await waitJob(login.job.id)).status,'logged_in');
  const started=await request('/api/projects/'+p.id+'/overseas-draft',{revision:p.revision,platform:'substack',cardFingerprint:cardKey(p)});assert.equal(started.status,202);assert.equal((await waitJob(started.job.id)).status,'draft');
  p=await get();assert.equal(p.platforms.substack.delivery.status,'draft');assert.equal(p.platforms.substack.delivery.outcome,'created');
});
test('适配结果必须匹配当前源材料，导入不改核心审核',async()=>{
  const input=await request('/api/projects/'+p.id+'/overseas-input',null,'GET'),before=structuredClone(p.cardApproval);
  const platforms=Object.fromEntries(['substack','x','threads'].map(k=>[k,{title:'A useful version',body:'A localized, factual explanation.',tags:[]}]));
  const invalid=await request('/api/projects/'+p.id+'/overseas-import',{revision:p.revision,inputFingerprint:'wrong',platforms});assert.equal(invalid.status,400);
  const result=await request('/api/projects/'+p.id+'/overseas-import',{revision:p.revision,inputFingerprint:input.inputFingerprint,platforms});assert.equal(result.status,200);p=result.project;assert.deepEqual(p.cardApproval,before);assert.equal(p.platforms.substack.delivery,null);assert.equal(p.platforms.x.body,platforms.x.body);
});
