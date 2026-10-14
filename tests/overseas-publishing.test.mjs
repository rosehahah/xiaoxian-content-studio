import test from 'node:test';
import assert from 'node:assert/strict';
import {getXConfiguration,probeXConnection,markdownToDraftJS,buildXArticlePayload,createXArticleDraft,OverseasPublishingError} from '../overseas-publishing.mjs';

const env={STUDIO_X_ACCESS_TOKEN:'private-test-token-never-return'};
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});

test('X configuration never returns the access token and refuses malformed header values',()=>{
  const configured=getXConfiguration(env);assert.equal(configured.configured,true);assert.deepEqual(configured.missing,[]);
  assert.equal(JSON.stringify(configured).includes(env.STUDIO_X_ACCESS_TOKEN),false);
  assert.equal(getXConfiguration({}).configured,false);
  assert.equal(getXConfiguration({STUDIO_X_ACCESS_TOKEN:'token\r\nBad: value'}).configured,false);
});

test('Markdown maps headings, list, quote and emphasis to the official X wire schema',()=>{
  const result=markdownToDraftJS('# Main\n\nA **clear** and *useful* ~~old~~ idea.\n\n- First\n- Second\n1. Try it\n\n> A quote\n> on two lines\n\n---');
  assert.deepEqual(result.blocks.map(b=>b.type),['header-one','unstyled','unordered-list-item','unordered-list-item','ordered-list-item','blockquote','atomic']);
  const body=result.blocks[1];assert.equal(body.text,'A clear and useful old idea.');
  for(const [style,text] of [['bold','clear'],['italic','useful'],['strikethrough','old']]){
    const range=body.inline_style_ranges.find(r=>r.style===style);assert.equal(body.text.slice(range.offset,range.offset+range.length),text);
  }
  assert.equal(result.blocks[5].text,'A quote\non two lines');assert.equal(result.entities[0].value.type,'divider');
  assert.equal('inlineStyleRanges' in body,false);assert.equal('depth' in body,false);
});

test('Markdown links retain styled labels with UTF-16 offsets and reject unsafe schemes',()=>{
  const result=markdownToDraftJS('🌻 Read [**the guide**](https://example.org/docs?q=one) and [unsafe](javascript:alert(1)).');
  const block=result.blocks[0],range=block.entity_ranges[0];
  assert.equal(block.text.slice(range.offset,range.offset+range.length),'the guide');assert.equal(range.offset,8);
  assert.equal(result.entities[range.key].value.data.url,'https://example.org/docs?q=one');
  assert.equal(block.entity_ranges.length,1);assert.ok(block.text.includes('unsafe'));assert.equal(JSON.stringify(result).includes('javascript:'),false);
});

test('fenced code, inline code and tables survive as official atomic Markdown entities',()=>{
  const md='Use `git tag v1.0` first.\n\n```sh\ngit push origin v1.0\n```\n\n| Name | Result |\n| --- | --- |\n| Tag | Checkpoint |';
  const result=markdownToDraftJS(md);assert.equal(result.blocks.length,3);assert.ok(result.blocks.every(b=>b.type==='atomic'));
  assert.deepEqual(result.entities.map(e=>e.value.type),['markdown','markdown','markdown']);
  assert.equal(result.entities[1].value.data.markdown,'```sh\ngit push origin v1.0\n```');assert.ok(result.entities[2].value.data.markdown.includes('Checkpoint'));
  assert.ok(result.entities.every(e=>e.value.mutability==='mutable'));
});

test('article payload supports optional existing media IDs and local resource ceilings',()=>{
  const payload=buildXArticlePayload({title:' My article ',markdown:'Hello',coverMediaId:'123456789'});
  assert.equal(payload.title,'My article');assert.deepEqual(payload.cover_media,{media_category:'tweet_image',media_id:'123456789'});
  assert.throws(()=>buildXArticlePayload({title:'a'.repeat(201),markdown:'Hi'}),/200/);
  assert.throws(()=>buildXArticlePayload({title:'A',markdown:'x'.repeat(100001)}),/100000/);
  assert.throws(()=>buildXArticlePayload({title:'A',markdown:' '}),/不能为空/);
  assert.throws(()=>buildXArticlePayload({title:'A',markdown:'Hi',coverMediaId:'https://image.test/a.png'}),/media ID/);
});

test('connection probe only checks account identity and leaves Articles access unverified',async()=>{
  const calls=[];const result=await probeXConnection({env,fetchImpl:async(url,options)=>{calls.push({url,options});return json({data:{id:'123',username:'rose',name:'Display name'}});}});
  assert.equal(result.status,'connected');assert.equal(result.articleAccess,'unverified');assert.deepEqual(result.account,{id:'123',username:'rose'});
  assert.equal(calls[0].url,'https://api.x.com/2/users/me');assert.equal(calls[0].options.method,'GET');assert.equal(JSON.stringify(result).includes(env.STUDIO_X_ACCESS_TOKEN),false);
});

test('unconfigured, rejected and malformed probes do not claim login or expose remote errors',async()=>{
  let calls=0;const missing=await probeXConnection({env:{},fetchImpl:async()=>{calls++;}});assert.equal(missing.status,'unconfigured');assert.equal(calls,0);
  const refused=await probeXConnection({env,fetchImpl:async()=>json({detail:env.STUDIO_X_ACCESS_TOKEN},401)});assert.equal(refused.status,'unavailable');assert.equal(refused.code,'x_unauthorized');assert.equal(JSON.stringify(refused).includes(env.STUDIO_X_ACCESS_TOKEN),false);
  const malformed=await probeXConnection({env,fetchImpl:async()=>json({data:{id:'123',username:'<script>'}})});assert.equal(malformed.status,'unavailable');
});

test('successful article creation sends only a draft request and reports API acceptance',async()=>{
  const calls=[];const result=await createXArticleDraft({title:'Checkpoints',markdown:'## Tag\n\n**Save** [the version](https://example.org).'}, {env,fetchImpl:async(url,options)=>{calls.push({url,options});return json({data:{id:'1146654567674912769',title:'Checkpoints'}},201);}});
  assert.equal(calls.length,1);assert.equal(calls[0].url,'https://api.x.com/2/articles/draft');assert.equal(calls[0].options.redirect,'error');
  assert.equal(calls[0].options.headers.Authorization,'Bearer '+env.STUDIO_X_ACCESS_TOKEN);
  const payload=JSON.parse(calls[0].options.body);assert.equal(payload.content_state.blocks[0].type,'header-two');assert.equal(payload.content_state.blocks[1].inline_style_ranges[0].style,'bold');
  assert.equal(result.status,'draft');assert.equal(result.verification,'api-accepted');assert.equal(result.articleAccess,'verified');assert.equal(result.id,'1146654567674912769');assert.equal(JSON.stringify(result).includes(env.STUDIO_X_ACCESS_TOKEN),false);
});

test('invalid input and missing credentials fail before any network mutation',async()=>{
  let calls=0;const fetchImpl=async()=>{calls++;};
  await assert.rejects(createXArticleDraft({title:'',markdown:'Text'},{env,fetchImpl}),e=>e.code==='invalid_article'&&e.outcome==='not-created');
  await assert.rejects(createXArticleDraft({title:'Title',markdown:'Text'},{env:{},fetchImpl}),e=>e.code==='x_not_configured'&&e.outcome==='not-created');assert.equal(calls,0);
});

test('HTTP rejection has known outcome; server failure has unknown outcome; neither retries',async()=>{
  for(const [status,outcome,code] of [[401,'not-created','x_unauthorized'],[403,'not-created','x_access_denied'],[429,'not-created','x_rate_limited'],[503,'unknown','x_http_error']]){
    let calls=0;await assert.rejects(createXArticleDraft({title:'Title',markdown:'Text'},{env,fetchImpl:async()=>{calls++;return json({detail:env.STUDIO_X_ACCESS_TOKEN},status);}}),error=>{
      assert.ok(error instanceof OverseasPublishingError);assert.equal(error.status,status);assert.equal(error.outcome,outcome);assert.equal(error.code,code);assert.equal(error.message.includes(env.STUDIO_X_ACCESS_TOKEN),false);return true;
    });assert.equal(calls,1);
  }
});

test('network interruption, malformed success and missing ID preserve unknown creation outcome',async()=>{
  for(const fetchImpl of [async()=>{throw Error(env.STUDIO_X_ACCESS_TOKEN);},async()=>new Response('not json',{status:201}),async()=>json({data:{title:'No ID'}},201),async()=>json({data:{id:'not-numeric'}},201)]){
    await assert.rejects(createXArticleDraft({title:'Title',markdown:'Text'},{env,fetchImpl}),error=>error.outcome==='unknown'&&!error.message.includes(env.STUDIO_X_ACCESS_TOKEN));
  }
});

test('timeout is bounded even if an injected transport ignores abort',async()=>{
  await assert.rejects(createXArticleDraft({title:'Title',markdown:'Text'},{env,timeoutMs:10,fetchImpl:async()=>new Promise(()=>{})}),error=>error.code==='x_timeout'&&error.outcome==='unknown');
});

test('oversized successful responses are rejected as unknown without returning their content',async()=>{
  await assert.rejects(createXArticleDraft({title:'Title',markdown:'Text'},{env,fetchImpl:async()=>json({data:{id:'123'},extra:'x'.repeat(70000)})}),error=>error.code==='x_invalid_response'&&error.outcome==='unknown');
});
