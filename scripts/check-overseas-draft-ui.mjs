import http from 'node:http';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {fillSubstackDraft,inspectSubstackSession} from '../substack-draft.mjs';

// A local editor fixture exercises the real Ego clipboard and DOM. No platform
// account is contacted. Only the inspector's reported origin is substituted.
export async function checkOverseasDraftUI(native){
  const fixture=`<!doctype html><meta charset="utf-8"><title>Substack draft fixture</title><style>body{font:18px system-ui;max-width:760px;margin:40px auto}textarea,input{display:block;width:100%;padding:12px;margin:12px 0}.ProseMirror{border:1px solid #bbb;padding:24px;min-height:320px}button{padding:14px}</style><input placeholder="Title"><input placeholder="Subtitle"><div class="ProseMirror" contenteditable="true"></div><span role="status">Saved</span><button>Continue</button><button>Publish</button><script>
  const title=document.querySelector('[placeholder="Title"]'),subtitle=document.querySelector('[placeholder="Subtitle"]'),body=document.querySelector('.ProseMirror'),key=location.pathname;
  const prior=JSON.parse(localStorage.getItem(key)||'null');if(prior){title.value=prior.title;subtitle.value=prior.subtitle;body.innerHTML=prior.html;}
  document.addEventListener('input',()=>localStorage.setItem(key,JSON.stringify({title:title.value,subtitle:subtitle.value,html:body.innerHTML})));
  window.published=0;document.querySelectorAll('button').forEach(button=>button.onclick=()=>window.published++);
  </script>`;
  const server=http.createServer((req,res)=>{res.writeHead(200,{'Content-Type':'text/html;charset=utf-8'});res.end(fixture);});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const address='http://127.0.0.1:'+server.address().port+'/'+randomUUID();
  const page=new Proxy(native,{get(target,key){if(key==='evaluate')return async(fn,arg)=>{const result=arg===undefined?await target.evaluate(fn):await target.evaluate(fn,arg);if(result&&typeof result==='object'&&'editor' in result&&'actions' in result)result.url='https://qa-fixture.substack.com/publish/post/123';return result;};const value=target[key];return typeof value==='function'?value.bind(target):value;}});
  try{
    await native.goto(address);await native.waitForSelector('.ProseMirror',{state:'visible'});
    assert.equal((await inspectSubstackSession(page)).status,'logged_in');
    const input={title:'A working version to return to',subtitle:'Real native paste, local test only',body:'# Keep a version\n\nBefore changing code, keep a **working copy**.\n\n- Name a commit with a tag.\n- Explain the release.\n\n[GitHub documentation](https://docs.github.com/)\n\n```sh\ngit tag v1.0.0\n```',tags:[]};
    const events=[];const result=await fillSubstackDraft({page,...input,publicationUrl:'https://qa-fixture.substack.com',onUpdate:async(status,message)=>events.push({status,message})});
    assert.equal(result.status,'draft',JSON.stringify(events));
    const evidence=await native.evaluate(()=>({title:document.querySelector('[placeholder="Title"]').value,html:document.querySelector('.ProseMirror').innerHTML,published:window.published}));
    assert.equal(evidence.title,input.title);assert.match(evidence.html,/<strong>working copy<\/strong>/);assert.match(evidence.html,/<a[^>]+href="https:\/\/docs.github.com\//);assert.match(evidence.html,/<pre>/);assert.equal(evidence.published,0);
    await native.fill('[placeholder="Title"]','An unrelated existing draft');
    const stopped=await fillSubstackDraft({page,...input,publicationUrl:'https://qa-fixture.substack.com'});assert.equal(stopped.status,'needs_attention');assert.match(stopped.message,/已有其他内容/);
    assert.equal(await native.evaluate(()=>document.querySelector('[placeholder="Title"]').value),'An unrelated existing draft');
    return {browser:'ego-lite',nativeRichPaste:true,reloadReread:true,unrelatedDraftProtected:true,published:0};
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
  const space=process.env.STUDIO_EGO_SPACE;
  if(space&&!/^\d+$/.test(space))throw Error('STUDIO_EGO_SPACE 必须是 Ego Lite task space 编号');
  const source=`const task=await taskSpace(${space?Number(space):JSON.stringify('小苋 · 海外草稿回归')});console.log({spaceId:task.spaceId});const {checkOverseasDraftUI}=await import(${JSON.stringify(fileURLToPath(import.meta.url))});console.log(await checkOverseasDraftUI(task.page('p1')));${space?'':"await task.finish({keep:[]});"}`;
  const child=spawn('ego-browser',['nodejs','-e',source],{stdio:'inherit'});child.once('error',error=>{console.error(error.message);process.exitCode=1;});child.once('exit',code=>process.exitCode=code??1);
}
