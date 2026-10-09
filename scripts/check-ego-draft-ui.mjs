import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {EgoPageAdapter} from '../ego-adapter.mjs';
import {fillCreatorDraft} from '../draft-automation.mjs';
import {verifyXiaohongshuCopy} from '../xiaohongshu-topics.mjs';
export async function checkEgoDraftUI(native){
 const page=new EgoPageAdapter(native),body='代码是项目文件。\n资料要单独备份。',tags=['GitHub入门','小白'];
 const image=fileURLToPath(new URL('../dist/cover-references/social-atlas.png',import.meta.url));
 for(const platform of ['xiaohongshu','douyin']){
  await page.setContent('<input type="file" accept="image/png" multiple><input id="title" placeholder="标题"><textarea id="body" placeholder="正文"></textarea><button id="save">保存草稿</button><button id="publish">发布</button>');
  await native.evaluate(()=>{window.saved=0;window.published=0;document.querySelector('#save').onclick=()=>window.saved++;document.querySelector('#publish').onclick=()=>window.published++;});
  const updates=[];await fillCreatorDraft({platform,title:'本机草稿检查',body,tags,imageFiles:[image],page,sessionCheck:async()=>true,onUpdate:async(s,m)=>updates.push(s)});
  const result=await native.evaluate(()=>({title:document.querySelector('#title').value,body:document.querySelector('#body').value,files:document.querySelector('input[type=file]').files.length,saved:window.saved,published:window.published}));
  assert.equal(result.title,'本机草稿检查');assert.equal(result.files,1);assert.equal(result.saved,1);assert.equal(result.published,0);assert.equal(updates.at(-1),'draft');
  if(platform==='xiaohongshu')assert.equal(verifyXiaohongshuCopy(result.body,body,tags).ok,true);else assert.equal(result.body,body+'\n\n'+tags.map(t=>'#'+t).join(' '));
  console.log(JSON.stringify({platform,browser:'ego-lite',passed:true,published:result.published}));
 }
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const space=process.env.STUDIO_EGO_SPACE,source=`const task=await taskSpace(${space?Number(space):JSON.stringify('小苋 · 草稿填写回归')});console.log({spaceId:task.spaceId,url:await task.page('p1').url()});const {checkEgoDraftUI}=await import(${JSON.stringify(fileURLToPath(import.meta.url))});await checkEgoDraftUI(task.page('p1'));${space?'':"await task.finish({keep:[]});"}`;
 const child=spawn('ego-browser',['nodejs','-e',source],{stdio:'inherit'});child.once('error',error=>{console.error(error.message);process.exitCode=1;});child.once('exit',code=>process.exitCode=code??1);
}
