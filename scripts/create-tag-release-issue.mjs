import fs from 'node:fs/promises';
import {seedProject,validateProject,validateContent,validatePlatform} from '../model.mjs';
import {renderFlexibleCard} from '../dist/flexible-cards.js';
const block=(type,heading,text)=>({type,heading,text});
const card=(eyebrow,title,body,blocks,note='')=>({kind:'editorial',eyebrow,title,body,blocks,note});
const p=seedProject();
p.id='github-tag-release-20261006';p.stage='content';p.contentApproval=null;p.cardApproval=null;
p.content={
 topic:'让AI大改前，先留住能用的版本',series:'外行人的 AI 学习笔记',
 takeaway:'给验证过的代码提交加Tag，再用Release写清变化、使用方法和已知问题；能取回并验证，才算留好了这版。',
 brief:{audience:'用AI做过小项目，但还不熟悉Git与版本管理的人',benefit:'分清Tag与Release，能按网页路径建立一份有说明、可核对的版本记录',direction:'封面使用已选定的真人 AIGC 明亮综艺风；内页使用蓝、黄、红高对比教程编排。区分概念、操作与验收；示例不是用户实测，预览待确认。',references:[]},
 sources:[
 {title:'GitHub：关于Release',url:'https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases',supports:'Tag与Release关系、说明、附件与源码下载',checkedAt:'2026-10-06'},
 {title:'GitHub：管理Release',url:'https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository',supports:'写权限、网页操作、Target、Save draft与Publish release',checkedAt:'2026-10-06'},
 {title:'GitHub：下载源码归档',url:'https://docs.github.com/en/repositories/working-with-files/using-files/downloading-source-code-archives',supports:'Source code下载、提交快照、Tag可能改指向',checkedAt:'2026-10-06'},
 {title:'Git：Tagging',url:'https://git-scm.com/book/en/v2/Git-Basics-Tagging',supports:'Tag标记提交，本地Tag需另行推送，旧Tag取回',checkedAt:'2026-10-06'}
 ],
 cards:[
 card('GitHub 入门 · 留住好用的那一版','让 AI 大改之前，\n给能用的这一版\n留个名字。','刚跑通的小工具，还想让 AI 继续改？\n先记住这一版在哪里。',[
 block('compare','用一个待办工具举例','版本 v0.1.0 | 能添加、勾选待办\n后续继续改 | 想增加提醒功能\n需要找回时 | 按版本名定位原来的代码'),
 block('text','','Tag 标记代码；Release 写明这一版的变化和用法。')
 ],'示例用于解释方法，不是本账号的实测记录。'),
 card('先分清 · 两个功能各有用处','Tag 找到代码，\nRelease 交代这一版。','GitHub 仓库，就是存放项目代码和修改记录的地方。',[
 block('text','Tag｜版本标签','给某一次代码提交起个名字，例如 v0.1.0。\n“提交”就是 Git 记录的一次代码保存。\nTag 指向这次记录，方便以后定位。'),
 block('callout','Release｜版本说明页','基于一个 Tag，写下变化、使用方法和已知问题。\nGitHub 提供对应源码下载；你也可以另外上传打包好的文件。')
 ],'Release 本身不等于网站上线；是否触发部署取决于项目配置。'),
 card('写给未来的自己 · 示例版本记录','别只写\n「更新了一下」。','一个月后，读这页的人应该能判断：这版能做什么、怎么用。',[
 block('callout','v0.1.0｜待办工具第一版','本次变化：可以添加、勾选待办。\n验证记录：刷新后，待办仍保留。\n启动方法：按 README 操作。\n已知问题：没有多设备同步。'),
 block('text','写清楚比写得漂亮更有用','README 是项目里的使用说明。上面的验证结果是示例；实际没有测试过的项目，就写“未验证”。')
 ],'版本号是示例。附件可选；生成可用安装包需要另外打包。'),
 card('网页版操作 · 代码先保存到 GitHub','第一次，\n照着这条路走。','前提：代码已上传 GitHub，你有仓库写权限。',[
 block('steps','','确认目标分支的最新提交，就是要保留的版本；记下提交编号。\n进仓库 Releases → Draft a new release。\nChoose a tag：创建未占用的名字，如 v0.1.0；Target 选已检查的分支。\n填版本标题与说明；暂不确定时，先点 Save draft。\n核对目标与说明后，再由你点 Publish release。')
 ],'分支是一条修改路线。保存草稿不等于发布完成；发布后继续核对。'),
 card('验收 · 发布 Release 后再检查','看到版本号，\n还不算检查完成。','不是“有个标签”就够了，要确认它确实对应想保留的代码。',[
 block('list','至少确认这三件事','在 Releases / Tags 中能找到版本；Tag 对应的提交编号与记录一致。\nRelease 说明写清变化、使用方法与限制，没有把未测功能写成已验证。\n从该 Release 的 Assets 下载 Source code (zip)，放进新文件夹，按 README 验证关键功能。'),
 block('callout','如果取回来跑不起来','先记录缺少的环境、依赖或配置，再补使用说明。不要把下载成功当成恢复成功。')
 ],'本地创建的 Tag 还要推送到 GitHub；修正代码用新版本号，别覆盖旧 Tag。'),
 card('可直接复制 · 在能读取项目的编程助手里使用','让 AI 帮忙，\n先给它明确边界。','例如在 Codex 中打开项目；普通聊天窗口不能仅凭这句话看到本机文件。',[
 block('callout','先检查，再给预览','请检查这个项目的改动与已有 Tag，指出要保留的提交。建议未占用的版本号，并起草 Release 说明：本次变化、验证记录、启动方法、已知问题。未测试项标“未验证”，不要编造。先给清单和预览，不要提交、推送、打 Tag、发布 Release、部署或删除文件。'),
 block('text','你应该拿到什么','目标提交编号、版本号建议、Release 说明草稿，以及待确认或未验证项。')
 ],'先检查清单和目标代码，再决定后续操作。'),
 card('最后分清 · 避免三个常见误会','留住一个版本，\n还要知道它的边界。','下一次要改项目时，你需要的是能定位、能解释、能验证的版本记录。',[
 block('compare','容易混淆的地方','源码 ZIP = 安装包？ | 它是代码快照，通常还需按 README 配好环境和依赖。\nTag = 所有数据的备份？ | 未提交文件、外部数据库和密钥不会自动包含。\n取回旧代码 = 网站恢复？ | 取回与部署是两件事，线上回滚还需单独处理。')
 ],'先保留好用版本的提交记录，再继续改。示例与操作依据见随附来源。')
 ]
};
p.visual={theme:'sage',layout:'compact',pageLayouts:{0:'feature',1:'split',2:'flow',3:'flow',4:'flow',5:'flow',6:'flow'},artwork:{0:'lucide:bookmark',1:'lucide:tag',2:'lucide:file-text',3:'lucide:route',4:'lucide:check-check',5:'lucide:message-circle',6:'lucide:circle-question-mark'}};
p.reviewNote='已采用用户选定的明亮综艺感真人封面；后六张为蓝、黄、红高对比教程卡。内容及成图均待用户确认。待办工具与验证记录是教学示例，不是亲测。三端配文为候选，未创建平台草稿。';
p.platforms={
 wechat:{title:'让AI大改前，先留住能用的版本',body:'用 AI 做出一个能用的小工具后，还想继续改。可万一改坏了，原来那版在哪？\n\n这期把 GitHub 的 Tag 和 Release 放在一起讲：Tag 给某次代码提交起个版本名；Release 在它的基础上写清变化、用法和已知问题，并提供下载入口。\n\n图里有一份待办工具的示例记录、网页版操作路线、验收清单，以及给编程助手的检查提示词。示例不代表本账号亲测；没有验证过的结果，就标“未验证”。\n\n源码 ZIP 不等于安装包，取回代码也不等于线上回滚。先确认版本对应正确提交，并在新文件夹验证关键功能，再继续改。\n\n依据：GitHub 官方文档《About releases》《Managing releases》《Downloading source code archives》，及 Git 官方《Tagging》。',tags:['AI开发','GitHub入门','版本管理'],delivery:null},
 xiaohongshu:{title:'AI改坏前，给好用那版留个名字',body:'刚把小工具跑通，又想让 AI 加功能。\n先留个记录：原来能用的那版，到底在哪？\n\n这次整理了 GitHub 的两个功能：\nTag：给某一次代码提交起版本名。\nRelease：写清这版改了什么、怎么用、有哪些限制，还能提供下载入口。\n\n7 张图里有具体示例、网页操作、验收清单和可复制提示词。例子是教学示意，不是亲测结果。\n\n别漏掉最后的检查：版本要对应正确提交；代码取回后，要按使用说明验证功能。源码 ZIP 不是现成安装包，数据库和密钥也不会自动备份。\n\n下次让 AI 大改前，可以先对着这份清单留好版本。\n资料依据：GitHub 官方 Release 与源码归档文档、Git 官方 Tagging。',tags:['AI开发','GitHub','小白学习','版本管理'],delivery:null},
 douyin:{title:'让AI大改前，先留住能用的版本',body:'用 AI 做出能用的小工具，还想继续改？先给这一版留个名字。GitHub 的 Tag 标记一次代码提交，Release 写清变化、用法和已知问题，并提供下载入口。图里整理了网页操作、验收清单和提示词。示例不是亲测，没测过就写“未验证”。源码 ZIP 不等于安装包。先确认代码能取回并验证，再继续改。',tags:['AI开发','GitHub入门'],delivery:null}
};
validateProject(p);if(validateContent(p).length)throw new Error(validateContent(p).join('；'));
for(const k of Object.keys(p.platforms)){const v=validatePlatform(p,k);if(v.errors.length)throw new Error(v.errors.join('；'));console.log(k,JSON.stringify(v));}
const dir='dist/issues/github-tag-release-20261006';await fs.mkdir(dir,{recursive:true});
await fs.mkdir('examples/github-tag-release-20261006',{recursive:true});
await fs.writeFile('examples/github-tag-release-20261006/project.json',JSON.stringify(p,null,2));
await fs.writeFile(dir+'/project.json',JSON.stringify(p,null,2));
const palette={ink:'#314e3f',soft:'#e6ebd5',accent:'#c1cc94',line:'#dbe2c9',mute:'#94a17a'};
const wordmark='<svg width="38" height="38" viewBox="0 0 48 48" aria-hidden="true"><rect width="48" height="48" rx="14" fill="var(--poster-ink)"/><path d="M14 33C8 13 25 10 36 12C38 26 29 37 14 33Z" fill="var(--poster-soft)"/><path d="m14 34 17-16M23 25l-2-9M23 25l10 1" fill="none" stroke="var(--poster-ink)" stroke-width="2"/></svg>';
const posters=p.content.cards.map((_,i)=>renderFlexibleCard(p,i,wordmark,palette));
const css=await fs.readFile('dist/styles.css','utf8');
const esc=x=>String(x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const html=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>小苋 · 给能用的这一版留个名字</title><style>${css}
body{background:#edf0e7;padding:32px;color:#314e3f}.issue-header{max-width:1140px;margin:0 auto 28px}.issue-header h1{font-size:30px;margin:12px 0}.issue-header p{line-height:1.9;font-size:14px}.issue-badge{font-size:12px;padding:6px 10px;background:#e1e9d5;border-radius:20px;display:inline-block}.issue-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:28px;max-width:1140px;margin:auto}.issue-tile{min-width:0}.issue-frame{width:100%;aspect-ratio:3/4;overflow:hidden;border-radius:7px;box-shadow:0 8px 25px #314e3f0c}.issue-scale{width:1080px;height:1440px;transform-origin:top left}.issue-controls{display:flex;justify-content:space-between;align-items:center;padding:12px 0;font-size:12px;gap:8px}.issue-sources{max-width:1140px;margin:30px auto;padding:22px;background:#f9f7ef;border-radius:10px;font-size:13px;line-height:2}.issue-sources a{text-decoration:underline}#issue-status{line-height:1.8;color:#805b45}#render-host{position:fixed;left:-20000px;top:0;width:1080px;height:1440px}.issue-bottom{max-width:1140px;margin:25px auto;display:flex;gap:12px;flex-wrap:wrap}@media(max-width:760px){body{padding:18px}.issue-grid{grid-template-columns:minmax(0,1fr)}.issue-header h1{font-size:24px}}
</style><header class="issue-header"><span class="issue-badge">待确认 · HTML 概念预览</span><h1>让 AI 大改前，先留住能用的版本</h1><p>7 张图：具体困扰 → 概念区别 → 示例记录 → 网页操作 → 验收方法 → AI 提示词 → 必要边界。<br>示例不是实测；全部图卡尚未经过用户确认。此页只提供预览，不会创建任何平台草稿。</p><div id="issue-status" role="status"></div></header><main class="issue-grid">${posters.map((html,i)=>`<section class="issue-tile"><div class="issue-frame"><div class="issue-scale">${html}</div></div><div class="issue-controls"><span>图 ${i+1} / 7</span><button class="btn secondary" data-export="${i}">下载第 ${i+1} 张预览 PNG</button></div></section>`).join('')}</main><section class="issue-sources"><b>事实来源 · 2026-10-06 核对</b><br>${p.content.sources.map(s=>`<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a> · ${esc(s.supports)}<br>`).join('')}案例与检查清单为本期原创教学设计，未模拟真实 GitHub 截图或亲测结果。</section><div class="issue-bottom"><button class="btn primary" id="all-previews">下载全部待审核预览</button><a class="btn secondary" href="/">返回工作台确认内容</a></div><div id="render-host"></div><script type="module">
import {toPng,JSZip} from '../../vendor.js';
const status=document.querySelector('#issue-status');
function fit(){document.querySelectorAll('.issue-frame').forEach(frame=>frame.firstElementChild.style.transform='scale('+(frame.clientWidth/1080)+')');}new ResizeObserver(fit).observe(document.querySelector('.issue-grid'));fit();
function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),20000);}
async function png(i){const host=document.querySelector('#render-host');host.innerHTML=document.querySelectorAll('.issue-scale')[i].innerHTML;try{await document.fonts.ready;const node=host.firstElementChild,area=node.getBoundingClientRect();for(const el of node.querySelectorAll('.poster-header,.poster-title,.poster-eyebrow,.content-block,.poster-note,.poster-footer')){const b=el.getBoundingClientRect();if(b.bottom>area.bottom-24||b.right>area.right+1)throw new Error('第 '+(i+1)+' 张超出画布，需要调整排版');}return await toPng(node,{width:1080,height:1440,pixelRatio:1,skipFonts:true});}finally{host.innerHTML='';}}
let busy=false;document.addEventListener('click',async e=>{const button=e.target.closest('button[data-export],#all-previews');if(!button||busy)return;busy=true;status.textContent='正在检查并导出预览…';try{if(button.id==='all-previews'){const zip=new JSZip();for(let i=0;i<7;i++){status.textContent='正在检查并导出第 '+(i+1)+' / 7 张…';const data=await png(i);zip.file(String(i+1).padStart(2,'0')+'.png',data.split(',')[1],{base64:true});}zip.file('请先审核.txt','这些是内容与图卡均待确认的概念预览，不是已审核交付包。请在工作台确认内容与全部图卡之后再准备平台草稿。');for(const lib of ['lucide','tabler'])zip.file('许可/'+lib+'.txt',await(await fetch('../../licenses/'+lib+'.txt')).text());download(await zip.generateAsync({type:'blob'}),'小苋-Tag与Release-待审核预览.zip');}else{const i=Number(button.dataset.export),data=await png(i);download(await(await fetch(data)).blob(),'Tag与Release-待审核-'+String(i+1).padStart(2,'0')+'.png');}status.textContent='预览已下载。内容与全部图卡仍需你确认。';}catch(error){status.textContent=error.message;}finally{busy=false;}});
</script></html>`;
await fs.writeFile(dir+'/index.html',html);
let md='# 让AI大改前，先留住能用的版本\n\n状态：内容与图卡均待用户确认；未创建平台草稿。\n\n';
for(const [i,c] of p.content.cards.entries())md+=`## 图${i+1}：${c.title.replaceAll('\n','')}\n\n${c.eyebrow}\n\n${c.body}\n\n${c.blocks.map(b=>(b.heading?'**'+b.heading+'**\n\n':'')+b.text).join('\n\n')}\n\n${c.note}\n\n`;
md+='## 三端配文候选\n\n'+Object.entries(p.platforms).map(([k,c])=>`### ${k}\n\n${c.title}\n\n${c.body}\n\n${c.tags.map(t=>'#'+t).join(' ')}`).join('\n\n')+'\n\n## 来源\n\n'+p.content.sources.map(s=>`- [${s.title}](${s.url})：${s.supports}`).join('\n')+'\n\n## 编辑自检\n\n承诺：帮助AI项目新手留下一份可定位、有说明、可验证的版本记录。已提供具体示例、网页入口、目标提交核对、恢复验证和可复制提示词。案例标注为示例，不冒充亲测；不把源码快照当整机备份，不把Release当自动部署。页数依据需要，不作为后续固定模板。\n';
await fs.writeFile('examples/github-tag-release-20261006/内容与配文.md',md);
if(process.argv.includes('--import')){
 const base='http://localhost:4318',existing=await(await fetch(base+'/api/projects')).json();
 if(existing.projects.some(x=>x.id===p.id))console.log('已有本期项目，保留用户编辑。');
 else{const r=await fetch(base+'/api/projects',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(p)});const d=await r.json();if(!r.ok)throw new Error(d.error);console.log('本期已加入工作台，两项审核为空：',d.project.id);}
}
