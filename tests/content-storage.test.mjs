import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {ensureContentFields,validateContentFields,migrateProjects} from '../content-schema.mjs';
import {diskPreflight,atomicWriteJson,loadProjectDatabase,decodeImage,storeAsset,readAsset} from '../content-storage.mjs';

const hash=b=>createHash('sha256').update(b).digest('hex');
const png=()=>{const b=Buffer.alloc(24);Buffer.from('89504e470d0a1a0a','hex').copy(b);b.writeUInt32BE(1,16);b.writeUInt32BE(1,20);return b;};
const data=(b,mime='image/png')=>'data:'+mime+';base64,'+b.toString('base64');
const project=()=>ensureContentFields({schema:2,id:'storage-fixture',revision:0,content:{topic:'fixture',cards:[]},visual:{theme:'sage',layout:'airy'},platforms:{wechat:{title:'',body:'',tags:[]}}});
async function fixture(t){const local=await fs.mkdtemp(path.join(os.tmpdir(),'studio-storage-unit-'));t.after(()=>fs.rm(local,{recursive:true,force:true}));return local;}
const options={seed:project,migrate:migrateProjects,validate:validateContentFields};

test('schema1 migration writes a byte-exact backup and is idempotent',async t=>{
 const local=await fixture(t),file=path.join(local,'projects.json'),old=project();old.schema=1;old.extra={preserve:'unknown'};old.contentApproval={fingerprint:'old-content'};
 const raw=JSON.stringify([old],null,1)+'\n';await fs.writeFile(file,raw);const first=await loadProjectDatabase(file,options);
 assert.equal(first.migrated,true);assert.equal(await fs.readFile(first.backup,'utf8'),raw);assert.deepEqual(first.projects[0].extra,old.extra);assert.deepEqual(first.projects[0].contentApproval,old.contentApproval);
 const migrated=await fs.readFile(file,'utf8'),second=await loadProjectDatabase(file,options);assert.equal(second.migrated,false);assert.equal(second.backup,null);assert.equal(await fs.readFile(file,'utf8'),migrated);assert.equal((await fs.readdir(path.join(local,'backups'))).length,1);
});
test('corrupt JSON, a non-array database and future schemas preserve original bytes',async t=>{
 const local=await fixture(t),file=path.join(local,'projects.json');for(const raw of ['{broken','{"projects":[]}',JSON.stringify([{...project(),schema:99}])]){await fs.writeFile(file,raw);await assert.rejects(loadProjectDatabase(file,options));assert.equal(await fs.readFile(file,'utf8'),raw);}
 assert.equal((await fs.readdir(local)).includes('backups'),false);
});
test('validation failures occur before backup or database replacement',async t=>{
 const local=await fixture(t),file=path.join(local,'projects.json'),p=project();p.schema=1;const raw=JSON.stringify([p]);await fs.writeFile(file,raw);
 await assert.rejects(loadProjectDatabase(file,{...options,validate:()=>{throw Error('deliberate validation failure');}}),/deliberate/);assert.equal(await fs.readFile(file,'utf8'),raw);assert.deepEqual(await fs.readdir(local),['projects.json']);
});
test('missing database seeds only in memory; malformed databases never fall back to seed',async t=>{
 const local=await fixture(t),file=path.join(local,'projects.json');let seeded=0;
 const o={...options,seed:()=>{seeded++;return project();}};const created=await loadProjectDatabase(file,o);assert.equal(created.newDatabase,true);assert.equal(seeded,1);await assert.rejects(fs.access(file));
 await fs.writeFile(file,'not-json');await assert.rejects(loadProjectDatabase(file,o));assert.equal(seeded,1);
});
test('disk preflight rejects an impossible expected allocation without allocating files',async t=>{
 const local=await fixture(t),before=await fs.readdir(local);await assert.rejects(diskPreflight(local,{expectedBytes:Number.MAX_SAFE_INTEGER}),e=>e.status===507&&e.code==='STUDIO_DISK_FULL');assert.deepEqual(await fs.readdir(local),before);
});
test('atomic rename failure leaves the original intact and removes the temporary file',async t=>{
 const local=await fixture(t),file=path.join(local,'original.json'),original='{"still":"safe"}\n';await fs.writeFile(file,original);const rename=fs.rename;
 const stub=t.mock.method(fs,'rename',async(from,to)=>{if(to===file)throw Object.assign(Error('simulated rename failure'),{code:'EIO'});return rename(from,to);});
 try{await assert.rejects(atomicWriteJson(file,{replacement:true}),/simulated/);}finally{stub.mock.restore();}
 assert.equal(await fs.readFile(file,'utf8'),original);assert.deepEqual(await fs.readdir(local),['original.json']);await atomicWriteJson(file,{retry:true});assert.deepEqual(JSON.parse(await fs.readFile(file,'utf8')),{retry:true});
});
test('failed migration replacement leaves the old database and a usable backup',async t=>{
 const local=await fixture(t),file=path.join(local,'projects.json'),p=project();p.schema=1;const raw=JSON.stringify([p]);await fs.writeFile(file,raw);const rename=fs.rename;
 const stub=t.mock.method(fs,'rename',async(from,to)=>{if(to===file)throw Error('migration rename failure');return rename(from,to);});
 try{await assert.rejects(loadProjectDatabase(file,options),/migration rename failure/);}finally{stub.mock.restore();}
 assert.equal(await fs.readFile(file,'utf8'),raw);const backups=await fs.readdir(path.join(local,'backups'));assert.equal(backups.length,1);assert.equal(await fs.readFile(path.join(local,'backups',backups[0]),'utf8'),raw);
});
test('concurrent atomic writes serialize into a complete document',async t=>{
 const local=await fixture(t),file=path.join(local,'concurrent.json');await Promise.all([atomicWriteJson(file,{version:1}),atomicWriteJson(file,{version:2}),atomicWriteJson(file,{version:3})]);assert.deepEqual(JSON.parse(await fs.readFile(file,'utf8')),{version:3});assert.equal((await fs.stat(file)).mode&0o777,0o600);assert.equal((await fs.readdir(local)).some(n=>n.endsWith('.tmp')),false);
});
test('registered PNG and GIF retain exact bytes and deduplicate without exposing paths',async t=>{
 const local=await fixture(t),p=project(),bytes=png();const first=await storeAsset(local,p,{data:data(bytes),mimeType:'image/png',name:'real.png'});assert.equal(first.reused,false);assert.equal(first.asset.sha256,hash(bytes));assert.deepEqual((await readAsset(local,p,first.asset.id)).data,bytes);assert.equal((await storeAsset(local,p,{data:data(bytes),mimeType:'image/png'})).reused,true);
 const gif=Buffer.from('47494638396101000100800000000000ffffff21f90400000000002c00000000010001000002024401003b','hex');const stored=await storeAsset(local,p,{data:data(gif,'image/gif'),mimeType:'image/gif'});assert.equal(stored.asset.mimeType,'image/gif');assert.equal(stored.asset.relativePath.endsWith('.gif'),true);assert.deepEqual((await readAsset(local,p,stored.asset.id)).data,gif);
 assert.throws(()=>decodeImage(data(bytes),'image/gif'),/只接受/);assert.throws(()=>decodeImage(data(Buffer.alloc(24)),'image/png'),/不一致/);
});
test('path traversal, descendant symlinks and modified asset bytes are rejected',async t=>{
 const local=await fixture(t),p=project(),bytes=png(),{asset}=await storeAsset(local,p,{data:data(bytes),mimeType:'image/png'}),original=asset.relativePath;
 const outside=path.join(local,'outside.png');await fs.writeFile(outside,bytes);asset.relativePath='outside.png';await assert.rejects(readAsset(local,p,asset.id),/登记目录/);
 const link=path.join(local,'assets',p.id,'link.png');await fs.symlink(outside,link);asset.relativePath=path.relative(local,link);await assert.rejects(readAsset(local,p,asset.id),/登记目录外/);
 asset.relativePath=original;await fs.writeFile(path.join(local,original),Buffer.from('changed bytes'));await assert.rejects(readAsset(local,p,asset.id),/已改变/);
});
test('a symlinked project asset root cannot authorize files outside the local asset store',async t=>{
 const local=await fixture(t),p=project(),bytes=png(),outside=path.join(local,'private-outside');await fs.mkdir(outside);await fs.writeFile(path.join(outside,'image.png'),bytes);await fs.mkdir(path.join(local,'assets'));await fs.symlink(outside,path.join(local,'assets',p.id));p.sourceBundle.assets.push({id:'outside',sha256:hash(bytes),mimeType:'image/png',relativePath:path.join('assets',p.id,'image.png')});await assert.rejects(readAsset(local,p,'outside'),/目录|符号|symlink/i);
});
test('reuploading an asset never claims successful reuse of missing or tampered bytes',async t=>{
 for(const remove of [false,true]){
  const local=await fixture(t),p=project(),bytes=png(),input={data:data(bytes),mimeType:'image/png'},first=await storeAsset(local,p,input),file=path.join(local,first.asset.relativePath);
  if(remove)await fs.unlink(file);else await fs.writeFile(file,'tampered');
  let result;try{result=await storeAsset(local,p,input);}catch(error){assert.match(error.message,/改变|不存在|ENOENT|登记|修复|missing/i);continue;}
  assert.deepEqual((await readAsset(local,p,result.asset.id)).data,bytes,'reported success must identify intact registered bytes');
 }
});
test('EEXIST content is verified before registration, and conflicting bytes are preserved',async t=>{
 const local=await fixture(t),p=project(),bytes=png(),digest=hash(bytes),file=path.join(local,'assets',p.id,digest+'.png');await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,'unrelated existing bytes');
 await assert.rejects(storeAsset(local,p,{data:data(bytes),mimeType:'image/png'}),/改变|不同|一致|登记|冲突/);assert.equal(await fs.readFile(file,'utf8'),'unrelated existing bytes');assert.equal(p.sourceBundle.assets.length,0);
 await fs.writeFile(file,bytes);const restored=await storeAsset(local,p,{data:data(bytes),mimeType:'image/png'});assert.equal(p.sourceBundle.assets.length,1);assert.deepEqual((await readAsset(local,p,restored.asset.id)).data,bytes);
});
