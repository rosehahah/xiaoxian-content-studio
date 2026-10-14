import JSZip from 'jszip';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {stableHash,articleHash,variantHash,articleApproved,variantApproved} from './content-domain.mjs';
import {renderArticleDocument,markdownAssetIds,rewriteMarkdownAssetImages} from './article-render.mjs';
import {readAsset,atomicWriteJson,diskPreflight} from './content-storage.mjs';
import {platformProfile,profileStatus} from './content-profiles.mjs';

export const EXECUTION_VERSIONS={adapterVersion:'content-package-v1',converterVersion:'safe-markdown-v2'};
export const CONTENT_DELIVERY_STATES=['local_ready','queued_local','running','api_accepted','draft_verified','needs_login','needs_attention','failed','unknown_outcome'];
export function deliveryPayloadHash(p,variant,{destination='local',mode='export'}={}){
  const artifactHash=variant.id==='article-main'?articleHash(p):variantHash(p,variant);
  return stableHash({projectId:p.id,variantId:variant.id,artifactHash,destination,target:variant.target||null,mode,profileVersion:variant.profileVersion||'2026-10-15',...EXECUTION_VERSIONS});
}
export function recoverDeliveries(projects){
  for(const p of projects)for(const d of p.deliveries||[]){
    if(d.status==='running'){d.status=d.mode==='export'?'needs_attention':'unknown_outcome';d.message=d.mode==='export'?'本地交付中断，可核对或重新生成本机包。':'上次外部写入结果未知，请核对原任务，不能重新创建。';d.updatedAt=new Date().toISOString();}
  }
  return projects;
}
function imageIds(work){
  const explicit=(work.assets||[]).map(a=>typeof a==='string'?a:a.assetId);
  const embedded=markdownAssetIds(work.bodyMd);
  return [...new Set([...explicit,...embedded,work.coverAssetId].filter(Boolean))];
}
export async function contentArtifact(local,p,work,{standalone=false}={}){
  const assets=p.sourceBundle.assets||[],byId=new Map(),files=[];
  for(const id of imageIds(work)){
    const {asset,data}=await readAsset(local,p,id);
    const ext={'image/png':'png','image/jpeg':'jpg','image/gif':'gif','image/webp':'webp'}[asset.mimeType];
    const name='assets/'+asset.sha256+'.'+ext;
    files.push({name,data});byId.set(id,standalone?'data:'+asset.mimeType+';base64,'+data.toString('base64'):name);
  }
  const html=renderArticleDocument(work,{assets,assetUrl:id=>byId.get(id),lang:work.locale||'zh-CN'});
  const markdown=rewriteMarkdownAssetImages(work.bodyMd,id=>byId.get(id));
  return {html,markdown,files};
}
export async function buildContentPackage(local,p,work,{artifactHash,deliveryId}={}){
  const artifact=await contentArtifact(local,p,work);
  const zip=new JSZip();
  zip.file('article.html',artifact.html);
  zip.file('article.md',work.title?'# '+work.title+'\n\n'+artifact.markdown:artifact.markdown);
  zip.file('配文.txt',[work.title,work.digest,work.bodyMd,work.aiDisclosure?.text].filter(Boolean).join('\n\n'));
  for(const file of artifact.files)zip.file(file.name,file.data);
  if(work.format==='cards'){
    if(!work.renderedImages?.length||work.renderedImageHash!==artifactHash)throw Object.assign(new Error('请先生成并检查当前语言版本的图卡PNG，再下载交付包'),{status:409});
    for(const image of work.renderedImages){
      const dir=path.resolve(local,'renders',p.id,artifactHash),file=path.resolve(local,image.relativePath);
      if(!file.startsWith(dir+path.sep))throw new Error('图卡输出路径无效');
      const real=await fs.realpath(file);if(!real.startsWith((await fs.realpath(dir))+path.sep))throw new Error('图卡输出不能指向其他目录');
      const data=await fs.readFile(real);
      if(stableHash(data.toString('base64'))!==image.contentHash)throw new Error('图卡输出已改变，请重新生成');
      zip.file('images/'+image.name,data);
    }
  }
  zip.file('审核记录.json',JSON.stringify({projectId:p.id,workId:work.id,channel:work.channel||null,format:work.format||'article',locale:work.locale,artifactHash,approval:work.approval,sourceDeps:work.sourceDeps||[],aiDisclosure:work.aiDisclosure||null},null,2));
  zip.file('来源与使用边界.json',JSON.stringify({facts:(work.sourceDeps||[]).map(dep=>{const f=p.sourceBundle.facts.find(f=>f.id===dep.factId);return {factId:dep.factId,verification:f?.verification||'unverified',provenance:f?.provenance||'unspecified',scope:f?.scope||'',sources:(f?.sourceRefs||[]).map(ref=>{const s=p.sourceBundle.sources.find(s=>s.id===ref.sourceId);return {sourceId:ref.sourceId,verification:s?.verification||'unverified',publicScope:s?.publicScope||'reference_only'};})};}),assets:imageIds(work).map(id=>({assetId:id,usageRightsStatus:p.sourceBundle.assets.find(a=>a.id===id)?.usageRightsStatus||'unverified'})),aiDisclosure:work.aiDisclosure||null},null,2));
  if(work.channel)zip.file('平台档案.json',JSON.stringify({profile:platformProfile(work.channel),capability:profileStatus(work.channel)},null,2));
  zip.file('使用说明.txt','这是本机交付包，未写入任何平台，也没有正式发布。\narticle.html可在浏览器打开；article.md与assets可用于平台编辑器。\nLinkedIn cards为实际PNG图卡与文案，PDF请按平台要求另行制作或从HTML打印。\n核对目标平台的AI/版权声明、图片顺序与实际排版。包内不包含凭证或原始私有资料。');
  const data=await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'});
  const dir=path.join(local,'packages',p.id);await fs.mkdir(dir,{recursive:true});await diskPreflight(dir,{expectedBytes:data.length*2});
  const file=path.join(dir,deliveryId+'.zip'),temp=file+'.'+randomUUID()+'.tmp';
  try{await fs.writeFile(temp,data,{flag:'wx',mode:0o600});await fs.rename(temp,file);}catch(e){await fs.unlink(temp).catch(()=>{});throw e;}
  return {relativePath:path.relative(local,file),bytes:data.length,sha256:(await import('node:crypto')).createHash('sha256').update(data).digest('hex')};
}
export function getExportWork(p,id){
  if(id==='article-main'){if(!articleApproved(p))throw Object.assign(new Error('请先预览并审核当前长文'),{status:409});return {...structuredClone(p.article),format:'article'};}
  const variant=p.variants.find(v=>v.id===id);if(!variant)throw Object.assign(new Error('未找到平台版本'),{status:404});
  if(!variantApproved(p,variant))throw Object.assign(new Error('平台版本或来源已改变，请重新预览审核'),{status:409});return variant;
}
export function newDelivery(p,work,{destination='local',mode='export'}={}){
  if(mode!=='export')throw Object.assign(new Error(mode==='publish'?'本版不提供正式发布':'远程草稿尚未在此版本验收；请下载本机包'),{status:422,code:'CONNECTOR_UNVERIFIED'});
  if(destination!=='local')throw Object.assign(new Error('本地导出目标应为local；远程目标需要独立连接验收'),{status:422});
  const payloadHash=deliveryPayloadHash(p,work,{destination,mode});
  const found=p.deliveries.find(d=>d.idempotencyKey===payloadHash&&['running','local_ready','queued_local'].includes(d.status));
  if(found)return {delivery:found,reused:true};
  const at=new Date().toISOString();
  const delivery={id:randomUUID(),projectId:p.id,variantId:work.id,mode,destination,artifactHash:work.id==='article-main'?articleHash(p):variantHash(p,work),payloadHash,idempotencyKey:payloadHash,status:'running',message:'正在准备本机交付包',createdAt:at,updatedAt:at,snapshot:structuredClone(work),profileVersion:work.profileVersion||'2026-10-15',...EXECUTION_VERSIONS};
  delete delivery.snapshot.render;delete delivery.snapshot.deliveryIds;
  p.deliveries.push(delivery);return {delivery,reused:false};
}
export async function persistDelivery(local,delivery){
  await atomicWriteJson(path.join(local,'deliveries',delivery.id+'.json'),delivery);
}
