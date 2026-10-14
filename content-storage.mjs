import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';

const queues=new Map();
export async function diskPreflight(directory,{expectedBytes=0,backupBytes=0,reserveBytes=1024*1024*1024}={}){
  const stat=await fs.statfs(directory);
  const available=Number(stat.bavail)*Number(stat.bsize);
  const required=Math.max(0,expectedBytes)+Math.max(0,backupBytes)+reserveBytes;
  if(available<required){const e=new Error('磁盘空间不足：需要约 '+Math.ceil(required/1048576)+' MiB，可用 '+Math.floor(available/1048576)+' MiB。未删除任何文件。');e.status=507;e.code='STUDIO_DISK_FULL';throw e;}
  return {availableBytes:available,requiredBytes:required};
}
export async function atomicWriteJson(file,value){
  const text=JSON.stringify(value,null,2)+'\n';
  const previous=queues.get(file)||Promise.resolve();
  const task=previous.catch(()=>{}).then(async()=>{
    await fs.mkdir(path.dirname(file),{recursive:true});
    await diskPreflight(path.dirname(file),{expectedBytes:Buffer.byteLength(text)*2});
    const temp=file+'.'+randomUUID()+'.tmp';
    let handle;
    try{handle=await fs.open(temp,'wx',0o600);await handle.writeFile(text);await handle.sync();await handle.close();handle=null;await fs.rename(temp,file);}
    catch(error){await handle?.close().catch(()=>{});await fs.unlink(temp).catch(()=>{});throw error;}
  });
  queues.set(file,task);
  try{await task;}finally{if(queues.get(file)===task)queues.delete(file);}
}
export async function loadProjectDatabase(file,{seed,migrate,validate}){
  let raw;
  try{raw=await fs.readFile(file,'utf8');}
  catch(e){if(e.code!=='ENOENT')throw e;const projects=[validate(seed())];return {projects,migrated:false,backup:null,newDatabase:true};}
  let original;
  try{original=JSON.parse(raw);}catch{throw new Error('项目数据无法解析，原文件已保留：'+file);}
  if(!Array.isArray(original))throw new Error('项目数据不是数组，原文件已保留：'+file);
  const projects=migrate(original);
  if(!Array.isArray(projects))throw new Error('迁移返回格式错误，原文件未修改');
  for(const project of projects)validate(project);
  const migrated=original.some(p=>p.schema===1);
  let backup=null;
  if(migrated){
    await diskPreflight(path.dirname(file),{expectedBytes:Buffer.byteLength(JSON.stringify(projects))*2,backupBytes:Buffer.byteLength(raw)});
    const dir=path.join(path.dirname(file),'backups');await fs.mkdir(dir,{recursive:true});
    backup=path.join(dir,'projects-schema1-'+Date.now()+'-'+randomUUID()+'.json');
    await fs.writeFile(backup,raw,{flag:'wx',mode:0o600});
    await atomicWriteJson(file,projects);
  }
  return {projects,migrated,backup,newDatabase:false};
}
export function decodeImage(data,mimeType){
  const match=typeof data==='string'&&data.match(/^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/]+={0,2})$/);
  if(!match||match[1]!==mimeType)throw new Error('只接受 PNG、JPEG、WebP 或 GIF 图片');
  const bytes=Buffer.from(match[2],'base64');
  if(bytes.length>8*1024*1024||bytes.length<12)throw new Error('图片须为8MiB以内的有效文件');
  const valid=mimeType==='image/png'?bytes.subarray(0,8).toString('hex')==='89504e470d0a1a0a':
    mimeType==='image/jpeg'?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:
    mimeType==='image/gif'?['GIF87a','GIF89a'].includes(bytes.subarray(0,6).toString()):
    bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP';
  if(!valid)throw new Error('图片内容与类型不一致');
  return bytes;
}
export async function storeAsset(local,p,input){
  const mimeType=input.mimeType||input.mime;
  const bytes=decodeImage(input.data,mimeType);
  const sha256=createHash('sha256').update(bytes).digest('hex');
  const found=p.sourceBundle.assets.find(a=>a.sha256===sha256);
  if(found){try{await readAsset(local,p,found.id);}catch{throw new Error('已登记素材文件缺失或改变，请先检查本机素材，不能复用损坏文件');}return {asset:found,reused:true};}
  const total=p.sourceBundle.assets.reduce((sum,a)=>sum+(a.bytes||0),0);
  if(p.sourceBundle.assets.length>=40||total+bytes.length>100*1024*1024)throw new Error('本期素材达到本机容量上限，请另建一期或移除不用的引用');
  const ext={'image/png':'png','image/jpeg':'jpg','image/gif':'gif','image/webp':'webp'}[mimeType];
  const id='asset-'+sha256.slice(0,24),relativePath=path.join('assets',p.id,sha256+'.'+ext);
  const file=path.join(local,relativePath);await fs.mkdir(path.dirname(file),{recursive:true});
  const realLocal=await fs.realpath(local),realDirectory=await fs.realpath(path.dirname(file));
  if(realDirectory!==path.join(realLocal,'assets',p.id))throw new Error('素材登记目录不能通过符号链接指向其他位置');
  await diskPreflight(path.dirname(file),{expectedBytes:bytes.length*2});
  try{await fs.writeFile(file,bytes,{flag:'wx',mode:0o600});}
  catch(e){if(e.code!=='EEXIST')throw e;const existing=await fs.readFile(file);if(createHash('sha256').update(existing).digest('hex')!==sha256)throw new Error('同名素材文件内容不一致，原文件保留');}
  const clean=(v,n)=>String(v||'').slice(0,n);
  const asset={id,sha256,mimeType,relativePath,bytes:bytes.length,name:clean(input.name,200),caption:clean(input.caption,1000),alt:clean(input.alt,1000)};
  p.sourceBundle.assets.push(asset);return {asset,reused:false};
}
export async function readAsset(local,p,id){
  const asset=p.sourceBundle.assets.find(a=>a.id===id);if(!asset){const e=new Error('素材未登记');e.status=404;throw e;}
  const root=path.resolve(local,'assets',p.id),file=path.resolve(local,asset.relativePath);
  if(!file.startsWith(root+path.sep))throw new Error('素材路径不在登记目录');
  const realLocal=await fs.realpath(local),realRoot=await fs.realpath(root),realFile=await fs.realpath(file);
  if(realRoot!==path.join(realLocal,'assets',p.id))throw new Error('素材登记目录不能通过符号链接指向其他位置');
  if(!realFile.startsWith(realRoot+path.sep))throw new Error('素材不能指向登记目录外的文件');
  const data=await fs.readFile(realFile);
  if(createHash('sha256').update(data).digest('hex')!==asset.sha256)throw new Error('素材文件已改变，请重新登记并审核');
  return {asset,data};
}
