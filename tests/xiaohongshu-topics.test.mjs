const {test,before,after}=globalThis.__studioEgoTestHarness||await import('node:test');
import assert from 'node:assert/strict';
import {EgoPageAdapter} from '../ego-adapter.mjs';
import {appendXiaohongshuTopics,moveCaretToEnd,verifyXiaohongshuCopy} from '../xiaohongshu-topics.mjs';

const body='换电脑继续用 AI 做项目，先分清三件事：\n\n代码：可以存到 GitHub，再取到新电脑。\n资料：没有上传的照片、记录，要另外备份。\n工具：新电脑要装好项目需要的运行软件。\n\n“仓库”是项目的存放处；“克隆”是取一份到本机；“运行环境”是程序需要的工具。\n\n最后检查：项目能打开，原资料还在，新内容能保存。确认后，再清理旧电脑。';
const tags=['VibeCoding','GitHub入门','项目迁移','小白','黑客松','Github','AICoding'];
const nativePage=globalThis.__studioEgoTestPage;
const browserOptions={skip:!nativePage&&'浏览器用例通过 npm run test:topics-ui 在 Ego Lite 中执行'};
let browser;
before(async()=>{if(nativePage)browser={newPage:async()=>new EgoPageAdapter(nativePage)};});
after(async()=>{globalThis.__studioEgoTestsDone?.();});

// All pages are synthetic, with no account, uploads, remote drafts or network.
async function fixture(options={}){
  const page=await browser.newPage({viewport:{width:800,height:600}});
  await page.setContent('<style>#editor{display:block;width:420px;min-height:240px;white-space:pre-wrap;line-height:24px;}[role=option]{cursor:pointer}.topic-name{display:block}</style><div id="editor" contenteditable="true"></div><div id="suggestions" role="listbox"></div><div class="topic-history"><div class="item">#黑客松</div></div>');
  await page.evaluate(options=>{
    window.topicClicks=0;
    let generation=0;
    const popup=document.querySelector('#suggestions');
    document.addEventListener('keydown',event=>{
      if(event.key==='Escape'){generation++;popup.replaceChildren();}
    });
    document.addEventListener('input',event=>{
      if(event.target.id!=='editor')return;
      const match=event.target.innerText.match(/#([^#\s]+)$/),current=++generation;
      popup.replaceChildren();if(!match||options.noSuggestions)return;
      const tag=match[1];
      setTimeout(()=>{
        if(current!==generation)return;
        const candidates=options.onlySimilar?[tag+'巅峰赛']:[tag+'巅峰赛',tag];
        // The wrong result is deliberately first and shares the full substring.
        for(const name of candidates){
          const row=document.createElement('div');row.setAttribute('role','option');
          const label=document.createElement('span');label.className='topic-name';label.textContent='#'+name;
          const count=document.createElement('span');count.textContent='12.3万篇笔记';row.append(label,count);
          row.addEventListener('click',()=>{
            window.topicClicks++;generation++;popup.replaceChildren();
            const render=()=>{
              const editor=document.querySelector('#editor');
              const walker=document.createTreeWalker(editor,NodeFilter.SHOW_TEXT);let last,node;
              while(node=walker.nextNode())if(node.textContent.endsWith('#'+tag))last=node;
              if(!last)throw Error('没有找到输入的话题');
              const range=document.createRange();range.setStart(last,last.length-tag.length-1);range.setEnd(last,last.length);
              range.deleteContents();const chip=document.createElement('span');chip.contentEditable='false';chip.className='topic-tag';chip.textContent='#'+name;range.insertNode(chip);
              if(options.corruptBody)editor.firstChild.textContent='正文被编辑器改坏';
              // Simulate frameworks replacing the entire editor and losing caret.
              if(options.replaceEditor){const next=editor.cloneNode(true);editor.replaceWith(next);}
              const next=document.querySelector('#editor');next.focus();const reset=document.createRange();reset.selectNodeContents(next);reset.collapse(true);window.getSelection().removeAllRanges();window.getSelection().addRange(reset);
            };
            if(options.renderDelay)setTimeout(render,options.renderDelay);else render();
          });popup.append(row);
        }
      },options.delay??0);
    });
  },options);
  return page;
}
async function read(page){return page.locator('#editor').innerText();}

test('完整校验接受正确正文和末尾标签，包括平台换行及不可见分隔符',()=>{
  assert.equal(verifyXiaohongshuCopy(body+'\n\n'+tags.map(t=>'#'+t).join('\u00a0\u200b'),body,tags).ok,true);
  assert.equal(verifyXiaohongshuCopy(body,body,[]).ok,true);
  assert.equal(verifyXiaohongshuCopy('#小白','',['#小白']).ok,true);
  assert.equal(verifyXiaohongshuCopy('第一段\n\n第二段\n#小白','第一段\n第二段',['小白']).ok,true);
});
test('拒绝正文中插入、末尾缺字、错名、错序、重复和只在正文提到标签',()=>{
  for(const actual of [
    body.replace('工具：','#小白\n工具：')+'\n#小白',
    body.slice(0,-5)+'\n#小白',
    body+'\n#黑客松巅峰赛',
    body+'\n#Github #黑客松',
    body+'\n#黑客松 #Github #Github',
    body+' #黑客松 #Github',
    body+'\n#黑客松 #GitHub',
    body+'\n#黑 客松 #Github',
  ])assert.equal(verifyXiaohongshuCopy(actual,body,['黑客松','Github']).ok,false,actual);
  assert.equal(verifyXiaohongshuCopy('教程里提到 GitHub','教程里提到 GitHub',['GitHub']).ok,false);
  assert.equal(verifyXiaohongshuCopy('AI做项目\n#小白','AI 做项目',['小白']).ok,false);
});
test('七个标签都在多段正文末尾，选择精确名称并处理编辑器替换',browserOptions,async()=>{
  const page=await fixture({replaceEditor:true});
  try{
    const editor=page.locator('#editor');await editor.fill(body);
    // Reproduce the original hazard: the caret starts in the editor centre.
    await editor.click();await editor.press('End');
    await appendXiaohongshuTopics(page,editor,body,tags);
    assert.equal(verifyXiaohongshuCopy(await read(page),body,tags).ok,true);
    assert.equal(await page.locator('.topic-tag').count(),tags.length);
    assert.deepEqual(await page.locator('.topic-tag').allTextContents(),tags.map(t=>'#'+t));
    assert.equal(await page.evaluate(()=>window.topicClicks),tags.length);
  }finally{await page.close();}
});
test('延迟候选和异步编辑器替换不会使下一个标签插入正文',browserOptions,async()=>{
  const page=await fixture({delay:500,renderDelay:250,replaceEditor:true});
  try{
    const editor=page.locator('#editor');await editor.fill(body);
    await appendXiaohongshuTopics(page,editor,body,['黑客松','GitHub入门']);
    assert.equal(verifyXiaohongshuCopy(await read(page),body,['黑客松','GitHub入门']).ok,true);
    assert.deepEqual(await page.locator('.topic-tag').allTextContents(),['#黑客松','#GitHub入门']);
  }finally{await page.close();}
});
test('只有相近候选时保留普通话题，绝不选择巅峰赛',browserOptions,async()=>{
  const page=await fixture({onlySimilar:true});
  try{
    const editor=page.locator('#editor');await editor.fill(body);
    await appendXiaohongshuTopics(page,editor,body,['黑客松','项目迁移']);
    assert.equal(verifyXiaohongshuCopy(await read(page),body,['黑客松','项目迁移']).ok,true);
    assert.equal(await page.evaluate(()=>window.topicClicks),0);
    assert.equal(await page.locator('[role=option]').count(),0);
  }finally{await page.close();}
});
test('长正文滚出视口、嵌套段落和末尾结构化话题都能正确追加',browserOptions,async()=>{
  const page=await fixture();const longBody=Array.from({length:30},(_,i)=>'第'+i+'段：代码和资料需要妥善保存。').join('\n');
  try{
    await page.locator('#editor').evaluate((el,value)=>{
      for(const line of value.split('\n')){const p=document.createElement('p');const strong=document.createElement('strong');strong.textContent=line;p.append(strong);el.append(p);}
    },longBody);
    await appendXiaohongshuTopics(page,page.locator('#editor'),longBody,['GitHub','小白']);
    assert.equal(verifyXiaohongshuCopy(await read(page),longBody,['GitHub','小白']).ok,true);
  }finally{await page.close();}
});
test('textarea和空正文也支持末尾定位，无候选时按原顺序保留',browserOptions,async()=>{
  const page=await fixture({noSuggestions:true});
  try{
    await page.locator('#editor').evaluate(el=>{const t=document.createElement('textarea');t.id='editor';el.replaceWith(t);});
    const editor=page.locator('#editor');await editor.fill(body);
    await appendXiaohongshuTopics(page,editor,body,['小白']);
    assert.equal(verifyXiaohongshuCopy(await editor.inputValue(),body,['小白']).ok,true);
    await editor.fill('');await appendXiaohongshuTopics(page,editor,'',['小白']);
    assert.equal(verifyXiaohongshuCopy(await editor.inputValue(),'',['小白']).ok,true);
    await moveCaretToEnd(editor);await editor.pressSequentially('!');assert.equal((await editor.inputValue()).trim(),'#小白 !');
  }finally{await page.close();}
});
test('正文填写不完整时不添加话题；选中后正文损坏时停止后续输入',browserOptions,async()=>{
  const page=await fixture({corruptBody:true});
  try{
    const editor=page.locator('#editor');await editor.fill(body.slice(0,12));
    await assert.rejects(appendXiaohongshuTopics(page,editor,body,tags),/正文/);
    assert.equal(await page.evaluate(()=>window.topicClicks),0);
    await editor.fill(body);
    await assert.rejects(appendXiaohongshuTopics(page,editor,body,tags),/正文/);
    assert.equal(await page.evaluate(()=>window.topicClicks),1);
  }finally{await page.close();}
});
