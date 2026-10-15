// X Articles draft adapter. This module deliberately has no publish endpoint.
// API schema: https://docs.x.com/x-api/articles/create-draft-article
const X_API='https://api.x.com';
const TOKEN_ENV='STUDIO_X_ACCESS_TOKEN';
const REQUIRED_SCOPES=Object.freeze(['tweet.read','tweet.write','users.read']);
const MAX_BODY=100000,MAX_TITLE=200,MAX_RESPONSE=65536;

export class OverseasPublishingError extends Error {
  constructor(message,{code='x_request_failed',status=0,outcome='not-created'}={}){
    super(message);this.name='OverseasPublishingError';this.code=code;this.status=status;this.outcome=outcome;
  }
}

function tokenFrom(env){
  const value=env?.[TOKEN_ENV];
  return typeof value==='string'&&value.trim()&&!/\s/.test(value.trim())?value.trim():null;
}
export function getXConfiguration(env=process.env){
  const configured=Boolean(tokenFrom(env));
  return {configured,missing:configured?[]:[TOKEN_ENV],requiredScopes:[...REQUIRED_SCOPES]};
}

function requireToken(env){
  const token=tokenFrom(env);
  if(!token)throw new OverseasPublishingError('请先在本机配置 X 用户访问令牌 STUDIO_X_ACCESS_TOKEN。',{code:'x_not_configured'});
  return token;
}
function inputError(message){return new OverseasPublishingError(message,{code:'invalid_article'});}
function safeLink(value){
  try{const url=new URL(value);return ['https:','http:','mailto:'].includes(url.protocol)?url.href:null;}catch{return null;}
}
function closingMark(source,mark,start){
  let i=source.indexOf(mark,start);
  while(i!==-1){let slashes=0;for(let p=i-1;p>=0&&source[p]==='\\';p--)slashes++;if(slashes%2===0)return i;i=source.indexOf(mark,i+mark.length);}return -1;
}
function bracketPairs(source){
  const pairs=new Map(),square=[],round=[];
  for(let i=0;i<source.length;i++){
    if(source[i]==='\\'){i++;continue;}
    if(source[i]==='[')square.push(i);else if(source[i]===']'&&square.length)pairs.set(square.pop(),i);
    else if(source[i]==='(')round.push(i);else if(source[i]===')'&&round.length)pairs.set(round.pop(),i);
  }
  return pairs;
}

// Offsets intentionally use JS UTF-16 indices, as DraftJS does.
function inline(source,entities,depth=0){
  if(depth>32)return {text:source,inline_style_ranges:[],entity_ranges:[]};
  let text='';const inline_style_ranges=[],entity_ranges=[],pairs=bracketPairs(source);
  const append=part=>{
    const offset=text.length;text+=part.text;
    inline_style_ranges.push(...part.inline_style_ranges.map(r=>({...r,offset:r.offset+offset})));
    entity_ranges.push(...part.entity_ranges.map(r=>({...r,offset:r.offset+offset})));
  };
  for(let i=0;i<source.length;){
    if(source[i]==='\\'&&i+1<source.length&&/[\\`*{}\[\]()#+\-.!_>~]/.test(source[i+1])){text+=source[i+1];i+=2;continue;}
    const image=source.startsWith('![',i),linkStart=image?i+1:i;
    if(source[linkStart]==='['){
      const labelEnd=pairs.get(linkStart)??-1;
      if(labelEnd!==-1&&source[labelEnd+1]==='('){
        const end=pairs.get(labelEnd+1)??-1;
        if(end!==-1){
          const label=source.slice(linkStart+1,labelEnd)||(image?'Image':''),target=source.slice(labelEnd+2,end).trim();
          const url=safeLink(target.replace(/^<(.+)>$/,'$1').replace(/\s+["'][\s\S]*["']$/,''));
          const offset=text.length;append(inline(label,entities,depth+1));
          if(url&&text.length>offset){const key=entities.length;entities.push({key:String(key),value:{type:'link',mutability:'mutable',data:{url}}});entity_ranges.push({key,offset,length:text.length-offset});}
          i=end+1;continue;
        }
      }
    }
    if(source[i]==='<'){
      const end=source.indexOf('>',i+1),url=end!==-1?safeLink(source.slice(i+1,end)):null;
      if(url){const key=entities.length,offset=text.length,label=source.slice(i+1,end);text+=label;entities.push({key:String(key),value:{type:'link',mutability:'mutable',data:{url}}});entity_ranges.push({key,offset,length:label.length});i=end+1;continue;}
    }
    let formatted=false;
    for(const [mark,styles] of [['***',['bold','italic']],['___',['bold','italic']],['**',['bold']],['__',['bold']],['~~',['strikethrough']],['*',['italic']],['_',['italic']]]){
      if(!source.startsWith(mark,i))continue;
      if(mark.includes('_')&&i>0&&/[\p{L}\p{N}]/u.test(source[i-1]))continue;
      const end=closingMark(source,mark,i+mark.length);
      if(end<=i+mark.length)continue;
      const offset=text.length;append(inline(source.slice(i+mark.length,end),entities,depth+1));
      for(const style of styles)inline_style_ranges.push({offset,length:text.length-offset,style});
      i=end+mark.length;formatted=true;break;
    }
    if(!formatted){text+=source[i];i++;}
  }
  return {text,inline_style_ranges,entity_ranges};
}

export function markdownToDraftJS(markdown){
  if(typeof markdown!=='string'||!markdown.trim())throw inputError('X Article 正文不能为空。');
  if(markdown.length>MAX_BODY)throw inputError('正文超过本机 100000 字符的资源上限。');
  const lines=markdown.replace(/\r\n?/g,'\n').split('\n'),blocks=[],entities=[];
  let paragraph=[];
  const atomic=(type,data,text=' ')=>{
    const key=entities.length;entities.push({key:String(key),value:{type,mutability:type==='markdown'?'mutable':'immutable',data}});
    blocks.push({key:'b'+blocks.length.toString(36),type:'atomic',text,entity_ranges:[{key,offset:0,length:text.length}],inline_style_ranges:[]});
  };
  const block=(text,type='unstyled',raw=text)=>{
    // The API has no inline-code style; Markdown entities retain code formatting.
    if(/(^|[^\\])`/.test(raw)){atomic('markdown',{markdown:raw});return;}
    blocks.push({key:'b'+blocks.length.toString(36),type,...inline(text,entities)});
  };
  const flush=()=>{if(paragraph.length){block(paragraph.join('\n'));paragraph=[];}};
  const structural=line=>/^\s*(?:#{1,6}\s|[-+*]\s|\d+[.)]\s|>\s?|`{3,}|~{3,}|(?:[-*_]\s*){3,}$)/.test(line);
  for(let i=0;i<lines.length;i++){
    const line=lines[i];if(!line.trim()){flush();continue;}
    const fence=line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if(fence){
      flush();const code=[line],marker=fence[1][0],count=fence[1].length;let closed=false;
      while(++i<lines.length){code.push(lines[i]);if(new RegExp('^\\s{0,3}'+marker+'{'+count+',}\\s*$').test(lines[i])){closed=true;break;}}
      if(!closed)code.push(marker.repeat(count));atomic('markdown',{markdown:code.join('\n')});continue;
    }
    if(line.includes('|')&&i+1<lines.length&&/^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[i+1])){
      flush();const table=[line,lines[++i]];while(i+1<lines.length&&lines[i+1].trim()&&lines[i+1].includes('|'))table.push(lines[++i]);atomic('markdown',{markdown:table.join('\n')});continue;
    }
    const heading=line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    if(heading){flush();block(heading[2],['header-one','header-two','header-three'][Math.min(heading[1].length,3)-1],line);continue;}
    if(/^\s{0,3}(?:[-*_]\s*){3,}$/.test(line)){flush();atomic('divider',{});continue;}
    const list=line.match(/^\s*(?:([-+*])|\d+[.)])\s+(.+)$/);
    if(list){flush();block(list[2],list[1]?'unordered-list-item':'ordered-list-item',line);continue;}
    if(/^\s{0,3}>/.test(line)){
      flush();const quote=[line.replace(/^\s{0,3}>\s?/,'')];while(i+1<lines.length&&/^\s{0,3}>/.test(lines[i+1]))quote.push(lines[++i].replace(/^\s{0,3}>\s?/,''));block(quote.join('\n'),'blockquote',quote.map(l=>'> '+l).join('\n'));continue;
    }
    // Setext headings are supported without imposing a fixed article template.
    if(i+1<lines.length&&/^\s{0,3}(?:=+|-+)\s*$/.test(lines[i+1])){
      flush();block(line,lines[++i].trim()[0]==='='?'header-one':'header-two');continue;
    }
    if(structural(line))flush();paragraph.push(line);
  }
  flush();return {blocks,entities};
}

export function buildXArticlePayload({title,markdown,coverMediaId}={}){
  if(typeof title!=='string'||!title.trim())throw inputError('X Article 标题不能为空。');
  title=title.trim();if(Array.from(title).length>MAX_TITLE)throw inputError('标题超过本机 200 字符的资源上限。');
  const payload={title,content_state:markdownToDraftJS(markdown)};
  if(coverMediaId!==undefined&&coverMediaId!==null&&coverMediaId!==''){
    if(typeof coverMediaId!=='string'||!/^\d{1,32}$/.test(coverMediaId))throw inputError('封面必须使用已上传到 X 的 media ID。');
    payload.cover_media={media_category:'tweet_image',media_id:coverMediaId};
  }
  return payload;
}

function failure(status,outcome){
  const codes={401:'x_unauthorized',403:'x_access_denied',429:'x_rate_limited',402:'x_payment_required'};
  const messages={401:'X 用户令牌无效或已过期，请更新本机配置。',403:'X 拒绝了请求，请检查用户授权范围和 Articles 访问资格。',429:'X 请求频率已达限制，请稍后重试。',402:'X API 账户需要可用额度或访问套餐。'};
  return new OverseasPublishingError(messages[status]||'X API 请求失败（HTTP '+status+'）。',{code:codes[status]||'x_http_error',status,outcome});
}
async function readResponse(response){
  if(response.body?.getReader){
    const reader=response.body.getReader();let bytes=0;const chunks=[];
    try{while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>MAX_RESPONSE){await reader.cancel();throw Error('response_too_large');}chunks.push(Buffer.from(value));}}finally{reader.releaseLock();}
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }
  const text=await response.text();if(Buffer.byteLength(text)>MAX_RESPONSE)throw Error('response_too_large');return JSON.parse(text);
}
async function requestX(path,{token,method='GET',body,fetchImpl=globalThis.fetch,timeoutMs=15000}={}){
  if(typeof fetchImpl!=='function')throw new OverseasPublishingError('本机运行时未提供网络请求能力。',{code:'x_runtime_unavailable'});
  const controller=new AbortController(),creating=method==='POST';let timer;
  const timeout=Math.max(1,Math.min(Number(timeoutMs)||15000,60000));
  const timedOut=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new OverseasPublishingError(creating?'X 创建请求超时，结果未知；请先在 X 核对草稿，不要重复创建。':'X 连接检查超时，请稍后重试。',{code:'x_timeout',outcome:creating?'unknown':'not-created'}));},timeout);});
  const work=(async()=>{
    let response;
    try{response=await fetchImpl(X_API+path,{method,redirect:'error',headers:{Authorization:'Bearer '+token,Accept:'application/json',...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:controller.signal});}
    catch{throw new OverseasPublishingError(creating?'X 创建请求中断，结果未知；请先在 X 核对草稿，不要重复创建。':'暂时无法连接 X，请检查网络后重试。',{code:'x_network_error',outcome:creating?'unknown':'not-created'});}
    if(!response?.ok){const status=Number(response?.status)||0;throw failure(status,creating&&(status>=500||status===408||!status)?'unknown':'not-created');}
    try{return await readResponse(response);}catch{throw new OverseasPublishingError(creating?'X 已响应，但无法确认草稿编号；请先在 X 核对草稿，不要重复创建。':'X 连接响应格式异常，无法确认账号状态。',{code:'x_invalid_response',outcome:creating?'unknown':'not-created'});}
  })();
  try{return await Promise.race([work,timedOut]);}finally{clearTimeout(timer);}
}

export async function probeXConnection({env=process.env,fetchImpl=globalThis.fetch,timeoutMs=15000}={}){
  const configuration=getXConfiguration(env),base={platform:'x',...configuration,articleAccess:'unverified',checkedAt:new Date().toISOString()};
  if(!configuration.configured)return {...base,status:'unconfigured',message:'尚未配置 X 用户访问令牌。'};
  try{
    const result=await requestX('/2/users/me',{token:requireToken(env),fetchImpl,timeoutMs}),user=result?.data;
    if(!user||typeof user.id!=='string'||!/^\d{1,32}$/.test(user.id)||typeof user.username!=='string'||!/^\w{1,32}$/.test(user.username))throw new OverseasPublishingError('X 未返回有效账号，无法确认连接状态。',{code:'x_invalid_response'});
    return {...base,status:'connected',account:{id:user.id,username:user.username},message:'已验证 X 账号连接；Articles 权限将在首次创建草稿时校验。'};
  }catch(error){
    return {...base,status:'unavailable',code:error.code||'x_request_failed',message:error instanceof OverseasPublishingError?error.message:'X 连接检查失败。'};
  }
}

export async function createXArticleDraft(input,{env=process.env,fetchImpl=globalThis.fetch,timeoutMs=15000}={}){
  const payload=buildXArticlePayload(input),token=requireToken(env);
  const response=await requestX('/2/articles/draft',{token,method:'POST',body:payload,fetchImpl,timeoutMs});
  const id=response?.data?.id;
  if(typeof id!=='string'||!/^\d{1,19}$/.test(id))throw new OverseasPublishingError('X 已接收请求，但未返回有效草稿编号；请先在 X 核对草稿，不要重复创建。',{code:'x_invalid_response',outcome:'unknown'});
  return {platform:'x',id,title:payload.title,status:'draft',articleAccess:'verified',verification:'api-accepted',message:'X API 已返回草稿编号，请在 X Articles 中核对排版。'};
}
