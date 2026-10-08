const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));

export function normalizeCopyText(value){
  // Paragraph editors may render a blank line between blocks. Preserve words,
  // spaces within a line and paragraph order while normalizing that rendering.
  return String(value??'').replace(/\r\n?/g,'\n').replace(/\u00a0/g,' ')
    .replace(/[\u200b\ufeff]/g,'').split('\n').map(line=>line.trimEnd()).join('\n')
    .replace(/\n+/g,'\n').trim();
}
export function normalizeTopics(tags){
  return tags.map(tag=>String(tag??'').trim().replace(/^#+/,'').trim()).filter(Boolean);
}
export function verifyXiaohongshuCopy(written,body,tags){
  const actual=normalizeCopyText(written),expected=normalizeCopyText(body),topics=normalizeTopics(tags);
  if(!actual.startsWith(expected))return {ok:false,message:'正文被改动或话题插入了正文中间'};
  const tail=actual.slice(expected.length);
  if(topics.length&&expected&&!tail.startsWith('\n'))return {ok:false,message:'话题没有单独追加在正文末尾'};
  let remaining=tail.trim();
  for(const tag of topics){
    if(!remaining.startsWith('#'+tag))return {ok:false,message:'末尾话题的名称、顺序或数量与配文不一致'};
    remaining=remaining.slice(tag.length+1).trimStart();
  }
  if(remaining)return {ok:false,message:'末尾出现了多余或重复的话题文字'};
  return {ok:true};
}
async function readEditor(editor){
  return editor.evaluate(el=>el instanceof HTMLInputElement||el instanceof HTMLTextAreaElement?el.value:el.innerText);
}
export async function moveCaretToEnd(editor){
  // Focus does not choose a point in the middle of the editor like click does.
  // Resolve the locator again on each call: selecting a topic may replace DOM.
  await editor.evaluate(el=>{
    el.focus();
    if(el instanceof HTMLInputElement||el instanceof HTMLTextAreaElement){
      el.setSelectionRange(el.value.length,el.value.length);return;
    }
    const range=document.createRange();range.selectNodeContents(el);range.collapse(false);
    const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);
  });
}
async function waitForCopy(editor,body,tags,timeout=1800,previousHTML=null){
  const deadline=Date.now()+timeout;let result;
  do{
    result=verifyXiaohongshuCopy(await readEditor(editor),body,tags);
    // Matching text alone is insufficient: the typed #name is already correct
    // before an asynchronous conversion into a structured topic finishes.
    if(result.ok&&(previousHTML===null||await editor.evaluate(el=>el.innerHTML)!==previousHTML))return;
    await wait(80);
  }while(Date.now()<deadline);
  throw new Error(result.message||'话题候选选中后，编辑器未完成更新');
}
async function exactTopicCandidate(page,tag){
  const deadline=Date.now()+1200;
  // Search only topic/suggestion rows, never arbitrary text elsewhere on page.
  const rows=page.locator('[role="listbox"] [role="option"], [class*="topic"] [class*="item"], [class*="suggest"] [class*="item"]');
  do{
    for(let i=0;i<Math.min(await rows.count(),40);i++){
      const row=rows.nth(i);if(!await row.isVisible())continue;
      const name=await row.evaluate(el=>{
        if(el.closest('[contenteditable="true"]'))return null;
        // Avoid matching topic history or other permanent rows outside the popup.
        if(!el.closest('[role="listbox"], [class*="suggest"], [class*="topic"][class*="list"], [class*="topic"][class*="search"], [class*="topic"][class*="panel"], [class*="topic"][class*="popover"]'))return null;
        const label=el.querySelector('[data-topic-name], .topic-name, .topic-title, [class*="name"], [class*="title"]');
        // Popularity metadata often follows the name on a separate line.
        return (label?.innerText||el.innerText).split('\n')[0].trim().replace(/^#+/,'').trim();
      });
      if(name===tag)return row;
    }
    await wait(80);
  }while(Date.now()<deadline);
  return null;
}
export async function appendXiaohongshuTopics(page,editor,body,tags){
  if(!editor)throw new Error('未识别到正文编辑器');
  // Do not append to a partial or already corrupted fill.
  await waitForCopy(editor,body,[]);
  const topics=normalizeTopics(tags);if(!topics.length)return;
  await moveCaretToEnd(editor);
  if(normalizeCopyText(body)){await editor.press('Enter');await editor.press('Enter');}
  const appended=[];
  for(const tag of topics){
    await moveCaretToEnd(editor);
    await editor.pressSequentially('#'+tag,{delay:25});
    const candidate=await exactTopicCandidate(page,tag);
    if(candidate){
      // If a click/update fails, stop rather than risk adding a duplicate topic.
      const previousHTML=await editor.evaluate(el=>el.innerHTML);
      await candidate.click({timeout:1200});
      await candidate.waitFor({state:'hidden',timeout:1800});
      await waitForCopy(editor,body,[...appended,tag],1800,previousHTML);
    }else{
      // Close stale suggestions before committing the plain #topic fallback.
      await editor.press('Escape');
    }
    await moveCaretToEnd(editor);await editor.press('Space');
    appended.push(tag);
    await waitForCopy(editor,body,appended);
  }
}
