import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {seedProject,contentKey,cardKey} from '../model.mjs';

const root=fileURLToPath(new URL('..',import.meta.url));
const local=await fs.mkdtemp(path.join(os.tmpdir(),'xiaoxian-overseas-recovery-'));
const origin='http://localhost:4406';
const fakeToken='test-only-token-not-a-real-user-credential';
let child,output='';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));

function fixture(){
  const p=seedProject();p.id='overseas-recovery-test';p.content.topic='TEST fixture — never production';
  p.contentApproval={fingerprint:contentKey(p),at:'2026-10-15T00:00:00.000Z',by:'test'};
  p.cardApproval={fingerprint:cardKey(p),at:'2026-10-15T00:01:00.000Z',by:'test'};
  p.stage='drafts';
  p.platforms.substack={title:'A test checkpoint',subtitle:'',body:'Only a mocked draft in an isolated test directory.',tags:[],delivery:null};
  return p;
}
async function stop(){
  if(!child)return;
  const current=child;child=null;
  if(current.exitCode!==null)return;
  const exited=new Promise(resolve=>current.once('exit',resolve));current.kill('SIGTERM');
  await Promise.race([exited,pause(1500)]);
  if(current.exitCode===null){current.kill('SIGKILL');await Promise.race([exited,pause(1000)]);}
}
async function call(route,body,method=body===undefined?'GET':'POST'){
  const response=await fetch(origin+route,{method,headers:body===undefined?{}:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(7000)});
  return {status:response.status,data:await response.json()};
}
async function start(p,{config}={}){
  await stop();await fs.rm(path.join(local,'draft-jobs'),{recursive:true,force:true});
  await fs.writeFile(path.join(local,'projects.json'),JSON.stringify([p]));
  if(config===undefined)await fs.rm(path.join(local,'overseas-config.json'),{force:true});
  else await fs.writeFile(path.join(local,'overseas-config.json'),typeof config==='string'?config:JSON.stringify(config),{mode:0o600});
  output='';
  child=spawn(process.execPath,['server.mjs'],{cwd:root,env:{PATH:process.env.PATH,STUDIO_PORT:'4406',STUDIO_DATA_DIR:local,STUDIO_DRAFT_DRIVER:'mock',STUDIO_X_ACCESS_TOKEN:'',STUDIO_SUBSTACK_URL:'',WECHAT_APPID:'',WECHAT_SECRET:''},stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',chunk=>output+=chunk.toString());child.stderr.on('data',chunk=>output+=chunk.toString());
  const deadline=Date.now()+10000;
  while(Date.now()<deadline){
    if(child.exitCode!==null)throw Error('Isolated test server exited: '+output);
    try{const result=await call('/api/projects');if(result.status===200&&result.data.projects?.[0]?.id===p.id)return;}catch{}
    await pause(50);
  }
  throw Error('Isolated test server failed to start: '+output);
}
async function current(){const result=await call('/api/projects');assert.equal(result.status,200);return result.data.projects[0];}
async function terminal(jobId){
  const deadline=Date.now()+5000;
  while(Date.now()<deadline){
    const result=await call('/api/draft-jobs/'+jobId);assert.equal(result.status,200);
    if(['draft','error','uncertain','needs_attention','logged_in'].includes(result.data.job.status))return result.data.job;
    await pause(30);
  }
  throw Error('Mock task did not reach a terminal state');
}
async function login(){const result=await call('/api/platform-sessions/substack/check',{});assert.equal(result.status,202);assert.equal((await terminal(result.data.job.id)).status,'logged_in');}
async function createDraft(){const p=await current();return call('/api/projects/'+p.id+'/overseas-draft',{revision:p.revision,platform:'substack',cardFingerprint:cardKey(p)});}

after(async()=>{await stop();await fs.rm(local,{recursive:true,force:true});});

test('bad optional overseas configuration leaves local projects and domestic session checks available',{timeout:25000},async()=>{
  const p=fixture();await start(p,{config:'{not valid json'});
  const health=await call('/api/health');assert.equal(health.status,200);assert.equal(health.data.mode,'local');
  assert.equal(health.data.draftAutomation,true);assert.equal(health.data.overseasConnections.x.status,'unavailable');
  assert.equal((await current()).id,p.id);
  const domestic=await call('/api/platform-sessions/xiaohongshu/check',{});assert.equal(domestic.status,202);
  assert.equal((await terminal(domestic.data.job.id)).status,'logged_in');
});

test('restart preserves an unknown draft sentinel through editing and only manual confirmation resolves it',{timeout:25000},async()=>{
  const p=fixture();p.platforms.substack.delivery={status:'opening',outcome:'unknown',jobId:'interrupted-before-result',destination:'https://test-one.substack.com',deliveryKey:'uncertain-original'};
  await start(p,{config:{substackPublicationUrl:'https://test-one.substack.com'}});
  let saved=await current();assert.equal(saved.platforms.substack.delivery.status,'uncertain');
  let retry=await createDraft();assert.equal(retry.status,400);assert.match(retry.data.error,/结果未知/);
  saved.platforms.substack.body+=' A revised paragraph.';
  const edited=await call('/api/projects/'+saved.id,saved,'PUT');assert.equal(edited.status,200);
  saved=edited.data.project;assert.equal(saved.platforms.substack.delivery,null);
  assert.equal(saved.platforms.substack.history[0].outcome,'unknown');
  retry=await createDraft();assert.equal(retry.status,400);assert.match(retry.data.error,/结果未知/);
  const manual=await call('/api/projects/'+saved.id+'/manual-draft',{revision:saved.revision,platform:'substack'});assert.equal(manual.status,200);
  assert.equal(manual.data.project.platforms.substack.delivery.status,'manual');
  assert.ok(manual.data.project.platforms.substack.history[0].resolvedAt);
  await login();retry=await createDraft();assert.equal(retry.status,200);assert.equal(retry.data.reused,true);
});

test('changing Substack destination creates a new mock draft and retains the previous destination record',{timeout:25000},async()=>{
  await start(fixture(),{config:{substackPublicationUrl:'https://test-one.substack.com'}});await login();
  const first=await createDraft();assert.equal(first.status,202);assert.equal((await terminal(first.data.job.id)).status,'draft');
  let p=await current();const firstDelivery=p.platforms.substack.delivery;
  assert.equal(firstDelivery.destination,'https://test-one.substack.com');
  const duplicate=await createDraft();assert.equal(duplicate.status,200);assert.equal(duplicate.data.reused,true);
  const config=await call('/api/overseas-connections/substack/config',{publicationUrl:'https://test-two.substack.com'});assert.equal(config.status,200);await login();
  const second=await createDraft();assert.equal(second.status,202);assert.ok(second.data.job);assert.notEqual(second.data.job.id,first.data.job.id);
  assert.equal((await terminal(second.data.job.id)).status,'draft');p=await current();
  assert.equal(p.platforms.substack.delivery.destination,'https://test-two.substack.com');
  assert.notEqual(p.platforms.substack.delivery.deliveryKey,firstDelivery.deliveryKey);
  assert.ok(p.platforms.substack.history.some(d=>d.deliveryKey===firstDelivery.deliveryKey&&d.destination==='https://test-one.substack.com'));
});

test('publication changes preserve a private test token without exposing it in health, projects or responses',{timeout:25000},async()=>{
  await start(fixture(),{config:{xAccessToken:fakeToken,substackPublicationUrl:'https://test-one.substack.com'}});
  const config=await call('/api/overseas-connections/substack/config',{publicationUrl:'https://test-two.substack.com'});assert.equal(config.status,200);
  const disk=JSON.parse(await fs.readFile(path.join(local,'overseas-config.json'),'utf8'));
  assert.equal(disk.xAccessToken,fakeToken);assert.equal(disk.substackPublicationUrl,'https://test-two.substack.com');
  assert.equal((await fs.stat(path.join(local,'overseas-config.json'))).mode&0o777,0o600);
  const health=await call('/api/health'),projects=await call('/api/projects');
  assert.equal(health.status,200);assert.equal(health.data.overseasConnections.x.configured,true);
  assert.equal(JSON.stringify([config.data,health.data,projects.data]).includes(fakeToken),false);
  assert.equal(output.includes(fakeToken),false);
});
