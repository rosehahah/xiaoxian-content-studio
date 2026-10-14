import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {pathToFileURL,fileURLToPath} from 'node:url';
import JSZip from 'jszip';
import {ensureContentFields,migrateProjects} from '../content-schema.mjs';
import {articleHash,variantHash,patchArticle,approveArticle,updateSources,variantInput,importVariants,approveVariant} from '../content-domain.mjs';
import {platformProfile,profileStatus,PROFILE_VERSION} from '../content-profiles.mjs';
import {storeAsset,diskPreflight} from '../content-storage.mjs';
import {EXECUTION_VERSIONS,buildContentPackage} from '../content-delivery.mjs';
import {createContentRouter,publicContentProject} from '../content-server.mjs';

const root=fileURLToPath(new URL('..',import.meta.url));
const profileFile=path.join(root,'.agents/skills/xiaoxian-longform/references/platform-profiles.json');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9N8AAAAASUVORK5CYII=','base64');
const project=()=>ensureContentFields({schema:2,id:'boundary-fixture',revision:0,content:{topic:'合成材料',cards:[]},visual:{theme:'sage',layout:'airy'},platforms:{wechat:{title:'',body:'',tags:[]}}});
async function fixture(t){const local=await fs.mkdtemp(path.join(os.tmpdir(),'studio-boundary-review-'));t.after(()=>fs.rm(local,{recursive:true,force:true}));return local;}
async function approved(local){const p=project(),{asset}=await storeAsset(local,p,{data:'data:image/png;base64,'+png.toString('base64'),mimeType:'image/png',caption:'原始已审图注'});patchArticle(p,{title:'合成长文',bodyMd:'![图](asset:'+asset.id+')',assets:[]});approveArticle(p,articleHash(p));p.article.approval.rendererVersion=EXECUTION_VERSIONS.converterVersion;return {p,asset};}
function response(){return {status:null,headers:null,bytes:null,json:null,writeHead(status,headers){this.status=status;this.headers=headers;},end(bytes){this.bytes=bytes;}};}
function context(p,local,persist=async()=>{}){return {projects:[p],local,origin:'http://localhost:9990',readBody:async req=>req.body,json:(res,status,json)=>{res.status=status;res.json=structuredClone(json);},persist,stamp:x=>{x.revision++;},requireRevision:(x,body)=>{if(body.revision!==x.revision)throw Object.assign(Error('stale revision'),{status:409});},busy:new Set()};}
const url=route=>new URL(route,'http://localhost:9990');

test('valid unfinished schema1 card drafts migrate without forcing content approval',()=>{
 const p=project();p.schema=1;p.content.cards=[{kind:'editorial',eyebrow:'',title:'',body:'',note:''}];p.custom={future:'keep'};const old=structuredClone(p),[migrated]=migrateProjects([p]);assert.deepEqual(p,old);assert.equal(migrated.schema,2);assert.deepEqual(migrated.content.cards,old.content.cards);assert.deepEqual(migrated.custom,old.custom);assert.equal(migrated.article.approval,null);
});

test('GET ZIP export takes the same project lock as POST mutation and freezes the registry',async t=>{
 const local=await fixture(t),{p}=await approved(local);let entered,release;const enteredGate=new Promise(r=>entered=r),releaseGate=new Promise(r=>release=r);let calls=0;
 const router=createContentRouter(context(p,local,async()=>{if(++calls===1){entered();await releaseGate;}}));
 const res=response(),exporting=router({method:'GET'},res,url('/api/projects/'+p.id+'/export?format=zip'));
 await Promise.race([enteredGate,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('export barrier timeout')),3000);timer.unref();})]);
 try{await assert.rejects(router({method:'PATCH',body:{revision:p.revision,article:{title:'并发新标题'}}},response(),url('/api/projects/'+p.id+'/article')),e=>e.status===409);}finally{release();}
 await exporting;assert.equal(res.status,200);assert.equal(p.article.title,'合成长文');assert.equal(p.deliveries.length,1);assert.equal(p.deliveries[0].status,'local_ready');const zip=await JSZip.loadAsync(res.bytes);assert.match(await zip.file('article.html').async('string'),/原始已审图注/);
});

test('HTML export keeps the pre-await approved source and asset-caption snapshot',async t=>{
 const local=await fixture(t),{p,asset}=await approved(local),res=response(),router=createContentRouter(context(p,local));const exporting=router({method:'GET'},res,url('/api/projects/'+p.id+'/export?format=html'));
 const changed=structuredClone(p.sourceBundle);changed.assets.find(a=>a.id===asset.id).caption='后续图注';updateSources(p,changed);await exporting;
 assert.match(res.bytes,/原始已审图注/);assert.equal(res.bytes.includes('后续图注'),false);assert.equal(p.article.approval,null);
});
test('standalone Markdown export rewrites registered asset IDs into usable embedded images',async t=>{
 const local=await fixture(t),{p}=await approved(local),res=response(),router=createContentRouter(context(p,local));await router({method:'GET'},res,url('/api/projects/'+p.id+'/export?format=markdown'));assert.equal(res.status,200);assert.equal(res.bytes.includes('asset:'),false);assert.match(res.bytes,/data:image\/png;base64,/);
});

test('generic project POST and PUT reject nested credential keys before persistence',async t=>{
 const local=await fixture(t),listener=net.createServer();listener.listen(0,'127.0.0.1');await once(listener,'listening');const port=listener.address().port;await new Promise(r=>listener.close(r));
 const env={...process.env,STUDIO_DATA_DIR:local,STUDIO_PORT:String(port)};for(const key of ['STUDIO_DRAFT_DRIVER','WECHAT_APPID','WECHAT_SECRET','STUDIO_X_ACCESS_TOKEN','STUDIO_SUBSTACK_URL'])delete env[key];
 const child=spawn(process.execPath,['server.mjs'],{cwd:root,env,stdio:['ignore','pipe','pipe']});let output='',errors='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>errors+=b);
 t.after(async()=>{if(child.exitCode===null){const ended=once(child,'exit');child.kill();await ended;}});
 for(let i=0;i<200&&!output.includes('localhost:'+port);i++){if(child.exitCode!==null)throw Error(errors);await new Promise(r=>setTimeout(r,15));}assert.ok(output.includes('localhost:'+port),errors);
 const origin='http://localhost:'+port,initial=await(await fetch(origin+'/api/projects')).json(),p=initial.projects[0];delete p.runtime;
 for(const key of ['api_key','access_token','token','secret','password','cookie'])for(const [method,route] of [['POST','/api/projects'],['PUT','/api/projects/'+p.id]]){
  const body={...p,id:method==='POST'?'credential-'+key:p.id,privateConfig:{[key]:'FAKE_REVIEW_CREDENTIAL'}};const res=await fetch(origin+route,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});assert.equal(res.status,422,key+' '+method);assert.match((await res.json()).error,/凭证/);
 }
 assert.equal((await fs.readFile(path.join(local,'projects.json'),'utf8')).includes('FAKE_REVIEW_CREDENTIAL'),false);
 const clean={...p,id:'unknown-field-preserved',futureNotes:{meaning:'allowed unknown metadata'}};const created=await fetch(origin+'/api/projects',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(clean)});assert.equal(created.status,201);assert.deepEqual((await created.json()).project.futureNotes,clean.futureNotes);
});

test('profile recheck dates are local policy, and all profile states keep remote execution disabled',()=>{
 const profile=platformProfile('linkedin'),checked=new Date(profile.verifiedDate+'T00:00:00Z'),fresh=profileStatus('linkedin',new Date(checked.getTime()+86400000)),expired=profileStatus('linkedin',new Date(checked.getTime()+31*86400000));assert.equal(fresh.status,'documentation_checked_account_unverified');assert.equal(expired.status,'needs_recheck');assert.equal(expired.mode,'export_only');assert.equal(expired.remoteEnabled,false);assert.equal(profileStatus('missing-channel').status,'unverified');assert.equal(profileStatus('missing-channel').remoteEnabled,false);
});

test('platform tasks contain only the selected full profiles and their declared version',()=>{
 const p=project();patchArticle(p,{title:'结果',bodyMd:'完整内容'});approveArticle(p,articleHash(p));p.selectedChannels.overseas=['linkedin'];const input=variantInput(p,[{channel:'linkedin',format:'post',locale:'en'}],p.article.id);assert.deepEqual(input.profiles.map(x=>x.id),['linkedin']);assert.deepEqual(input.profiles[0],platformProfile('linkedin'));assert.equal(input.profileVersion,PROFILE_VERSION);assert.ok(input.prompt.includes(JSON.stringify(platformProfile('linkedin'))));assert.equal(input.profiles.some(x=>x.id==='substack'),false);
});

test('a changed active profile invalidates both variant approval hash and outstanding task fingerprints',async t=>{
 const local=await fixture(t);await diskPreflight(local,{expectedBytes:300000});const registry=JSON.parse(await fs.readFile(profileFile,'utf8'));
 async function modules(name,nextRegistry){const dir=path.join(local,name),refs=path.join(dir,'.agents/skills/xiaoxian-longform/references');await fs.mkdir(refs,{recursive:true});for(const file of ['content-schema.mjs','content-domain.mjs','content-profiles.mjs','article-render.mjs'])await fs.copyFile(path.join(root,file),path.join(dir,file));await fs.writeFile(path.join(refs,'platform-profiles.json'),JSON.stringify(nextRegistry));return import(pathToFileURL(path.join(dir,'content-domain.mjs')).href);}
 const changed=structuredClone(registry);changed.platforms.find(x=>x.id==='linkedin').contentStandards.push('synthetic profile v2 recheck');const a=await modules('profile-v1',registry),b=await modules('profile-v2',changed),p=project();a.patchArticle(p,{title:'事实',bodyMd:'正文'});a.approveArticle(p,a.articleHash(p));p.selectedChannels.overseas=['linkedin'];const keys=[{id:'linkedin-profile-fixture',channel:'linkedin',format:'post',locale:'en'}],task=a.variantInput(p,keys,p.article.id);a.importVariants(p,{revision:p.revision,inputFingerprint:task.inputFingerprint,keys:task.keys,sourceWorkId:p.article.id,variants:[{...keys[0],profileVersion:PROFILE_VERSION,title:'Lesson',bodyMd:'A useful lesson.',assets:[],sourceDeps:[]}]});a.approveVariant(p,keys[0].id,a.variantHash(p,p.variants[0]));
 assert.notEqual(a.variantHash(p,p.variants[0]),b.variantHash(p,p.variants[0]));assert.equal(b.variantApproved(p,p.variants[0]),false);assert.notEqual(a.variantInput(p,keys,p.article.id).inputFingerprint,b.variantInput(p,keys,p.article.id).inputFingerprint);
});

test('ZIP preserves AI disclosure, fact/source boundaries and explicitly unverified asset rights',async t=>{
 const local=await fixture(t),{p,asset}=await approved(local);updateSources(p,{...p.sourceBundle,sources:[{id:'private-source',locator:'synthetic-private.md',text:'PRIVATE_SOURCE_TEXT_ONLY',verification:'verified',publicScope:'reference_only'}],facts:[{id:'bounded-fact',statement:'仅此合成样例可复现',verification:'verified',provenance:'user_reported',scope:'single_synthetic_example',sourceRefs:[{sourceId:'private-source',anchor:'section'}]}]});patchArticle(p,{sourceDeps:[{factId:'bounded-fact'}]});approveArticle(p,articleHash(p));p.selectedChannels.overseas=['linkedin'];const keys=[{id:'linkedin-boundaries',channel:'linkedin',format:'post',locale:'en'}],task=variantInput(p,keys,p.article.id),disclosure={status:'author_confirmed',text:'Created with AI assistance; facts reviewed by the author.'};importVariants(p,{revision:p.revision,inputFingerprint:task.inputFingerprint,keys:task.keys,sourceWorkId:p.article.id,variants:[{...keys[0],profileVersion:PROFILE_VERSION,title:'A bounded lesson',bodyMd:'A synthetic example.\n\n![Proof](asset:'+asset.id+')',assets:[],sourceDeps:[{factId:'bounded-fact'}],aiDisclosure:disclosure}]});const v=p.variants[0];approveVariant(p,v.id,variantHash(p,v));const pkg=await buildContentPackage(local,p,v,{artifactHash:variantHash(p,v),deliveryId:'rights-fixture'}),zip=await JSZip.loadAsync(await fs.readFile(path.join(local,pkg.relativePath))),boundaries=JSON.parse(await zip.file('来源与使用边界.json').async('string')),profile=JSON.parse(await zip.file('平台档案.json').async('string'));
 assert.deepEqual(boundaries.aiDisclosure,disclosure);assert.equal(boundaries.facts[0].scope,'single_synthetic_example');assert.equal(boundaries.facts[0].provenance,'user_reported');assert.equal(boundaries.facts[0].sources[0].publicScope,'reference_only');assert.equal(boundaries.assets[0].usageRightsStatus,'unverified');assert.equal(profile.capability.remoteEnabled,false);assert.ok((await zip.file('配文.txt').async('string')).includes(disclosure.text));assert.equal(JSON.stringify(boundaries).includes('PRIVATE_SOURCE_TEXT_ONLY'),false);assert.equal(JSON.stringify(publicContentProject(p).runtime.profiles[v.id]).includes('export_only'),true);
});
