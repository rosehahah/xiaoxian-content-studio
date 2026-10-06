import fs from 'node:fs/promises';

const issue='github-tag-release-20261006';
const source=`examples/${issue}`;
const target=`dist/issues/${issue}`;
await fs.mkdir(`${target}/assets`,{recursive:true});
await fs.copyFile(`${source}/xhs-cover-v7/04-明亮综艺感.png`,`${target}/assets/cover-selected.png`);
await fs.copyFile(`${source}/project.json`,`${target}/assets/project.json`);

const html=`<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>GitHub Tag + Release｜整期图卡</title><link rel="stylesheet" href="../../styles.css">
<style>
body{background:#eef1f4;color:#111}.issue-bar{position:sticky;top:0;z-index:20;background:#ffffffee;backdrop-filter:blur(14px);border-bottom:1px solid #dfe3e8;padding:18px 28px;display:flex;align-items:center;justify-content:space-between}.issue-bar b{font-size:18px}.issue-bar span{font-size:13px;color:#68717b}.issue-wrap{max-width:1480px;margin:0 auto;padding:34px 28px 70px}.issue-note{background:#fff;border:1px solid #dfe3e8;border-radius:15px;padding:20px 24px;margin-bottom:30px;line-height:1.8}.issue-note strong{display:block;font-size:18px;margin-bottom:5px}.issue-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:26px}.issue-card{min-width:0}.issue-card-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;font-size:12px;color:#68717b}.issue-stage{aspect-ratio:3/4;overflow:hidden;border-radius:12px;box-shadow:0 16px 45px #18212b18;background:#fff}.issue-scale{width:1080px;height:1440px;transform-origin:top left}@media(max-width:1050px){.issue-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:640px){.issue-grid{grid-template-columns:1fr}.issue-wrap{padding:22px 14px 55px}.issue-bar{padding:14px 16px}.issue-bar span{display:none}}
</style></head><body><header class="issue-bar"><b>GitHub 小白自救 · 图卡预览</b><span>7 张 · 封面 + 6 张教程 · 待你审核</span></header><main class="issue-wrap"><div class="issue-note"><strong>AI 改崩了？先别急着重做。</strong>这期用 Tag + Release 留住“能用的那一版”。封面采用你选定的真人 AIGC 版本；教程页使用可编辑 HTML 排版。</div><section class="issue-grid" id="grid"></section></main>
<script type="module">import {renderTagReleaseCard} from '../../tag-release-cards.js';
const project=await (await fetch('./assets/project.json')).json();const grid=document.querySelector('#grid');
grid.innerHTML=project.content.cards.map((card,i)=>\`<article class="issue-card"><div class="issue-card-head"><b>图 \${String(i+1).padStart(2,'0')}</b><span>\${i?'教程页':'已选封面'}</span></div><div class="issue-stage"><div class="issue-scale">\${renderTagReleaseCard(project,i)}</div></div></article>\`).join('');
const resize=()=>document.querySelectorAll('.issue-stage').forEach(stage=>{const scale=stage.clientWidth/1080;stage.querySelector('.issue-scale').style.transform=\`scale(\${scale})\`});resize();new ResizeObserver(resize).observe(grid);
</script></body></html>`;
await fs.writeFile(`${target}/index.html`,html);
console.log(`Rendered ${target}/index.html`);
