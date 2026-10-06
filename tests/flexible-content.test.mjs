import test from 'node:test';
import assert from 'node:assert/strict';
import {seedProject,validateContent,validateProject,contentKey,cardKey,contentApproved,cardsApproved,invalidateVisual} from '../model.mjs';
import {renderFlexibleCard} from '../dist/flexible-cards.js';
const palette={ink:'#314e3f',soft:'#e6ebd5',accent:'#c1cc94',line:'#dbe2c9',mute:'#94a17a'};
const card={kind:'editorial',eyebrow:'',title:'',body:'',note:'',blocks:[{type:'text',heading:'一个具体例子',text:'解释'.repeat(100)},{type:'compare',heading:'怎样区分',text:'保留 | 项目的原始内容\n检查 | 能否重新取回'},{type:'callout',heading:'成功标准',text:'看到自己期望的运行结果'}]};
test('自由编排不要求标题，不用短字数阻止实质内容，超过旧页数也可保存',()=>{
 const p=seedProject();p.content.cards=Array.from({length:10},()=>structuredClone(card));p.visual.artwork={9:'lucide:archive'};p.visual.pageLayouts={9:'split'};
 assert.deepEqual(validateContent(p),[]);assert.doesNotThrow(()=>validateProject(p));
 p.content.cards[0]={...structuredClone(card),blocks:[]};assert.match(validateContent(p)[0],/实质内容/);
});
test('区块和逐页编排参与审核指纹；改编排不撤销内容确认',()=>{
 const p=seedProject();p.content.cards=[structuredClone(card)];p.contentApproval={fingerprint:contentKey(p)};p.cardApproval={fingerprint:cardKey(p)};
 p.visual.pageLayouts={0:'split'};invalidateVisual(p);assert.equal(contentApproved(p),true);assert.equal(cardsApproved(p),false);
 p.content.cards[0].blocks[0].text='补充真实例子';assert.equal(contentApproved(p),false);
});
test('参考图可保存并参与内容版本，脚本或远程地址不能作为图片输入',()=>{
 const p=seedProject();const key=contentKey(p);p.content.brief={audience:'外行',benefit:'理解差别',direction:'参考层级',references:[{name:'ref.png',note:'配色',data:'data:image/png;base64,aGVsbG8='}]};
 assert.doesNotThrow(()=>validateProject(p));assert.notEqual(contentKey(p),key);
 p.content.brief.references[0].data='data:image/svg+xml;base64,PHNjcmlwdD4=';assert.throws(()=>validateProject(p),/参考图格式/);
 p.content.brief.references[0].data='https://example.com/a.png';assert.throws(()=>validateProject(p),/参考图格式/);
});
test('自由区块导出保留内容与分组，用户文字被转义，不执行HTML',()=>{
 const p=seedProject();p.content.cards=[structuredClone(card)];p.content.cards[0].blocks.push({type:'steps',heading:'<script>',text:'第一步\n第二步'});p.visual.pageLayouts={0:'split'};p.visual.artwork={0:'lucide:archive'};
 const html=renderFlexibleCard(p,0,'品牌',palette);assert.match(html,/composition-split/);assert.match(html,/保留/);assert.match(html,/项目的原始内容/);assert.match(html,/成功标准/);assert.match(html,/第二步/);assert.ok(!html.includes('<script>'));assert.match(html,/&lt;script&gt;/);assert.ok(!html.includes('var(--poster-'));assert.ok(!html.includes('currentColor'));assert.ok(!html.includes('存好'));
});
test('资源保护只拒绝畸形数据，不限定表达结构',()=>{
 const p=seedProject();p.content.cards=[structuredClone(card)];p.content.cards[0].blocks[0].type='script';assert.throws(()=>validateProject(p),/区块/);
 p.content.cards[0]=structuredClone(card);p.visual.pageLayouts={0:'external-html'};assert.throws(()=>validateProject(p),/编排/);
});
