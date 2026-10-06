import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
import {seedProject,validateProject,validateContent,contentKey,cardKey,contentApproved,cardsApproved,invalidateContent,invalidateVisual,validatePlatform,fingerprint} from './model.mjs';
import {runCreatorDraft,prepareCreatorSession,draftAutomationAvailable} from './draft-automation.mjs';
const run=promisify(execFile),root=path.dirname(fileURLToPath(import.meta.url));
const local=process.env.STUDIO_DATA_DIR||path.join(root,'.local-data'),dist=path.join(root,'dist');
const port=Number(process.env.STUDIO_PORT||4318),origin='http://localhost:'+port;
await fs.mkdir(local,{recursive:true});
const db=path.join(local,'projects.json');
const jobsDir=path.join(local,'draft-jobs'),profileRoot=path.join(local,'browser-profiles');
await fs.mkdir(jobsDir,{recursive:true});await fs.mkdir(profileRoot,{recursive:true});
let projects;
try{projects=JSON.parse(await fs.readFile(db,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;projects=[seedProject()];}
const busy=new Set();
const jobs=new Map();
const platformSessions={xiaohongshu:{status:'unchecked'},douyin:{status:'unchecked'}};
let persistence=Promise.resolve();
function persist(){const snapshot=JSON.stringify(projects,null,2);persistence=persistence.catch(()=>{}).then(async()=>{await fs.writeFile(db+'.tmp',snapshot);await fs.rename(db+'.tmp',db);});return persistence;}
await persist();
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png'};
const json=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
async function readBody(req){let size=0;const parts=[];for await(const part of req){size+=part.length;if(size>35*1024*1024)throw new Error('上传文件过大');parts.push(part);}return JSON.parse(Buffer.concat(parts).toString()||'{}');}
function requireRevision(p,body){if(body.revision!==p.revision){const e=new Error('内容已在另一处修改，请刷新后继续');e.status=409;throw e;}}
function stamp(p){p.revision++;p.updatedAt=new Date().toISOString();}
function creds(source){const value=keys=>{for(const key of keys){const m=source.match(new RegExp('^\\s*'+key+':\\s*["\']?([^"\'\\n#]+)','m'));if(m)return m[1].trim();}return '';};return {appid:process.env.WECHAT_APPID||value(['wechat_appid','WECHAT_APPID','appid']),secret:process.env.WECHAT_SECRET||value(['wechat_secret','WECHAT_SECRET','secret'])};}
async function wxCall(endpoint,payload){
  const cfg=creds(await fs.readFile(path.join(os.homedir(),'.config/md2wechat/config.yaml'),'utf8'));
  const get=async(url,body)=>{
    const args=['-sS','--max-time','30'];if(body)args.push('-X','POST','-H','Content-Type: application/json','--data-binary',JSON.stringify(body));args.push(url);
    let output;try{output=await run('curl',args,{maxBuffer:4*1024*1024});}catch{throw new Error('公众号核对请求未完成，请稍后核对草稿');}
    const data=JSON.parse(output.stdout);if(data.errcode)throw new Error('微信接口 '+data.errcode+'：'+data.errmsg);return data;
  };
  const token=(await get('https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid='+encodeURIComponent(cfg.appid)+'&secret='+encodeURIComponent(cfg.secret))).access_token;
  if(!token)throw new Error('未取得公众号访问令牌');
  return get('https://api.weixin.qq.com/cgi-bin/'+endpoint+'?access_token='+token,payload);
}
async function imageFiles(p,body){
  if(body.cardFingerprint!==cardKey(p))throw new Error('图片版本与审核版本不一致');
  if(!Array.isArray(body.images)||body.images.length!==p.content.cards.length)throw new Error('图片数量与审核版本不一致');
  const dir=path.join(local,p.id,cardKey(p));await fs.mkdir(dir,{recursive:true});
  const files=[];
  for(let i=0;i<body.images.length;i++){
    const value=body.images[i];if(typeof value!=='string'||!value.startsWith('data:image/png;base64,'))throw new Error('仅接受 PNG 图卡');
    const buffer=Buffer.from(value.slice(22),'base64');
    if(buffer.length>8*1024*1024||buffer.length<24||buffer.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'||buffer.readUInt32BE(16)!==1080||buffer.readUInt32BE(20)!==1440)throw new Error('图卡必须为1080×1440 PNG');
    const file=path.join(dir,String(i+1).padStart(2,'0')+'.png');await fs.writeFile(file,buffer);files.push(file);
  }
  return files;
}
async function wechatDraft(p,body){
  if(!cardsApproved(p))throw new Error('请先确认内容，再审核全部图卡');
  const check=validatePlatform(p,'wechat');if(check.errors.length)throw new Error(check.errors.join('；'));
  const copy=p.platforms.wechat,deliveryKey=fingerprint({card:cardKey(p),title:copy.title,body:copy.body,tags:copy.tags});
  const previous=[copy.delivery,...(copy.history||[])].find(x=>x?.fingerprint===deliveryKey&&x.mediaId);
  if(previous){
    const remote=await wxCall('draft/get',{media_id:previous.mediaId});
    verifyRemote(p,remote);
    copy.delivery={...previous,status:'draft',verifiedAt:new Date().toISOString()};stamp(p);await persist();return p;
  }
  const images=await imageFiles(p,body);
  const description=[copy.body,...copy.tags.map(t=>'#'+t)].join('\n');
  const args=['create_image_post','--title',copy.title,'--content',description,'--images',images.join(','),'--json'];
  let result;
  try{result=await run('md2wechat',args,{maxBuffer:4*1024*1024,timeout:120000});}
  catch(e){let data;try{data=JSON.parse(e.stdout);}catch{}throw new Error(data?.message||'公众号上传未完成，请检查本机接口配置和网络。');}
  const output=JSON.parse(result.stdout);if(!output.success)throw new Error(output.message||'公众号草稿创建失败');
  const mediaId=output.data.media_id;
  copy.delivery={status:'unverified',mediaId,fingerprint:deliveryKey,cardFingerprint:cardKey(p),at:new Date().toISOString()};
  stamp(p);await persist();
  const remote=await wxCall('draft/get',{media_id:mediaId});verifyRemote(p,remote);
  copy.delivery.status='draft';copy.delivery.verifiedAt=new Date().toISOString();await persist();return p;
}
function verifyRemote(p,remote){
  const item=remote.news_item?.[0],copy=p.platforms.wechat;
  if(item?.article_type!=='newspic'||item.title!==copy.title||item.image_info?.image_list?.length!==p.content.cards.length)throw new Error('已创建草稿，但读回校验不一致，请到公众号检查');
}
function publicJob(job){const {imageFiles,...safe}=job;return safe;}
async function saveJob(job){jobs.set(job.id,job);await fs.writeFile(path.join(jobsDir,job.id+'.json'),JSON.stringify(publicJob(job),null,2));}
async function updateJob(job,status,message){job.status=status;job.message=message;job.updatedAt=new Date().toISOString();await saveJob(job);}
async function creatorDraft(p,body){
  if(!cardsApproved(p))throw new Error('请先确认内容，再审核全部图卡');
  if(!['xiaohongshu','douyin'].includes(body.platform))throw new Error('只支持小红书和抖音草稿');
  const check=validatePlatform(p,body.platform);if(check.errors.length)throw new Error(check.errors.join('；'));
  if(!await draftAutomationAvailable())throw new Error('未找到可用的 Google Chrome');
  if(platformSessions[body.platform]?.status!=='logged_in')throw new Error('请先检查并完成'+(body.platform==='xiaohongshu'?'小红书':'抖音')+'扫码登录');
  const imagePaths=await imageFiles(p,body),copy=p.platforms[body.platform];
  const job={id:randomUUID(),projectId:p.id,platform:body.platform,status:'queued',message:'等待打开创作中心',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),cardFingerprint:cardKey(p),copyFingerprint:fingerprint({title:copy.title,body:copy.body,tags:copy.tags}),imageCount:imagePaths.length,imageFiles:imagePaths};
  copy.delivery={status:'opening',jobId:job.id,at:job.createdAt,cardFingerprint:job.cardFingerprint,fingerprint:job.copyFingerprint,by:'automation'};stamp(p);await persist();await saveJob(job);busy.add(p.id);
  runCreatorDraft({platform:job.platform,title:copy.title,body:copy.body,tags:copy.tags,imageFiles:imagePaths,profileRoot,onUpdate:async(status,message)=>{await updateJob(job,status,message);copy.delivery={...copy.delivery,status,updatedAt:job.updatedAt,message};await persist();}}).then(async()=>{
    if(job.status==='draft')copy.delivery={...copy.delivery,status:'draft',verifiedAt:new Date().toISOString()};
    else if(!['filled','needs_attention'].includes(job.status))await updateJob(job,'filled','内容已填入创作中心，请在浏览器中核对并保存草稿。');
    stamp(p);await persist();
  }).catch(async error=>{await updateJob(job,'error',error.message||'自动填写未完成');copy.delivery={...copy.delivery,status:'error',message:job.message,updatedAt:job.updatedAt};stamp(p);await persist();}).finally(()=>busy.delete(p.id));
  return publicJob(job);
}
async function checkPlatformSession(platform){
  if(!['xiaohongshu','douyin'].includes(platform))throw new Error('不支持的平台');
  if(!await draftAutomationAvailable())throw new Error('未找到可用的 Google Chrome');
  const job={id:randomUUID(),type:'session-check',platform,status:'queued',message:'等待检查登录状态',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};await saveJob(job);
  platformSessions[platform]={status:'opening',jobId:job.id,checkedAt:null};
  prepareCreatorSession({platform,profileRoot,onUpdate:async(status,message)=>{await updateJob(job,status,message);platformSessions[platform]={status,jobId:job.id,checkedAt:status==='logged_in'?new Date().toISOString():null};}}).catch(async error=>{await updateJob(job,'error',error.message||'登录状态检查未完成');platformSessions[platform]={status:'error',jobId:job.id,message:job.message,checkedAt:null};});
  return publicJob(job);
}
const server=http.createServer(async(req,res)=>{
  try{
    const host=req.headers.host;if(!['localhost:'+port,'127.0.0.1:'+port].includes(host)){json(res,403,{error:'仅允许本机访问'});return;}
    if(req.headers.origin && ![origin,'http://127.0.0.1:'+port].includes(req.headers.origin)){json(res,403,{error:'只允许同源操作'});return;}
    const u=new URL(req.url,origin),route=u.pathname;
    if(route.startsWith('/api/')){
      if(req.method!=='GET' && !String(req.headers['content-type']).startsWith('application/json')){json(res,415,{error:'仅接受 JSON 请求'});return;}
      if(route==='/api/health'){
        let available=false;try{await run('md2wechat',['config','validate','--json']);available=true;}catch{}
        json(res,200,{mode:'local',wechat:available,draftAutomation:await draftAutomationAvailable(),platformSessions,storage:'本机保存',publishing:false});return;
      }
      const sm=route.match(/^\/api\/platform-sessions\/(xiaohongshu|douyin)\/check$/);
      if(sm&&req.method==='POST'){json(res,202,{job:await checkPlatformSession(sm[1])});return;}
      const jm=route.match(/^\/api\/draft-jobs\/([a-f0-9-]{36})$/);
      if(jm&&req.method==='GET'){let job=jobs.get(jm[1]);if(!job){try{job=JSON.parse(await fs.readFile(path.join(jobsDir,jm[1]+'.json'),'utf8'));}catch{}}if(!job){json(res,404,{error:'草稿任务不存在'});return;}json(res,200,{job:publicJob(job)});return;}
      if(route==='/api/projects'&&req.method==='GET'){json(res,200,{projects});return;}
      if(route==='/api/projects'&&req.method==='POST'){
        const body=await readBody(req),p=validateProject(body);if(projects.some(x=>x.id===p.id))throw new Error('项目编号已存在');
        p.contentApproval=null;p.cardApproval=null;p.stage='content';p.revision=0;
        for(const copy of Object.values(p.platforms)){copy.delivery=null;copy.history=[];}
        projects.unshift(p);await persist();json(res,201,{project:p});return;
      }
      const m=route.match(/^\/api\/projects\/([a-zA-Z0-9_-]{1,80})(?:\/(content-approve|cards-approve|draft|draft-job|manual-draft))?$/);
      if(!m){json(res,404,{error:'接口不存在'});return;}
      const p=projects.find(x=>x.id===m[1]);if(!p){json(res,404,{error:'项目不存在'});return;}
      if(busy.has(p.id)){json(res,409,{error:'正在填写草稿，请等待完成后再编辑'});return;}
      const body=await readBody(req);requireRevision(p,body);
      if(req.method==='PUT'&&!m[2]){
        const next=validateProject(body);const contentChanged=contentKey(p)!==contentKey(next),visualChanged=cardKey(p)!==cardKey(next);
        p.content=next.content;p.visual=next.visual;p.reviewNote=String(next.reviewNote||'').slice(0,3000);
        for(const k of ['wechat','xiaohongshu','douyin']){
          const old=p.platforms[k],copy=next.platforms[k];
          if(fingerprint({title:old.title,body:old.body,tags:old.tags})!==fingerprint({title:copy.title,body:copy.body,tags:copy.tags})&&old.delivery){old.history=old.history||[];old.history.push(old.delivery);old.delivery=null;}
          old.title=copy.title;old.body=copy.body;old.tags=copy.tags;
        }
        if(contentChanged)invalidateContent(p);else if(visualChanged)invalidateVisual(p);
        stamp(p);await persist();json(res,200,{project:p});return;
      }
      if(req.method!=='POST'){json(res,405,{error:'不支持此操作'});return;}
      if(m[2]==='content-approve'){
        const errors=validateContent(p);if(errors.length)throw new Error(errors.join('；'));
        p.contentApproval={fingerprint:contentKey(p),at:new Date().toISOString(),by:'user'};p.stage='design';
      }else if(m[2]==='cards-approve'){
        if(!contentApproved(p))throw new Error('请先确认内容');
        if(body.cardFingerprint!==cardKey(p)||body.viewedCount!==p.content.cards.length)throw new Error('请预览全部图卡后再确认');
        p.cardApproval={fingerprint:cardKey(p),at:new Date().toISOString(),by:'user'};p.stage='drafts';
      }else if(m[2]==='draft'){
        busy.add(p.id);try{await wechatDraft(p,body);json(res,200,{project:p});}finally{busy.delete(p.id);}return;
      }else if(m[2]==='draft-job'){
        const job=await creatorDraft(p,body);json(res,202,{job,project:p});return;
      }else if(m[2]==='manual-draft'){
        if(!cardsApproved(p)||!['xiaohongshu','douyin'].includes(body.platform))throw new Error('请先完成图卡审核');
        const check=validatePlatform(p,body.platform);if(check.errors.length)throw new Error(check.errors.join('；'));
        const copy=p.platforms[body.platform];copy.delivery={status:'manual',at:new Date().toISOString(),cardFingerprint:cardKey(p),fingerprint:fingerprint(copy),by:'user'};
      }else{json(res,404,{error:'没有发布接口'});return;}
      stamp(p);await persist();json(res,200,{project:p});return;
    }
    if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405);res.end();return;}
    const file=path.resolve(dist,'.'+decodeURIComponent(route==='/'?'/index.html':route));
    if(!file.startsWith(dist+path.sep)){res.writeHead(403);res.end();return;}
    const data=await fs.readFile(file);res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin'});res.end(req.method==='HEAD'?undefined:data);
  }catch(e){json(res,e.status||(e.code==='ENOENT'?404:400),{error:e.code==='ENOENT'?'文件不存在':e.message});}
});
server.listen(port,'127.0.0.1',()=>console.log('小苋内容工作台 · '+origin));
