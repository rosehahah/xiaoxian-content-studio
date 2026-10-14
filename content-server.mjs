import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {ensureContentFields,validateContentFields,CONTENT_FORMATS} from './content-schema.mjs';
import {stableHash,articleHash,variantHash,articleApproved,variantApproved,updateSources,patchArticle,articleInput,importArticle,variantInput,importVariants,patchVariant,approveArticle,approveVariant} from './content-domain.mjs';
import {renderArticleDocument} from './article-render.mjs';
import {storeAsset,readAsset,diskPreflight} from './content-storage.mjs';
import {contentArtifact,buildContentPackage,getExportWork,newDelivery,persistDelivery,EXECUTION_VERSIONS} from './content-delivery.mjs';
import {profileStatus} from './content-profiles.mjs';

export const CONTENT_CAPABILITIES={mode:'export_only',remoteDrafts:false,formalPublishing:false,rendererVersion:EXECUTION_VERSIONS.converterVersion};
export function publicContentProject(raw){
  const p=structuredClone(raw);ensureContentFields(p);
  delete p.runtime;
  const variantHashes={},approved={},profiles={};
  for(const v of p.variants){variantHashes[v.id]=variantHash(p,v);approved[v.id]=variantApproved(p,v)&&v.approval?.rendererVersion===EXECUTION_VERSIONS.converterVersion;}
  for(const v of p.variants)profiles[v.id]=profileStatus(v.channel);
  p.runtime={articleHash:articleHash(p),articleApproved:articleApproved(p)&&p.article.approval?.rendererVersion===EXECUTION_VERSIONS.converterVersion,variantHashes,variantApproved:approved,profiles,capabilities:CONTENT_CAPABILITIES};
  return p;
}
function error(message,status=422){return Object.assign(new Error(message),{status});}
function assertUser(body){if(body.actor!=='user')throw error('审核只能由用户明确确认');}
export function secureInput(value,depth=0){
  if(depth>20)throw error('输入嵌套过深');
  if(!value||typeof value!=='object')return;
  for(const [key,v] of Object.entries(value)){
    if(['__proto__','prototype','constructor'].includes(key)||/^(?:apikey|token|secret|wechatsecret|wechatappid|appsecret|clientsecret|accesstoken|refreshtoken|authorization|cookie|password|openaiapikey|xAccessToken)$/i.test(key.replace(/[-_]/g,'')))throw error('网页输入不能包含凭证或原型字段');
    secureInput(v,depth+1);
  }
}
function assertRenderable(p,work){
  const declared=new Set(p.sourceBundle.assets.map(a=>a.id));
  for(const m of String(work.bodyMd||'').matchAll(/!\[[^\]]*\]\(asset:([a-zA-Z0-9_-]+)\)/g))if(!declared.has(m[1]))throw error('正文引用未登记图片：'+m[1]);
}
function reviewed(p,work){
  const ok=work.id==='article-main'?articleApproved(p):variantApproved(p,work);
  if(!ok||work.approval?.rendererVersion!==EXECUTION_VERSIONS.converterVersion)throw error('请先查看当前预览并由用户审核',409);
}
function resolveWork(p,id){if(id==='article-main')return p.article;const v=p.variants.find(v=>v.id===id);if(!v)throw error('平台版本不存在',404);return v;}
function taskReplay(p,kind,envelope){
  const payload=kind==='article'?envelope.article:envelope.variants;
  if(!payload)return false;
  const found=(p.tasks||[]).find(t=>t.kind===kind&&t.inputFingerprint===envelope.inputFingerprint&&t.payloadHash===stableHash(payload));
  if(!found)return false;
  return found.outputs.every(o=>{const work=o.id==='article-main'?p.article:p.variants.find(v=>v.id===o.id);return work&&(o.id==='article-main'?articleHash(p):variantHash(p,work))===o.artifactHash;});
}
function recordTask(p,kind,envelope,outputs){
  p.tasks.push({id:randomUUID(),kind,inputFingerprint:envelope.inputFingerprint,payloadHash:stableHash(kind==='article'?envelope.article:envelope.variants),outputs:outputs.map(work=>({id:work.id,artifactHash:work.id==='article-main'?articleHash(p):variantHash(p,work)})),status:'imported',createdAt:new Date().toISOString()});
}
export function createContentRouter(ctx){
  const {projects,local,origin,readBody,json,persist,stamp,requireRevision,busy}=ctx;
  const locks=new Map();
  async function transaction(p,body,operation){
    if(locks.has(p.id)||busy.has(p.id))throw error('该项目正在保存或交付，请稍后重试',409);
    requireRevision(p,body);const snapshot=structuredClone(p);locks.set(p.id,true);busy.add(p.id);
    try{
      const result=await operation();validateContentFields(p);stamp(p);await persist();return result;
    }catch(e){Object.keys(p).forEach(k=>delete p[k]);Object.assign(p,snapshot);throw e;}
    finally{locks.delete(p.id);busy.delete(p.id);}
  }
  async function exportDeliveryUnlocked(p,body){
    const work=getExportWork(p,body.variantId||'article-main');reviewed(p,work);assertRenderable(p,work);
    const result=newDelivery(p,work,body);
    if(result.reused)return result;
    const d=result.delivery;
    const frozen=structuredClone(p);
    await persistDelivery(local,d);stamp(p);await persist();
    try{
      d.package=await buildContentPackage(local,frozen,d.snapshot,{artifactHash:d.artifactHash,deliveryId:d.id});
      d.status='local_ready';d.message='本机交付包已保存，未写入平台';d.url='/api/deliveries/'+d.id+'/package';
      if(work.id!=='article-main')work.deliveryIds.push(d.id);
    }catch(e){d.status='needs_attention';d.message=e.message;d.updatedAt=new Date().toISOString();await persistDelivery(local,d);stamp(p);await persist();throw e;}
    d.updatedAt=new Date().toISOString();await persistDelivery(local,d);stamp(p);await persist();return result;
  }
  async function exportDelivery(p,body){
    if(locks.has(p.id)||busy.has(p.id))throw error('项目正在交付，请查看已有任务',409);
    if(body.revision!==undefined)requireRevision(p,body);
    locks.set(p.id,true);busy.add(p.id);
    try{return await exportDeliveryUnlocked(p,body);}
    finally{locks.delete(p.id);busy.delete(p.id);}
  }
  return async function contentRoute(req,res,u){
    const route=u.pathname;
    const dm=route.match(/^\/api\/deliveries\/([a-f0-9-]{36})(?:\/(package|reconcile))?$/);
    if(dm){
      const p=projects.find(p=>(p.deliveries||[]).some(d=>d.id===dm[1]));if(!p)throw error('交付记录不存在',404);
      const d=p.deliveries.find(d=>d.id===dm[1]);
      if(req.method==='GET'&&!dm[2]){json(res,200,{delivery:d,project:p});return true;}
      if(req.method==='GET'&&dm[2]==='package'){
        if(d.status!=='local_ready'||!d.package)throw error('交付包尚未准备好',409);
        const root=path.resolve(local,'packages',p.id),file=path.resolve(local,d.package.relativePath);
        if(!file.startsWith(root+path.sep))throw error('交付路径无效');
        const data=await fs.readFile(file);
        if(createHash('sha256').update(data).digest('hex')!==d.package.sha256)throw error('交付包校验失败，请重新生成');
        res.writeHead(200,{'Content-Type':'application/zip','Content-Disposition':'attachment; filename="content-package.zip"','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(data);return true;
      }
      if(req.method==='POST'&&dm[2]==='reconcile'){
        const body=await readBody(req);secureInput(body);
        await transaction(p,{...body,revision:body.revision??p.revision},async()=>{
          if(d.mode!=='export')throw error('外部结果需在原平台核对，本版不会重新创建或伪造远程成功',409);
          if(d.package){
            const file=path.resolve(local,d.package.relativePath),root=path.resolve(local,'packages',p.id);
            if(!file.startsWith(root+path.sep))throw error('交付路径无效');
            const data=await fs.readFile(file);
            if(createHash('sha256').update(data).digest('hex')!==d.package.sha256)throw error('本机包不完整，请重新导出');
            d.status='local_ready';d.message='已核对本机包，未写入平台';
          }else{d.status='needs_attention';d.message='未找到完整本机包，可重新导出；不会创建远程草稿';}
          d.updatedAt=new Date().toISOString();await persistDelivery(local,d);
        });json(res,200,{project:p,delivery:d});return true;
      }
      throw error('不支持此交付操作',405);
    }
    const m=route.match(/^\/api\/projects\/([a-zA-Z0-9_-]{1,80})\/(sources|assets(?:\/[^/]+)?|article-input|article-import|article-preview|article-approve|article|channels|variant-input|variant-import|variants\/[^/]+(?:\/(?:approve|images))?|feedback|deliveries|export)$/);
    if(!m)return false;
    const p=projects.find(p=>p.id===m[1]);if(!p)throw error('项目不存在',404);ensureContentFields(p);
    const action=m[2];
    if(req.method==='GET'){
      if(action==='article-input'){json(res,200,articleInput(p,origin));return true;}
      if(action==='variant-input'){
        let keys;try{keys=JSON.parse(u.searchParams.get('keys')||'[]');}catch{throw error('平台选择不是有效JSON');}
        json(res,200,variantInput(p,keys,u.searchParams.get('sourceWorkId')||p.article.id,origin));return true;
      }
      if(action==='article-preview'){
        const work=resolveWork(p,u.searchParams.get('variantId')||'article-main');
        const html=renderArticleDocument(work,{assets:p.sourceBundle.assets,assetUrl:id=>'/api/projects/'+p.id+'/assets/'+encodeURIComponent(id),lang:work.locale});
        json(res,200,{html,artifactHash:work.id==='article-main'?articleHash(p):variantHash(p,work),approved:work.id==='article-main'?articleApproved(p):variantApproved(p,work),rendererVersion:EXECUTION_VERSIONS.converterVersion});return true;
      }
      if(action.startsWith('assets/')){
        const {asset,data}=await readAsset(local,p,decodeURIComponent(action.slice(7)));
        res.writeHead(200,{'Content-Type':asset.mimeType,'Content-Length':data.length,'X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox",'Cache-Control':'private, max-age=0'});res.end(data);return true;
      }
      if(action==='export'){
        const id=u.searchParams.get('workId')||'article-main',work=getExportWork(p,id);reviewed(p,work);assertRenderable(p,work);
        const format=u.searchParams.get('format')||'zip';
        if(format==='zip'){
          const {delivery}=await exportDelivery(p,{variantId:id,mode:'export',destination:'local'});
          if(delivery.status!=='local_ready')throw error('本机包正在准备，请在交付记录中继续查看',409);
          const data=await fs.readFile(path.join(local,delivery.package.relativePath));res.writeHead(200,{'Content-Type':'application/zip','Content-Disposition':'attachment; filename="article-package.zip"','Cache-Control':'no-store'});res.end(data);return true;
        }
        const frozen=structuredClone(p),frozenWork=structuredClone(work);
        const artifact=await contentArtifact(local,frozen,frozenWork,{standalone:true});
        if(!['html','markdown'].includes(format))throw error('导出格式不支持');
        const data=format==='html'?artifact.html:artifact.markdown;
        res.writeHead(200,{'Content-Type':format==='html'?'text/html; charset=utf-8':'text/markdown; charset=utf-8','Content-Disposition':'attachment; filename="article.'+(format==='html'?'html':'md')+'"','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(data);return true;
      }
      throw error('接口不存在',404);
    }
    const body=await readBody(req);secureInput(body);
    if(action==='deliveries'&&req.method==='POST'){
      if(body.mode&&body.mode!=='export')throw error(body.mode==='publish'?'本版不提供正式发布':'此连接器未验收，当前仅导出',422);
      requireRevision(p,body);
      const result=await exportDelivery(p,body);json(res,200,{...result,url:result.delivery.url,project:p});return true;
    }
    if(action==='article-import'&&req.method==='POST'&&taskReplay(p,'article',body)){json(res,200,{project:p,reused:true});return true;}
    if(action==='variant-import'&&req.method==='POST'&&taskReplay(p,'variants',body)){json(res,200,{project:p,reused:true});return true;}
    await transaction(p,body,async()=>{
      if(action==='sources'&&req.method==='PUT'){
        const bundle=structuredClone(body.sourceBundle||body.bundle||{}),incoming=Array.isArray(bundle.assets)?bundle.assets:[];
        bundle.assets=p.sourceBundle.assets.map(a=>{const next=incoming.find(x=>x?.id===a.id);return {...a,...(next&&typeof next.caption==='string'?{caption:next.caption.slice(0,1000)}:{}),...(next&&typeof next.alt==='string'?{alt:next.alt.slice(0,1000)}:{}),...(next&&typeof next.name==='string'?{name:next.name.slice(0,200)}:{})};});
        updateSources(p,bundle);
      }else if(action==='assets'&&req.method==='POST'){
        const copy=structuredClone(p),result=await storeAsset(local,copy,body);
        requireRevision(p,body);p.sourceBundle.assets=copy.sourceBundle.assets;p.sourceBundle.revision++;body.savedAsset=result.asset;
      }else if(action==='article'&&req.method==='PATCH')patchArticle(p,body.article||body);
      else if(action==='article-import'&&req.method==='POST'){importArticle(p,body);recordTask(p,'article',body,[p.article]);}
      else if(action==='article-approve'&&req.method==='POST'){
        assertUser(body);assertRenderable(p,p.article);approveArticle(p,body.artifactHash);p.article.approval.rendererVersion=EXECUTION_VERSIONS.converterVersion;
      }else if(action==='channels'&&req.method==='PATCH'){
        p.selectedChannels=structuredClone(body.selectedChannels);validateContentFields(p);
      }else if(action==='variant-import'&&req.method==='POST'){
        importVariants(p,body);recordTask(p,'variants',body,body.variants.map(v=>p.variants.find(x=>x.id===v.id)));
      }else if(action==='feedback'&&req.method==='PATCH'){
        if(!Array.isArray(body.feedback)||body.feedback.length>500||JSON.stringify(body.feedback).length>100000)throw error('反馈记录格式或大小不正确');
        for(const f of body.feedback){if(!f||typeof f.channel!=='string'||typeof f.note!=='string'||f.note.length>10000)throw error('反馈记录需要渠道和说明');}
        p.feedback=structuredClone(body.feedback);
      }else if(action.startsWith('variants/')){
        const parts=action.split('/'),id=decodeURIComponent(parts[1]),v=p.variants.find(v=>v.id===id);if(!v)throw error('平台版本不存在',404);
        if(parts[2]==='approve'&&req.method==='POST'){
          assertUser(body);assertRenderable(p,v);approveVariant(p,id,body.artifactHash);v.approval.rendererVersion=EXECUTION_VERSIONS.converterVersion;
        }else if(parts[2]==='images'&&req.method==='POST'){
          reviewed(p,v);if(v.format!=='cards'||body.artifactHash!==variantHash(p,v)||!Array.isArray(body.images)||body.images.length!==v.cards.length)throw error('图卡PNG与当前审核版本不一致',409);
          const dir=path.join(local,'renders',p.id,body.artifactHash);await fs.mkdir(dir,{recursive:true});
          const records=[];
          for(let i=0;i<body.images.length;i++){
            const value=body.images[i];if(typeof value!=='string'||!/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(value))throw error('图卡仅接受PNG');
            const data=Buffer.from(value.slice(22),'base64');
            if(data.length<67||data.length>8*1024*1024||data.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'||data.readUInt32BE(16)!==1080||data.readUInt32BE(20)!==1440)throw error('图卡必须为1080×1440的有效PNG');
            await diskPreflight(dir,{expectedBytes:data.length*2});const name=String(i+1).padStart(2,'0')+'.png',file=path.join(dir,name);await fs.writeFile(file,data,{mode:0o600});
            records.push({name,relativePath:path.relative(local,file),contentHash:stableHash(data.toString('base64'))});
          }
          v.renderedImages=records;v.renderedImageHash=body.artifactHash;
        }else if(!parts[2]&&req.method==='PATCH')patchVariant(p,id,body.variant||body);
        else throw error('不支持的平台操作',405);
      }else throw error('不支持此操作',405);
    });
    json(res,200,{project:p,...(body.savedAsset?{asset:body.savedAsset}:{})});return true;
  };
}
