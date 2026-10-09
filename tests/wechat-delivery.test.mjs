import {test} from 'node:test';import assert from 'node:assert/strict';
import {deliverWechat,wechatDescription,wechatProblem,inspectWechatDraft} from '../wechat-delivery.mjs';
const setup=()=>{const copy={title:'测试标题',body:'完整正文\n第二段',tags:['人工智能','AI工具'],delivery:null,history:[]},args={copy,fingerprint:'version',cardFingerprint:'cards',imageCount:2};const remote={news_item:[{article_type:'newspic',title:copy.title,content:wechatDescription(copy),image_info:{image_list:[{},{}]}}]};let uploads=0;const saved=[];const deps={prepare:async()=>({fingerprint:'version',url:'/fallback.zip'}),preflight:async()=>{},create:async()=>{uploads++;return {mediaId:'draft-id'};},read:async()=>remote,persist:async state=>saved.push(structuredClone(state))};return {copy,args,remote,deps,saved,uploads:()=>uploads};};
test('IP 白名单失败在远程上传前停止，保留兜底和可操作错误',async()=>{
  const x=setup();x.deps.preflight=async()=>{throw Error('微信接口 40164：invalid ip 123.123.128.78 ipv6 ::ffff:123.123.128.78, not in whitelist');};
  await assert.rejects(deliverWechat(x.args,x.deps),/白名单/);assert.equal(x.uploads(),0);assert.equal(x.copy.delivery.status,'blocked');assert.equal(x.copy.delivery.problem.ip,'123.123.128.78');assert.ok(x.copy.delivery.fallback);assert.ok(x.saved.length);
});
test('完整读回通过才标为草稿，再次请求只核对已有编号',async()=>{
  const x=setup();await deliverWechat(x.args,x.deps);assert.equal(x.copy.delivery.status,'draft');assert.equal(x.copy.delivery.checks.filter(x=>x.ok).length,7);
  await deliverWechat({...x.args,verifyOnly:true},x.deps);assert.equal(x.uploads(),1);assert.equal(x.copy.delivery.mediaId,'draft-id');
});
test('正文末尾或话题缺失时保留编号，重试不会重复创建',async()=>{
  const x=setup();x.remote.news_item[0].content=x.copy.body;
  await assert.rejects(deliverWechat(x.args,x.deps),/完整说明与话题/);assert.equal(x.copy.delivery.status,'unverified');assert.equal(x.copy.delivery.mediaId,'draft-id');
  await assert.rejects(deliverWechat(x.args,x.deps),/完整说明与话题/);assert.equal(x.uploads(),1);
});
test('创建请求中断结果未知，不允许盲目重复创建',async()=>{
  const x=setup();x.deps.create=async()=>{throw Error('timeout');};await assert.rejects(deliverWechat(x.args,x.deps),/结果未知/);assert.equal(x.copy.delivery.status,'uncertain');
  await assert.rejects(deliverWechat(x.args,x.deps),/不会自动重复创建/);
});
test('读回失败不会丢编号；HTML与空白可正常化但错字不能通过',async()=>{
  const x=setup();x.deps.read=async()=>{throw Error('network');};await assert.rejects(deliverWechat(x.args,x.deps));assert.equal(x.copy.delivery.mediaId,'draft-id');
  x.remote.news_item[0].content=wechatDescription(x.copy).replaceAll('\n','<br>');assert.ok(inspectWechatDraft(x.remote,{title:x.copy.title,description:wechatDescription(x.copy),imageCount:2}).every(x=>x.ok));
  assert.equal(wechatProblem(Error('微信接口 48001：api unauthorized')).status,'blocked');assert.ok(!wechatProblem(Error('secret=abc')).message.includes('abc'));
});
test('已有编号的读回不受本机旧图片被清理影响；失效后清除当前验证标记',async()=>{
  const x=setup();x.copy.delivery={fingerprint:'version',mediaId:'existing',verifiedAt:'old'};x.deps.prepare=async()=>{throw Error('ENOENT');};await deliverWechat({...x.args,verifyOnly:true},x.deps);assert.equal(x.uploads(),0);assert.equal(x.copy.delivery.status,'draft');
  x.deps.read=async()=>{const e=Error('微信接口 40007：invalid media_id');e.wechatCode=40007;throw e;};await assert.rejects(deliverWechat({...x.args,verifyOnly:true},x.deps),/草稿编号已失效/);assert.equal(x.copy.delivery.verifiedAt,undefined);assert.equal(x.copy.delivery.mediaId,'existing');
});
