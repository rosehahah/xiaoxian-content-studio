import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ICONS,searchIcons,materialSvg,composeMaterialArt} from '../dist/icon-library.mjs';
import {seedProject,validateProject,contentKey,cardKey,invalidateVisual,contentApproved,cardsApproved} from '../model.mjs';
test('本机素材字典有完整的三种风格，中文搜索能找到对应概念',()=>{
  assert.ok(ICONS.length>8000);assert.equal(new Set(ICONS.map(x=>x.id)).size,ICONS.length);
  assert.ok(searchIcons('备份','lucide','files').some(x=>x.id==='lucide:archive'));
  assert.ok(searchIcons('电脑','tabler-outline').some(x=>x.name==='device-laptop'));
  assert.ok(searchIcons('cloud','tabler-filled').every(x=>x.set==='tabler-filled'));
  assert.equal(searchIcons('no-such-icon-99999').length,0);
});
test('导出使用具体品牌色，未注册或不安全的SVG不接受',()=>{
  const svg=materialSvg('lucide:laptop','#314e3f');assert.match(svg,/stroke="#314e3f"/);assert.ok(!svg.includes('currentColor'));
  const filled=materialSvg('tabler-filled:archive','#314e3f');assert.match(filled,/fill="#314e3f"/);
  assert.equal(materialSvg('external:script'),'');
  const p=seedProject();p.visual.artwork={0:'external:script'};assert.throws(()=>validateProject(p),/素材不存在/);
  p.visual.artwork={0:'lucide:laptop'};assert.doesNotThrow(()=>validateProject(p));
  for(const x of ICONS)assert.ok(!/<script|<foreignObject|<image|onload=|javascript:|https?:/i.test(x.body));
});
test('改图标只使视觉审核失效，文字保持确认',()=>{
  const p=seedProject();p.contentApproval={fingerprint:contentKey(p)};p.cardApproval={fingerprint:cardKey(p)};const old=cardKey(p);
  p.visual.artwork={0:'lucide:laptop'};invalidateVisual(p);assert.notEqual(cardKey(p),old);assert.ok(contentApproved(p));assert.ok(!cardsApproved(p));
});
test('步骤与提示词的已确认文字不因选素材而丢失',()=>{
  const step='<div class="step-list">取回来确认项目能运行</div>',prompt='<div class="prompt-box">先列清单和理由，不要删除。</div>';
  for(const [kind,art] of [['steps',step],['prompt',prompt]]){
    const rendered=composeMaterialArt(kind,art,'lucide:message-circle');assert.ok(rendered.includes(art));assert.ok(rendered.includes('<svg'));
  }
  assert.equal(composeMaterialArt('prompt',prompt,'external:unknown'),prompt);
});
