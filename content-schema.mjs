// Shared validation only: this module is safe to import in the browser.
export const CONTENT_SCHEMA = 2;
export const CONTENT_FORMATS = Object.freeze({
  wechat:['article','cards'],xiaohongshu:['cards'],douyin:['cards'],zhihu:['article'],juejin:['article'],
  substack:['article'],linkedin:['post','cards'],x:['post','cards','article'],threads:['post','cards'],
});
const DOMESTIC=['wechat','xiaohongshu','douyin','zhihu','juejin'];
const OVERSEAS=['substack','linkedin','x','threads'];
const ID=/^[a-zA-Z0-9_-]{1,100}$/;
const HASH=/^[a-f0-9]{64}$/;
const SENSITIVE=/^(?:password|passwd|secret|appsecret|clientsecret|accesstoken|refreshtoken|token|apikey|authorization|cookie|credentials?)$/i;
export function contentError(message,status=422){const error=new Error(message);error.status=status;return error;}
const fail=message=>{throw contentError(message);};
const record=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&(Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null);
function obj(x,label){if(!record(x))fail(label+'必须是对象');}
function text(x,max,label,required=false){if(typeof x!=='string'||x.length>max||(required&&!x.trim()))fail(label+'格式或长度错误');}
function identifier(x,label){if(typeof x!=='string'||!ID.test(x))fail(label+'编号错误');}
function list(x,max,label){if(!Array.isArray(x)||x.length>max)fail(label+'格式或数量错误');}
function revision(x,label){if(!Number.isSafeInteger(x)||x<0)fail(label+'版本错误');}
function hash(x,label,nullable=true){if(!(nullable&&x===null)&&(typeof x!=='string'||!HASH.test(x)))fail(label+'指纹错误');}
function unique(items,key,label){const seen=new Set();for(const x of items){const value=key(x);if(seen.has(value))fail(label+'编号重复');seen.add(value);}}
function safeTree(x,label,depth=0,seen=new Set()){
  if(depth>16)fail(label+'嵌套过深');
  if(x===null||typeof x==='boolean')return;
  if(typeof x==='string'){if(x.length>200000)fail(label+'字段过长');return;}
  if(typeof x==='number'){if(!Number.isFinite(x))fail(label+'数字无效');return;}
  if(typeof x!=='object'||seen.has(x))fail(label+'不是有效JSON数据');
  seen.add(x);
  if(!Array.isArray(x)&&!record(x))fail(label+'不是普通对象');
  if(Object.keys(x).length>2000)fail(label+'字段过多');
  for(const [key,value] of Object.entries(x)){
    if(['__proto__','prototype','constructor'].includes(key)||SENSITIVE.test(key.replace(/[-_]/g,'')))fail(label+'不能包含敏感或原型字段：'+key);
    safeTree(value,label,depth+1,seen);
  }
  seen.delete(x);
}
function deps(x,label){list(x,300,label);unique(x,d=>d.factId,label);for(const d of x){obj(d,label);identifier(d.factId,label);hash(d.fingerprint,label);}}
function approval(x,label){if(x===null)return;obj(x,label);if(x.by!==undefined&&x.by!=='user')fail(label+'审核人错误');if(x.fingerprint!==undefined)hash(x.fingerprint,label,false);if(x.artifactHash!==undefined)hash(x.artifactHash,label,false);}
function assetRefs(x,ids,label){
  list(x,100,label);
  for(const a of x){const id=typeof a==='string'?a:a?.assetId;identifier(id,label);if(!ids.has(id))fail(label+'引用未登记素材：'+id);if(typeof a!=='string'){obj(a,label);if(a.caption!==undefined)text(a.caption,3000,label+'图注');if(a.alt!==undefined)text(a.alt,2000,label+'替代文字');}}
}
function sourceBundle(x){
  obj(x,'材料');safeTree(x,'材料');revision(x.revision,'材料');
  list(x.sources,300,'来源');list(x.facts,500,'事实');list(x.assets,100,'素材');list(x.voiceSampleRefs,100,'声音样本');
  unique(x.sources,s=>s.id,'来源');unique(x.facts,f=>f.id,'事实');unique(x.assets,a=>a.id,'素材');
  const sources=new Set(x.sources.map(s=>s.id));
  for(const s of x.sources){obj(s,'来源');identifier(s.id,'来源');text(s.locator,4000,'来源位置');if(s.type!==undefined)text(s.type,80,'来源类型');if(s.contentHash!==undefined)hash(s.contentHash,'来源');if(s.verification!==undefined)text(s.verification,80,'来源核验状态');}
  for(const f of x.facts){obj(f,'事实');identifier(f.id,'事实');text(f.statement,12000,'事实内容',true);text(f.verification,80,'事实核验状态',true);hash(f.fingerprint,'事实');list(f.sourceRefs,30,'事实来源');for(const r of f.sourceRefs){obj(r,'事实来源');identifier(r.sourceId,'事实来源');if(!sources.has(r.sourceId))fail('事实引用未登记来源');if(r.anchor!==undefined)text(r.anchor,2000,'来源定位');}}
  for(const a of x.assets){obj(a,'素材');identifier(a.id,'素材');hash(a.sha256,'素材',false);text(a.mimeType,100,'素材类型',true);if(!['image/png','image/jpeg','image/webp','image/gif','application/pdf'].includes(a.mimeType))fail('素材类型不支持');if(a.name!==undefined)text(a.name,300,'素材名称');if(a.alt!==undefined)text(a.alt,2000,'素材替代文字');if(a.caption!==undefined)text(a.caption,3000,'素材图注');if(a.relativePath!==undefined){text(a.relativePath,500,'素材位置',true);if(a.relativePath.startsWith('/')||a.relativePath.includes('\\')||a.relativePath.split('/').some(p=>p==='..'||p==='.')||/^[a-z]+:/i.test(a.relativePath))fail('素材位置必须是登记目录内的相对路径');}}
  if(x.experiences!==undefined)list(x.experiences,300,'经历');
  if(x.uncertainties!==undefined)list(x.uncertainties,300,'不确定信息');
}
function article(x,ids){
  obj(x,'文章');safeTree(x,'文章');identifier(x.id,'文章');
  if(!['tutorial','diary'].includes(x.storyType))fail('文章类型仅支持tutorial/diary');
  locale(x.locale);text(x.title,500,'文章标题');text(x.digest,3000,'文章摘要');text(x.bodyMd,100000,'文章正文');
  assetRefs(x.assets,ids,'文章素材');if(x.coverAssetId!==null){identifier(x.coverAssetId,'封面');if(!ids.has(x.coverAssetId))fail('封面素材未登记');}
  deps(x.sourceDeps,'文章事实依赖');revision(x.revision,'文章');approval(x.approval,'文章审核');
  obj(x.render,'文章预览');text(x.render.status,80,'文章预览状态');hash(x.render.artifactHash,'文章预览');
}
function locale(x){if(typeof x!=='string'||x.length>40||!(/^[a-zA-Z]{2,12}(?:-[a-zA-Z0-9]{2,12})*$/.test(x)||x==='bilingual'))fail('语言格式错误');}
function translatedCards(x,requireContent=true){
  list(x.cards,20,'海外图卡');if(!x.cards.length)fail('海外图卡至少需要一页');
  for(const c of x.cards){obj(c,'海外图卡');if(!['editorial','cover','cabinet','steps','clean','prompt'].includes(c.kind))fail('图卡类型错误');for(const k of ['eyebrow','title','body','note'])text(c[k],3000,'图卡'+k);if(c.blocks!==undefined){list(c.blocks,20,'图卡区块');for(const b of c.blocks){obj(b,'图卡区块');if(!['text','list','steps','compare','callout'].includes(b.type))fail('图卡区块类型错误');text(b.heading,3000,'图卡区块标题');text(b.text,3000,'图卡区块正文');}}if(requireContent&&![c.title,c.body,c.note,...(c.blocks||[]).map(b=>b.text)].some(t=>t.trim()))fail('海外图卡没有实质内容');}
  obj(x.visual,'海外图卡视觉');const allowed=['theme','layout','readingStyle','pageLayouts'];if(Object.keys(x.visual).some(k=>!allowed.includes(k)))fail('海外图卡不能包含creative、身份照片或生图结果');
  if(!['sage','ink','rose'].includes(x.visual.theme)||!['airy','compact'].includes(x.visual.layout))fail('海外图卡视觉配置错误');
  if(x.visual.readingStyle!==undefined&&!['default','paper','plain','editorial'].includes(x.visual.readingStyle))fail('海外图卡内页风格错误');
  if(x.visual.pageLayouts!==undefined){obj(x.visual.pageLayouts,'海外逐页布局');for(const [i,v] of Object.entries(x.visual.pageLayouts))if(!/^(0|[1-9]\d*)$/.test(i)||Number(i)>=x.cards.length||!['flow','split','feature'].includes(v))fail('海外逐页布局错误');}
}
function variant(x,ids){
  obj(x,'平台稿');safeTree(x,'平台稿');identifier(x.id,'平台稿');
  if(!CONTENT_FORMATS[x.channel]?.includes(x.format))fail('平台或内容形式不支持');
  locale(x.locale);identifier(x.sourceWorkId,'来源作品');hash(x.sourceWorkHash,'来源作品');
  const legacy=x.reviewStatus==='legacy_unreviewed';
  text(x.profileVersion,100,'平台档案版本',true);text(x.title,legacy?3000:500,'平台标题');text(x.bodyMd,legacy?200000:100000,'平台正文');
  if(x.subtitle!==undefined)text(x.subtitle,1000,'平台副标题');if(x.digest!==undefined)text(x.digest,3000,'平台摘要');
  if(x.tags!==undefined){list(x.tags,legacy?50:30,'平台标签');for(const t of x.tags)text(t,legacy?300:100,'平台标签');}
  assetRefs(x.assets,ids,'平台素材');if(x.coverAssetId!==undefined&&x.coverAssetId!==null){identifier(x.coverAssetId,'平台封面');if(!ids.has(x.coverAssetId))fail('平台封面素材未登记');}
  deps(x.sourceDeps,'平台事实依赖');revision(x.revision,'平台稿');approval(x.approval,'平台审核');list(x.deliveryIds,1000,'平台交付编号');for(const id of x.deliveryIds)identifier(id,'交付');
  if(x.format==='cards')translatedCards(x);
  if(x.target!==undefined){if(typeof x.target==='string')text(x.target,1000,'目标');else{obj(x.target,'目标');safeTree(x.target,'目标');if(JSON.stringify(x.target).length>4000)fail('目标过大');}}
  if(x.aiDisclosure!==undefined){obj(x.aiDisclosure,'AI声明');text(x.aiDisclosure.status,100,'AI声明状态');if(x.aiDisclosure.text!==null&&x.aiDisclosure.text!==undefined)text(x.aiDisclosure.text,2000,'AI声明');}
}

export function ensureContentFields(p){
  obj(p,'项目');
  if(p.sourceBundle===undefined)p.sourceBundle={revision:0,sources:[],facts:[],assets:[],voiceSampleRefs:[]};
  if(record(p.sourceBundle))for(const [key,value] of Object.entries({revision:0,sources:[],facts:[],assets:[],voiceSampleRefs:[]}))if(p.sourceBundle[key]===undefined)p.sourceBundle[key]=value;
  if(p.article===undefined)p.article={id:'article-main',storyType:'tutorial',locale:'zh-CN',title:'',digest:'',bodyMd:'',assets:[],coverAssetId:null,sourceDeps:[],revision:0,approval:null,render:{status:'not_rendered',artifactHash:null}};
  if(p.variants===undefined)p.variants=[];
  if(p.selectedChannels===undefined)p.selectedChannels={domestic:[],overseas:[]};
  if(p.tasks===undefined)p.tasks=[];if(p.deliveries===undefined)p.deliveries=[];
  if(p.taskIds===undefined)p.taskIds=[];if(p.deliveryIds===undefined)p.deliveryIds=[];
  return p;
}

export function validateContentFields(p){
  obj(p,'项目');if(p.schema!==1&&p.schema!==CONTENT_SCHEMA)fail('不支持的项目schema');
  sourceBundle(p.sourceBundle);const ids=new Set(p.sourceBundle.assets.map(a=>a.id));article(p.article,ids);
  list(p.variants,100,'平台版本');unique(p.variants,v=>v.id,'平台版本');for(const v of p.variants)variant(v,ids);
  obj(p.selectedChannels,'渠道选择');
  for(const [group,allowed] of [['domestic',DOMESTIC],['overseas',OVERSEAS]]){const selected=p.selectedChannels[group];list(selected,allowed.length,'渠道选择');if(new Set(selected).size!==selected.length||selected.some(x=>!allowed.includes(x)))fail('国内/海外渠道选择错误');}
  for(const key of ['tasks','deliveries','taskIds','deliveryIds']){list(p[key],2000,key);safeTree(p[key],key);}
  if(p.content?.sourceDeps!==undefined)deps(p.content.sourceDeps,'图卡事实依赖');
  for(const key of ['sourceBundle','article','variants'])if(JSON.stringify(p[key]).length>1500000)fail(key+'超出本机资源上限');
  return p;
}

export function migrateProjects(data){
  list(data,2000,'项目数据库');const projects=structuredClone(data);unique(projects,p=>p?.id,'项目');
  for(const p of projects){
    obj(p,'项目');identifier(p.id,'项目');
    if(p.schema!==1&&p.schema!==CONTENT_SCHEMA)fail('未知或损坏的项目schema，拒绝迁移');
    if(!record(p.content)||!Array.isArray(p.content.cards)||p.content.cards.length>20||!record(p.visual)||!record(p.platforms)||typeof p.content.topic!=='string')fail('旧项目数据损坏，拒绝迁移');
    if(!['sage','ink','rose'].includes(p.visual.theme)||!['airy','compact'].includes(p.visual.layout))fail('旧项目视觉数据损坏');
    if(p.content.cards.length)translatedCards({cards:p.content.cards,visual:{theme:p.visual.theme,layout:p.visual.layout}},false);
    for(const copy of Object.values(p.platforms)){if(!record(copy)||typeof copy.title!=='string'||typeof copy.body!=='string'||!Array.isArray(copy.tags)||copy.tags.some(t=>typeof t!=='string'))fail('旧平台配文数据损坏');}
    const old=p.schema===1;ensureContentFields(p);
    if(old){
      for(const channel of ['substack','x','threads']){
        const copy=p.platforms[channel];if(!record(copy)||typeof copy.body!=='string'||!copy.body.trim())continue;
        const id='legacy-'+channel;if(p.variants.some(v=>v.id===id))continue;
        p.variants.push({id,channel,format:channel==='threads'?'post':'article',locale:p.overseasLanguage||'en',sourceWorkId:'cards-main',sourceWorkHash:null,sourceDeps:[],profileVersion:'legacy',title:typeof copy.title==='string'?copy.title:'',bodyMd:copy.body,assets:[],subtitle:copy.subtitle||'',tags:Array.isArray(copy.tags)?structuredClone(copy.tags):[],revision:0,approval:null,reviewStatus:'legacy_unreviewed',deliveryIds:[],legacy:{format:channel==='threads'?'text_attachment':'article',delivery:structuredClone(copy.delivery??null),history:structuredClone(copy.history??[])}});
      }
      p.schema=CONTENT_SCHEMA;p.migration={...(record(p.migration)?p.migration:{}),fromSchema:1,status:'migrated'};
    }
    validateContentFields(p);
  }
  return projects;
}
