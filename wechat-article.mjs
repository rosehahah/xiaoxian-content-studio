// Standard WeChat article drafts (news), deliberately separate from image posts (newspic).
// Dependencies are injected: tests cannot be confused with actual account verification.
export function verifyWechatArticle(remote,expected){
  const article=remote?.news_item?.[0],decode=value=>String(value||'').replace(/&(?:amp|lt|gt|quot|apos|nbsp);/g,x=>({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'",'&nbsp;':' '})[x]).replace(/&#(x[0-9a-f]+|[0-9]+);/gi,(_,n)=>{const v=n[0].toLowerCase()==='x'?parseInt(n.slice(1),16):Number(n);return v>0&&v<=0x10ffff?String.fromCodePoint(v):'';});
  const plain=value=>decode(String(value||'').replace(/<[^>]*>/g,'')).replace(/\s+/g,' ').trim();
  const values=(html,tag,attribute)=>[...String(html||'').matchAll(new RegExp('<'+tag+'\\b[^>]*>','gi'))].map(m=>{const r=m[0].match(new RegExp('(?:^|\\s)(?:data-)?'+attribute+'\\s*=\\s*["\\x27]([^"\\x27]*)["\\x27]','i'));return decode(r?.[1]||'');});
  const checks=[
    {name:'文章类型',ok:article?.article_type==='news'},
    {name:'标题',ok:article?.title===expected.title},
    {name:'完整正文',ok:plain(article?.content)===plain(expected.content)},
    {name:'图片数量',ok:(String(article?.content||'').match(/<img\b/g)||[]).length===(String(expected.content||'').match(/<img\b/g)||[]).length},
    {name:'图片顺序与地址',ok:JSON.stringify(values(article?.content,'img','src'))===JSON.stringify(values(expected.content,'img','src'))},
    {name:'链接地址',ok:JSON.stringify(values(article?.content,'a','href'))===JSON.stringify(values(expected.content,'a','href'))},
    {name:'封面',ok:Boolean(article?.thumb_media_id)&&article.thumb_media_id===expected.thumb_media_id},
  ];
  if(expected.digest)checks.push({name:'摘要',ok:article?.digest===expected.digest});
  return {ok:checks.every(c=>c.ok),checks};
}
export async function deliverWechatArticle({delivery,article,authorized=false},{preflight,uploadImage,uploadCover,create,read,persist}){
  if(!authorized)throw Object.assign(new Error('此账号的普通文章草稿未获测试授权或尚未验证，保持仅导出'),{status:422});
  if(delivery.status==='unknown_outcome'&&!delivery.remoteId)throw new Error('上次结果未知，请先核对原草稿，不能重复创建');
  if(!delivery.remoteId){
    await preflight();
    const content=await uploadImage(article.content);
    const thumb_media_id=await uploadCover(article.coverAssetId);
    const payload={title:article.title,digest:article.digest||'',content,thumb_media_id,article_type:'news'};
    if(!payload.title||!payload.content||!thumb_media_id)throw new Error('普通文章标题、正文和封面不能为空');
    delivery.expected=payload;delivery.status='unknown_outcome';delivery.message='创建请求即将发送，结果未核对';await persist(delivery);
    try{const created=await create({articles:[payload]});if(!created?.media_id)throw new Error('微信未返回草稿编号');delivery.remoteId=created.media_id;delivery.status='api_accepted';delivery.message='接口已接受普通文章草稿，等待回读';await persist(delivery);}
    catch(error){delivery.status='unknown_outcome';delivery.message='创建结果未知，请先核对草稿';await persist(delivery);throw error;}
  }
  try{
    const remote=await read(delivery.remoteId),verification=verifyWechatArticle(remote,delivery.expected);
    delivery.verification=verification;delivery.status=verification.ok?'draft_verified':'needs_attention';delivery.message=verification.ok?'普通文章草稿已回读核对':'草稿回读不一致，请检查原草稿';await persist(delivery);return delivery;
  }catch(error){delivery.status='needs_attention';delivery.message='已取得编号，回读尚未完成；请继续核对，勿重新创建';await persist(delivery);throw error;}
}
