import test from 'node:test';
import assert from 'node:assert/strict';
import {seedProject,validateProject,validateContent,cardKey,contentKey,cardsApproved} from '../model.mjs';
import {newCreative,creationErrors,coverErrors,creativeInputKey,currentCover,coverTask,coverPrompt,validateCreative} from '../creative.mjs';
import {COVER_REFERENCES,recommendedReferences} from '../cover-library.mjs';
import {renderStyledCard} from '../dist/styled-cards.js';
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9N8AAAAASUVORK5CYII=';
function project(mode='portrait'){const p=seedProject();p.id='new-topic';p.visual.creative=newCreative(mode);p.visual.creative.referenceId=mode==='text'?'objects':'headline';return p;}
function select(p){const c=p.visual.creative,x={id:'candidate-one',name:'cover.png',data:png,inputFingerprint:creativeInputKey(p)};c.candidates=[x];c.selectedCandidateId=x.id;c.result={...x};}
test('新建内容不被封面方式、参考或缺照片阻塞；生成必须先准备素材',()=>{
 const p=seedProject();p.visual.creative=newCreative();assert.deepEqual(validateContent(p),[]);assert.match(creationErrors(p).join(),/参考/);assert.throws(()=>coverTask(p),/参考/);
 p.visual.creative.referenceId='objects';p.visual.creative.mode='text';assert.deepEqual(creationErrors(p),[]);assert.match(coverTask(p),/不需要真人照片/);assert.match(coverErrors(p)[0],/挑选/);
 p.visual.creative.mode='portrait';assert.match(creationErrors(p)[0],/上传/);
});
test('参考图与身份分离；原始照片只用于身份，参考只能借鉴设计',()=>{
 const p=project();p.visual.creative.referenceId='custom';p.visual.creative.reference={name:'layout.png',data:png};assert.match(creationErrors(p)[0],/上传/);
 p.visual.creative.portrait={name:'person.png',data:png};assert.doesNotThrow(()=>validateProject(p));const task=coverTask(p);assert.match(task,/referencePath/);assert.match(task,/imagegen/);assert.match(task,/不需要先查找或选择skill/);assert.match(task,/导入只加入候选/);
 const prompt=coverPrompt(p);assert.match(prompt,/COMPOSITION reference only/);assert.match(prompt,/ignore all its typography/);assert.match(prompt,/small mobile thumbnail/);
});
test('导入候选不等于选中；首图只使用用户已选的当前候选',()=>{
 const p=project('text'),c=p.visual.creative;c.candidates=[{id:'c1',name:'one.png',data:png,inputFingerprint:creativeInputKey(p)}];assert.equal(currentCover(p),null);assert.match(renderStyledCard(p,0),/挑选成品/);
 c.selectedCandidateId='c1';c.result={...c.candidates[0]};assert.ok(currentCover(p));assert.match(renderStyledCard(p,0),/sc-image/);assert.doesNotThrow(()=>validateCreative(p));c.result.data=png.replace('x8AAwM','x8AAwN');assert.throws(()=>validateCreative(p),/不一致/);
});
test('封面文字、身份、参考或偏好使候选失效；内页配色独立，正文确认不受视觉变化影响',()=>{
 const p=project();p.visual.creative.portrait={name:'person.png',data:png};select(p);p.cardApproval={fingerprint:cardKey(p)};const key=creativeInputKey(p),content=contentKey(p);
 p.visual.creative.style='minimal';assert.equal(creativeInputKey(p),key);assert.ok(currentCover(p));assert.equal(cardsApproved(p),false);assert.equal(contentKey(p),content);
 for(const change of [q=>q.content.cards[0].title='新标题',q=>q.content.topic='新选题',q=>q.visual.creative.referenceId='scene',q=>q.visual.creative.coverDirection='换构图',q=>q.visual.creative.coverCopy.points=['真实要点'],q=>q.visual.creative.portrait.data=png.replace('x8AAwM','x8AAwN')]){const q=structuredClone(p);change(q);assert.equal(currentCover(q),null);}
});
test('封面文案独立保存并严格输入；不从参考虚构成绩或效果',()=>{
 const p=project('text'),before=contentKey(p);p.visual.creative.coverCopy={headline:'换电脑\n先存好',kicker:'项目迁移',points:['备份代码','保存草稿'],benefit:'新电脑接着做'};assert.equal(contentKey(p),before);
 const prompt=coverPrompt(p);assert.match(prompt,/备份代码/);assert.match(prompt,/use EXACTLY/);assert.match(prompt,/Never invent numerical claims/);p.visual.creative.coverCopy.points.push('3','4');assert.throws(()=>validateCreative(p),/最多3条/);
});
test('参考库覆盖真人、物件、文字、自然场景与社媒信息结构；按主题排序不固定样式',()=>{
 assert.equal(COVER_REFERENCES.length,9);assert.equal(new Set(COVER_REFERENCES.map(x=>x.cell)).size,9);assert.ok(COVER_REFERENCES.some(x=>x.mode==='text'));assert.ok(COVER_REFERENCES.every(x=>x.learn&&x.composition));assert.notEqual(recommendedReferences('我的创作经历')[0].id,recommendedReferences('搬家迁移对比')[0].id);
 const p=project('text');p.content.cards[1]={kind:'editorial',eyebrow:'迁移教程',title:'取回项目',body:'打开项目',note:'核对文件',blocks:[{type:'steps',heading:'操作',text:'登录账号\n选择项目\n取回文件'}]};const html=renderStyledCard(p,1);assert.match(html,/选择项目/);assert.ok(!html.includes('Tag 找代码'));assert.ok(!html.includes('github-tag-release-20261006'));
});
test('旧项目与单结果接口保持兼容；新流程拒绝非法图片、候选和任意样式',()=>{
 const p=seedProject();p.visual.creative={mode:'portrait',style:'vivid',portrait:{name:'p.png',data:png},result:null};p.visual.creative.result={name:'cover.png',data:png,inputFingerprint:creativeInputKey(p)};assert.ok(currentCover(p));p.visual.creative.style='minimal';assert.equal(currentCover(p),null);
 const q=project();q.visual.creative.portrait={name:'p.svg',data:'data:image/svg+xml;base64,PHN2Zz4='};assert.throws(()=>validateCreative(q),/照片格式/);q.visual.creative.portrait=null;q.visual.creative.style='unknown';assert.throws(()=>validateCreative(q),/设计风格/);
});
