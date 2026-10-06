import {mkdir,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';

const repo=process.env.STAR_HISTORY_REPO||'rosehahah/xiaoxian-content-studio';

function gh(args){
  const result=spawnSync('gh',['api',...args],{encoding:'utf8'});
  if(result.status!==0)throw new Error((result.stderr||'GitHub API 请求失败').trim());
  return JSON.parse(result.stdout);
}

const metadata=gh([`repos/${repo}`]);
const pages=gh(['--paginate','--slurp','-H','Accept: application/vnd.github.star+json',`repos/${repo}/stargazers?per_page=100`]);
const stars=pages.flat().map(item=>new Date(item.starred_at)).filter(date=>!Number.isNaN(date.valueOf())).sort((a,b)=>a-b);
const created=new Date(metadata.created_at),now=new Date(),start=created.valueOf(),end=Math.max(now.valueOf(),start+86_400_000);
const width=960,height=500,pad={left:72,right:40,top:86,bottom:66},chartW=width-pad.left-pad.right,chartH=height-pad.top-pad.bottom,maxY=Math.max(1,stars.length);
const x=date=>pad.left+(date.valueOf()-start)/(end-start)*chartW;
const y=value=>pad.top+chartH-(value/maxY)*chartH;
const points=[[pad.left,y(0)],...stars.map((date,index)=>[x(date),y(index+1)]),[pad.left+chartW,y(stars.length)]];
const line=points.map(([px,py],index)=>`${index?'L':'M'} ${px.toFixed(1)} ${py.toFixed(1)}`).join(' ');
const area=`${line} L ${pad.left+chartW} ${pad.top+chartH} L ${pad.left} ${pad.top+chartH} Z`;
const dateLabel=new Intl.DateTimeFormat('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit'});

function svg(theme){
  const dark=theme==='dark',bg=dark?'#17100e':'#fffaf7',text=dark?'#f8e9e3':'#3b2924',muted=dark?'#b89b91':'#8c6d63',grid=dark?'#3b2a25':'#ecdcd5',accent=dark?'#ff7040':'#ff3d00';
  const yTicks=[0,maxY].filter((v,i,a)=>a.indexOf(v)===i);
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title desc">
  <title id="title">${repo} Star History</title><desc id="desc">从 ${dateLabel.format(created)} 到 ${dateLabel.format(now)}，当前 ${stars.length} 个 Star。</desc>
  <defs><linearGradient id="fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${accent}" stop-opacity=".28"/><stop offset="1" stop-color="${accent}" stop-opacity=".02"/></linearGradient></defs>
  <rect width="${width}" height="${height}" rx="24" fill="${bg}"/>
  <text x="${pad.left}" y="42" fill="${text}" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" font-size="24" font-weight="700">Star History</text>
  <text x="${pad.left}" y="68" fill="${muted}" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" font-size="14">${repo}</text>
  <text x="${width-pad.right}" y="52" text-anchor="end" fill="${accent}" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" font-size="28" font-weight="800">★ ${stars.length}</text>
  ${yTicks.map(value=>`<line x1="${pad.left}" y1="${y(value)}" x2="${pad.left+chartW}" y2="${y(value)}" stroke="${grid}"/><text x="${pad.left-14}" y="${y(value)+5}" text-anchor="end" fill="${muted}" font-family="sans-serif" font-size="13">${value}</text>`).join('')}
  <path d="${area}" fill="url(#fill)"/><path d="${line}" fill="none" stroke="${accent}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
  ${stars.map((date,index)=>`<circle cx="${x(date)}" cy="${y(index+1)}" r="5" fill="${bg}" stroke="${accent}" stroke-width="3"/>`).join('')}
  <text x="${pad.left}" y="${height-24}" fill="${muted}" font-family="sans-serif" font-size="13">${dateLabel.format(created)}</text>
  <text x="${pad.left+chartW}" y="${height-24}" text-anchor="end" fill="${muted}" font-family="sans-serif" font-size="13">${dateLabel.format(now)}</text>
</svg>`;
}

await mkdir('assets',{recursive:true});
await Promise.all([writeFile('assets/star-history.svg',svg('light')),writeFile('assets/star-history-dark.svg',svg('dark'))]);
console.log(`Star history updated: ${stars.length} star(s)`);
