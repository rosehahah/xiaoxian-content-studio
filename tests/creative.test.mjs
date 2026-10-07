import test from 'node:test';
import assert from 'node:assert/strict';
import {seedProject,validateProject,cardKey,contentKey,cardsApproved} from '../model.mjs';
import {newCreative,creationErrors,coverErrors,creativeInputKey,currentCover,coverTask,validateCreative} from '../creative.mjs';
import {renderStyledCard} from '../dist/styled-cards.js';
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9N8AAAAASUVORK5CYII=';
function project(mode='portrait'){const p=seedProject();p.id='new-topic';p.visual.creative=newCreative(mode);return p;}
test('真人与文字分流：真人缺照片时引导上传，文字不要求照片',()=>{
 const p=project();assert.match(creationErrors(p)[0],/上传/);assert.throws(()=>coverTask(p),/上传/);
 p.visual.creative.mode='text';assert.deepEqual(creationErrors(p),[]);assert.deepEqual(coverErrors(p),[]);assert.match(coverTask(p),/不需要真人照片/);
 p.visual.creative.mode='ask';assert.match(creationErrors(p)[0],/选择/);
});
test('照片和参考图分开；直接生成任务指向本机输入与内置工具',()=>{
 const p=project();p.content.brief={audience:'',benefit:'',direction:'',references:[{name:'style.png',note:'风格',data:png}]};assert.match(creationErrors(p)[0],/上传/);
 p.visual.creative.portrait={name:'person.png',data:png};assert.doesNotThrow(()=>validateProject(p));const task=coverTask(p);assert.match(task,/creative-input/);assert.match(task,/imagegen/);assert.match(task,/不需要先查找或选择skill/);assert.match(task,/importEndpoint/);
});
test('新标题、照片或风格使旧封面失效；视觉变化不更改正文',()=>{
 const p=project();p.visual.creative.portrait={name:'person.png',data:png};p.visual.creative.result={name:'cover.png',data:png,inputFingerprint:creativeInputKey(p)};p.cardApproval={fingerprint:cardKey(p)};
 assert.ok(currentCover(p));const content=contentKey(p);p.visual.creative.style='minimal';assert.equal(currentCover(p),null);assert.match(coverErrors(p)[0],/当前版本/);assert.equal(cardsApproved(p),false);assert.equal(contentKey(p),content);
 p.visual.creative.style='vivid';assert.ok(currentCover(p));for(const change of [q=>q.content.cards[0].title='新的标题',q=>q.content.topic='换个选题',q=>q.content.brief={direction:'换构图'},q=>q.visual.creative.portrait.data=png.replace('x8AAwM','x8AAwN')]){const q=structuredClone(p);change(q);assert.equal(currentCover(q),null);}
});
test('风格可以跨选题复用，正文不带上一期Tag/Release固定结论',()=>{
 const p=project('text');p.content.cards=[{kind:'editorial',eyebrow:'迁移教程',title:'怎么取回自己的项目',body:'在新电脑打开项目',note:'核对文件',blocks:[{type:'steps',heading:'操作',text:'登录自己的账号\n选择项目\n取回文件'}]}];
 const html=renderStyledCard(p,0);assert.match(html,/选择项目/);assert.match(html,/#109fea/);assert.ok(!html.includes('Tag 找代码'));assert.ok(!html.includes('github-tag-release-20261006'));
 p.visual.creative.style='editorial';assert.match(renderStyledCard(p,0),/#202b38/);
});
test('生成照片不被误报为完成；非法图片与任意风格拒绝保存',()=>{
 const p=project();assert.match(renderStyledCard(p,0),/先上传/);p.visual.creative.portrait={name:'p.png',data:png};assert.match(renderStyledCard(p,0),/等待生成/);
 p.visual.creative.portrait.data='data:image/svg+xml;base64,PHNjcmlwdD4=';assert.throws(()=>validateCreative(p),/照片格式/);
 p.visual.creative.portrait=null;p.visual.creative.style='unknown';assert.throws(()=>validateCreative(p),/设计风格/);
});
