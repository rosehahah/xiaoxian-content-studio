import test from 'node:test';
import assert from 'node:assert/strict';
import {classifySubstackSession,inspectSubstackSession,markdownToSubstackHTML,verifySubstackContent,fillSubstackDraft} from '../substack-draft.mjs';

const blank=()=>({url:'https://rose.substack.com/publish/post/123',text:'Posts Drafts Stats',editor:true,dashboard:false,challenge:false,loginForm:false,saved:true,title:{selector:'#title',text:''},subtitle:{selector:'#subtitle',text:''},body:{selector:'.tiptap',text:'',links:[],images:[]},tags:[],tagInput:null,actions:[{selector:'#continue',text:'Continue',disabled:false},{selector:'#publish',text:'Publish',disabled:false}]});
function fakePage(initial=blank(),options={}){
  let evidence=structuredClone(initial),pendingTag='';const actions=[];
  const page={
    actions,get evidence(){return evidence;},snapshot:async()=>{actions.push(['snapshot']);},
    evaluate:async fn=>{assert.equal(fn.name,'readSubstackDOM');return structuredClone(evidence);},
    fill:async(selector,text)=>{actions.push(['fill',selector,text]);if(selector==='#title'){evidence.title.text=text;if(options.expireAfterTitle)evidence.loginForm=true;}else if(selector==='#subtitle')evidence.subtitle.text=text;else if(selector==='#tags')pendingTag=text;else assert.fail('Unexpected fill target');},
    focus:async selector=>{assert.equal(selector,'.tiptap');actions.push(['focus',selector]);},
    keyboard:{paste:async payload=>{actions.push(['paste',payload]);evidence.body.text=options.truncatePaste?payload.text.slice(0,-8):payload.text;evidence.body.links=[...payload.html.matchAll(/href="([^"]*)"/g)].map(m=>m[1].replace(/&amp;/g,'&'));evidence.body.images=[...payload.html.matchAll(/<img src="([^"]*)" alt="([^"]*)">/g)].map(m=>({src:m[1],alt:m[2]}));}},
    press:async(selector,key)=>{assert.equal(selector,'#tags');assert.equal(key,'Enter');actions.push(['press',selector,key]);evidence.tags.push(pendingTag);},
    click:async selector=>{
      actions.push(['click',selector]);assert.ok(['#create','#article'].includes(selector),'Never click a final publishing action');
      if(selector==='#create')evidence.actions=[{selector:'#article',text:'Article'}];else evidence={...blank(),url:evidence.url};
    },
    waitForFunction:async(fn,arg,config)=>{assert.equal(arg,undefined);assert.ok(config.timeout<=15000);if(options.saveTimeout&&config.timeout===15000)throw Error('Timeout waiting for saved');},
    waitForSelector:async selector=>{assert.ok(selector.includes('.tiptap'));if(options.noEditorAfterReload)throw Error('No editor');},
    reload:async()=>{actions.push(['reload']);if(options.truncateReload)evidence.body.text=evidence.body.text.slice(0,-8);if(options.dropLinksReload)evidence.body.links=[];if(options.expireReload)evidence.loginForm=true;},
  };return page;
}

test('Substack inspection prioritizes login and verification over any editor evidence',async()=>{
  assert.equal(classifySubstackSession({...blank(),challenge:true}).status,'needs_attention');
  assert.equal(classifySubstackSession({...blank(),loginForm:true}).status,'waiting_login');
  assert.equal(classifySubstackSession({...blank(),url:'https://substack.com/sign-in'}).status,'waiting_login');
  assert.equal(classifySubstackSession({...blank(),editor:false,dashboard:true}).status,'logged_in');
  assert.equal(classifySubstackSession({...blank(),editor:false,dashboard:false,url:'https://rose.substack.com/'}).status,'unknown');
  assert.equal(classifySubstackSession({...blank(),url:'https://evilsubstack.com/publish'}).status,'unknown');
  assert.equal((await inspectSubstackSession(fakePage())).status,'logged_in');
});

test('Substack HTML preserves rich text, lists, links, code, tables and escaped source',()=>{
  const html=markdownToSubstackHTML('# Guide\n\nA **bold** and *italic* [link](https://example.org) with `code`.\n\n- One\n- Two\n\n> Quote\n\n```js\nconsole.log("<test>")\n```\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n<script>alert(1)</script>');
  for(const snippet of ['<h1>Guide</h1>','<strong>bold</strong>','<em>italic</em>','<a href="https://example.org/">link</a>','<code>code</code>','<ul>','<li>Two</li>','<blockquote>Quote</blockquote>','<pre><code>console.log(&quot;&lt;test&gt;&quot;)</code></pre>','<table>','&lt;script&gt;'])assert.ok(html.includes(snippet),snippet);
  assert.equal(html.includes('<script>'),false);assert.equal(html.includes('\ue000'),false);
});

test('complete content verification catches tail loss, subtitles, links, images and tags',()=>{
  const input={title:'Guide',subtitle:'Start here',body:'Read [this](https://example.org) to the very end.',tags:['AI']};
  const evidence={...blank(),title:{text:'Guide'},subtitle:{text:'Start here'},body:{text:'Read this to the very end.',links:['https://example.org/'],images:[]},tags:['AI']};
  assert.equal(verifySubstackContent(evidence,input).ok,true);
  assert.equal(verifySubstackContent({...evidence,body:{...evidence.body,text:'Read this'}},input).ok,false);
  assert.equal(verifySubstackContent({...evidence,body:{...evidence.body,links:[]}},input).ok,false);
  assert.equal(verifySubstackContent({...evidence,tags:[]},input).ok,false);
  assert.equal(verifySubstackContent({...evidence,subtitle:{text:''}},input).ok,false);
});

test('blank article uses native Ego paste then confirms autosave with reload and full reread',async()=>{
  const page=fakePage(),updates=[];
  const result=await fillSubstackDraft({page,title:'Guide',subtitle:'Start here',body:'# First\n\nRead [the guide](https://example.org) all the way.',onUpdate:async s=>updates.push(s),publicationUrl:'https://rose.substack.com'});
  assert.equal(result.status,'draft');assert.ok(page.actions.some(a=>a[0]==='reload'));assert.equal(page.actions.filter(a=>a[0]==='paste').length,1);assert.equal(page.actions.filter(a=>a[0]==='click').length,0);
  assert.deepEqual(updates,['filling','ready_to_save','draft']);assert.equal(result.draftUrl,'https://rose.substack.com/publish/post/123');
});

test('safe dashboard Create and Article flow never clicks Continue or Publish',async()=>{
  const initial={...blank(),url:'https://rose.substack.com/publish',editor:false,dashboard:true,actions:[{selector:'#create',text:'Create'},{selector:'#continue',text:'Continue'},{selector:'#publish',text:'Publish'}]},page=fakePage(initial);
  const result=await fillSubstackDraft({page,title:'Guide',body:'Complete body.'});assert.equal(result.status,'draft');
  assert.deepEqual(page.actions.filter(a=>a[0]==='click').map(a=>a[1]),['#create','#article']);
});

test('existing unrelated title or image-only editor is never changed',async()=>{
  for(const initial of [{...blank(),title:{selector:'#title',text:'Other story'}},{...blank(),body:{selector:'.tiptap',text:'',links:[],images:[{src:'https://example.org/existing.png',alt:''}]}}]){
    const page=fakePage(initial);const result=await fillSubstackDraft({page,title:'Guide',body:'Complete body.'});assert.equal(result.status,'needs_attention');assert.equal(page.actions.filter(a=>['fill','paste','click'].includes(a[0])).length,0);
  }
});

test('exact existing copy is reread without pasting or overwriting again',async()=>{
  const initial={...blank(),title:{selector:'#title',text:'Guide'},body:{selector:'.tiptap',text:'Complete body.',links:[],images:[]}},page=fakePage(initial);
  assert.equal((await fillSubstackDraft({page,title:'Guide',body:'Complete body.'})).status,'draft');assert.equal(page.actions.filter(a=>['fill','paste'].includes(a[0])).length,0);
});

test('missing login, wrong publication and session expiry stop before body mutation',async()=>{
  for(const [initial,options,url] of [[{...blank(),loginForm:true},{},undefined],[blank(),{},'https://other.substack.com'],[blank(),{expireAfterTitle:true},undefined]]){
    const page=fakePage(initial,options);const result=await fillSubstackDraft({page,title:'Guide',body:'Complete body.',publicationUrl:url});assert.equal(result.status,'needs_attention');assert.equal(page.actions.filter(a=>a[0]==='paste').length,0);
  }
});

test('no saved evidence or failed reload reread never reports a complete draft',async()=>{
  for(const [options,status] of [[{saveTimeout:true},'filled'],[{truncatePaste:true},'needs_attention'],[{truncateReload:true},'needs_attention'],[{dropLinksReload:true},'needs_attention'],[{expireReload:true},'needs_attention']]){
    const page=fakePage(blank(),options);const result=await fillSubstackDraft({page,title:'Guide',body:'Read [the guide](https://example.org) all the way to the end.'});assert.equal(result.status,status);
  }
});

test('unavailable category tags are a partial result even after persisted full article',async()=>{
  const page=fakePage();const result=await fillSubstackDraft({page,title:'Guide',body:'Complete body.',tags:['AI']});assert.equal(result.status,'filled');assert.match(result.message,/分类标签需手动/);assert.ok(page.actions.some(a=>a[0]==='reload'));
});

test('visible safe tag field is filled and verified after reload',async()=>{
  const page=fakePage({...blank(),tagInput:{selector:'#tags',text:''}});const result=await fillSubstackDraft({page,title:'Guide',body:'Complete body.',tags:['AI','Product']});assert.equal(result.status,'draft');assert.deepEqual(page.evidence.tags,['AI','Product']);
});

test('Markdown image references are pasted as images and image count is verified',async()=>{
  const body='A diagram:\n\n![Workflow](https://example.org/flow.png)',page=fakePage();
  const result=await fillSubstackDraft({page,title:'Guide',body});assert.equal(result.status,'draft');assert.equal(page.evidence.body.images.length,1);assert.equal(page.evidence.body.images[0].alt,'Workflow');
});

test('unsupported publication URL and invalid input fail before browser activity',async()=>{
  const page=fakePage();await assert.rejects(fillSubstackDraft({page,title:'Guide',body:'Text',publicationUrl:'http://rose.substack.com'}),/HTTPS/);assert.equal(page.actions.length,0);
  await assert.rejects(fillSubstackDraft({page,title:'Guide',body:'Text',tags:['']}),/标签格式/);
});
