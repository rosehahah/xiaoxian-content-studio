import test from 'node:test';
import assert from 'node:assert/strict';
import {seedProject,validateProject,cardKey,contentKey} from '../model.mjs';
import {newCreative,creativeInputKey} from '../creative.mjs';
import {renderConceptCard} from '../dist/concept-cards.js';

test('内页风格独立于封面输入，修改后只改变成图指纹',()=>{
  const p=seedProject();p.visual.creative=newCreative();
  const coverKey=creativeInputKey(p),bodyKey=contentKey(p),visualKey=cardKey(p);
  p.visual.readingStyle='paper';
  assert.doesNotThrow(()=>validateProject(p));
  assert.equal(creativeInputKey(p),coverKey);assert.equal(contentKey(p),bodyKey);assert.notEqual(cardKey(p),visualKey);
  p.visual.readingStyle='untrusted-html';assert.throws(()=>validateProject(p),/内页风格/);
});
test('概念图保留用户区块与编辑结果，转义文本，不把封面当成内页生成',()=>{
  const p=seedProject();p.visual.readingStyle='paper';p.visual.pageLayouts={1:'split'};
  p.content.cards[1]={kind:'editorial',eyebrow:'词语解释',title:'<script>alert(1)</script>',body:'引言',note:'必要条件',blocks:[{type:'compare',heading:'关系',text:'目标 | 查资料\n结果 | 可用方案'},{type:'steps',heading:'动作',text:'你给要求\n你来确认'}]};
  const html=renderConceptCard(p,1);
  assert.match(html,/cc-layout-split/);assert.match(html,/查资料/);assert.match(html,/可用方案/);assert.match(html,/你来确认/);assert.match(html,/必要条件/);
  assert.ok(!html.includes('<script>'));assert.match(html,/&lt;script&gt;/);assert.equal(renderConceptCard(p,0),'');
  p.content.cards[1].blocks[0].text='新的目标 | 新的结果';
  const updated=renderConceptCard(p,1);assert.match(updated,/新的结果/);assert.ok(!updated.includes('查资料'));
});

test('极简内页保留全部解释和页码，封面继续独立',()=>{
 const p=seedProject();p.visual.readingStyle='plain';
 p.content.cards[1]={kind:'editorial',eyebrow:'辅助引题',title:'一个概念',body:'必要引言',note:'适用条件',blocks:[{type:'compare',heading:'关系',text:'目标 | 查资料\n结果 | 可用方案'},{type:'steps',heading:'动作',text:'给出条件\n核对结果'}]};
 assert.doesNotThrow(()=>validateProject(p));const html=renderConceptCard(p,1);
 for(const text of ['一个概念','必要引言','关系','查资料','可用方案','动作','给出条件','核对结果','适用条件','01 / 04'])assert.ok(html.includes(text));
 assert.match(html,/cc-minimal/);assert.ok(!html.includes('<svg'));assert.ok(!html.includes('cc-marker'));assert.equal(renderConceptCard(p,0),'');
});

test('彩色内页保留内容与安全转义，能力插图不影响选定封面',()=>{
 const p=seedProject();p.visual.creative=newCreative();
 const coverKey=creativeInputKey(p),bodyKey=contentKey(p),before=cardKey(p);
 p.visual.readingStyle='editorial';assert.doesNotThrow(()=>validateProject(p));
 assert.equal(creativeInputKey(p),coverKey);assert.equal(contentKey(p),bodyKey);assert.notEqual(cardKey(p),before);
 p.content.cards[1]={kind:'editorial',title:'Muse 和 Grok Bot，\n分别强调什么？',body:'概念说明',note:'访问条件',blocks:[{type:'text',heading:'Muse：目标跟进',text:'<img onerror=alert(1)>'},{type:'text',heading:'Grok Bot：工具',text:'正文'}]};
 const html=renderConceptCard(p,1);assert.match(html,/cc-editorial/);assert.match(html,/cc-title-accent/);assert.match(html,/cc-product-name/);
 assert.match(html,/目标跟进与浏览器工具/);assert.match(html,/概念说明/);assert.match(html,/访问条件/);assert.match(html,/&lt;img/);assert.ok(!html.includes('<img onerror'));
 p.content.cards[1].title='Dots 和 Manus，\n又在做什么？';p.content.cards[1].blocks[0].heading='Dots：上下文';p.content.cards[1].blocks[1].heading='Manus：交付';assert.match(renderConceptCard(p,1),/连接上下文与交付文件/);
 assert.equal(renderConceptCard(p,0),'');
});
