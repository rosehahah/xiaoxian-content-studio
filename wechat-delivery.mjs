// Draft-only delivery. Never calls a publishing endpoint.
export const wechatDescription=copy=>[copy.body,...copy.tags.map(t=>'#'+t)].join('\n');
export function wechatProblem(error){
  const text=String(error?.message||error||'公众号请求失败');
  const code=Number(error?.wechatCode||text.match(/(?:errcode\s*[=:]|微信接口)\s*(\d+)/i)?.[1])||null;
  const ip=text.match(/invalid ip\s+([\da-f:.]+)/i)?.[1]||null;
  if(code===40164)return {code,ip,status:'blocked',message:`出口 IP ${ip||'（微信未返回）'} 不在公众号白名单中。`,hint:'在公众号后台的开发设置中找到 IP 白名单，添加本次出口 IP，保存后重新检查连接。网络或代理变化后，出口 IP 也可能变化。'};
  if([40013,40125,40001].includes(code))return {code,ip,status:'error',message:'公众号 AppID 或 AppSecret 无效。',hint:'请检查本机 md2wechat 配置；不要把密钥填到网页或交付包。'};
  if(code===40007)return {code,ip,status:'error',message:'已有草稿编号已失效，或不属于当前公众号。',hint:'请先到当前公众号的草稿箱核对；保留现有记录与交付包，可手动重新填入。'};
  if(code===48001)return {code,ip,status:'blocked',message:'公众号没有此接口权限。',hint:'请检查公众号类型、认证与草稿接口权限，也可以使用交付包手动填入。'};
  return {code,ip,status:'error',message:code?`微信接口返回 ${code}，本次操作未完成。`:'公众号请求未完成，请检查网络和本机配置。',hint:'保留本次交付包；如果已取得草稿编号，只重试读回核对。'};
}
const plain=value=>String(value||'').replace(/<br\s*\/?\s*>/gi,'\n').replace(/<[^>]*>/g,'').replace(/&nbsp;|&#160;/g,' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/\s+/g,'').trim();
export function inspectWechatDraft(remote,{title,description,imageCount}){
  const item=remote.news_item?.[0];
  return [
    {name:'多图草稿类型',ok:item?.article_type==='newspic'},
    {name:'标题',ok:item?.title===title},
    {name:'完整说明与话题',ok:plain(item?.content)===plain(description)},
    {name:'图片数量',ok:item?.image_info?.image_list?.length===imageCount},
  ];
}
export async function deliverWechat({copy,fingerprint,cardFingerprint,imageCount,verifyOnly=false},{prepare,preflight,create,read,persist}){
  const previous=[copy.delivery,...(copy.history||[])].find(d=>d?.fingerprint===fingerprint&&d.mediaId);
  if(verifyOnly&&!previous)throw Error('此版本没有可核对的草稿编号');
  if(!previous&&copy.delivery?.fingerprint===fingerprint&&copy.delivery.status==='uncertain')throw Error('上次请求的创建结果未知，请先到公众号草稿箱核对；不会自动重复创建。');
  const state={...previous,status:previous?'unverified':'preparing',fingerprint,cardFingerprint,at:previous?.at||new Date().toISOString(),checks:[],message:''};
  delete state.verifiedAt;copy.delivery=state;
  const save=async()=>{await persist(state);};
  let creating=false;
  try{
    if(!previous){state.fallback=await prepare();state.checks.push({name:'审核版本与本机图片',ok:true});await save();}
    else if(!state.fallback){try{state.fallback=await prepare();state.checks.push({name:'本机兜底包',ok:true});}catch{state.checks.push({name:'本机兜底包（可使用通用交付包）',ok:false});}await save();}
    state.phase='connection';await preflight();state.checks.push({name:'公众号连接与 IP 白名单',ok:true});await save();
    if(!previous){
      state.phase='create';state.status='uncertain';creating=true;await save();
      const result=await create();state.mediaId=result.mediaId;
      if(!state.mediaId)throw Error('创建请求没有返回草稿编号');
      creating=false;state.status='unverified';state.checks.push({name:'草稿编号已取得',ok:true});await save();
    }
    state.phase='verify';const remote=await read(state.mediaId);
    const checks=inspectWechatDraft(remote,{title:copy.title,description:wechatDescription(copy),imageCount});state.checks.push(...checks);
    if(checks.some(check=>!check.ok))throw Error('草稿已创建，但读回内容不一致：'+checks.filter(x=>!x.ok).map(x=>x.name).join('、'));
    state.status='draft';state.phase='complete';state.verifiedAt=new Date().toISOString();state.message='草稿已创建，类型、标题、完整说明与话题、图片数量均已读回核对；图片画面与顺序请在公众号确认。';state.problem=null;await save();return state;
  }catch(error){
    state.problem=wechatProblem(error);
    state.status=state.mediaId?'unverified':creating?'uncertain':state.problem.status;
    state.message=state.mediaId?'已保留草稿编号。'+(state.phase==='verify'&&!state.problem.code?error.message:state.problem.message):state.status==='uncertain'?'创建结果未知，请先核对公众号草稿箱，避免重复创建。':state.problem.message;
    state.checks.push({name:state.phase==='connection'?'公众号连接与 IP 白名单':state.phase==='verify'?'读回核对':'草稿创建',ok:false});await save();throw Error(state.message);
  }
}
