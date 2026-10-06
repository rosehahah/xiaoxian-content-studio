import entries from './icon-data.mjs';
export const ICONS=entries;
const byId=new Map(entries.map(x=>[x.id,x]));
export const ICON_SETS={lucide:'Lucide 线性','tabler-outline':'Tabler 线性','tabler-filled':'Tabler 实心'};
export const ICON_GROUPS={all:['全部素材',[]],tech:['电脑与代码',['laptop','device','computer','code','terminal','cpu','git','server','robot']],files:['文件与备份',['file','folder','archive','cloud','database','storage','hard-drive','backup','download']],learn:['学习与工具',['book','bulb','school','pencil','notebook','tool','search','sparkles','brain']],flow:['箭头与流程',['arrow','chevron','route','workflow','check','step','repeat']],life:['自然与生活',['leaf','plant','flower','sun','moon','home','coffee','heart','tree','mountain']]};
const synonyms={'电脑':['laptop','computer','device','monitor'],'代码':['code','terminal','git'],'文件':['file','folder'],'备份':['archive','backup','cloud','database','hard-drive'],'云':['cloud'],'存储':['storage','database','archive','hard-drive'],'学习':['book','school','brain','bulb'],'灯泡':['bulb'],'箭头':['arrow','chevron'],'流程':['workflow','route','step'],'安全':['shield','lock','key'],'锁':['lock'],'时间':['clock','calendar','hourglass'],'手机':['phone','mobile'],'机器人':['robot','bot'],'自然':['leaf','plant','tree','flower'],'叶子':['leaf'],'检查':['check','search'],'图片':['photo','image','picture'],'设置':['settings','adjustments'],'下载':['download'],'上传':['upload'],'工具':['tool','wrench'],'删除':['trash','delete'],'提示':['bulb','message','info']};
const searchIndex=new Map(entries.map(x=>[x.id,[x.name,...x.tags].join(' ').toLowerCase()]));
export function searchIcons(query='',set='all',group='all'){
  const terms=query.trim().toLowerCase().split(/\s+/).filter(Boolean).map(x=>synonyms[x]||[x]);
  const groupTerms=ICON_GROUPS[group]?.[1]||[];
  return entries.filter(x=>{const text=searchIndex.get(x.id);return (set==='all'||x.set===set)&&(!groupTerms.length||groupTerms.some(t=>text.includes(t)))&&terms.every(options=>options.some(t=>text.includes(t)));});
}
export function iconName(id){return byId.get(id)?.name||'';}
export function materialSvg(id,color='currentColor'){
  const entry=byId.get(id);if(!entry)return '';
  const ink=/^(currentColor|#[a-fA-F0-9]{3,8})$/.test(color)?color:'currentColor';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="${entry.set==='tabler-filled'?ink:'none'}" stroke="${entry.set==='tabler-filled'?'none':ink}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${entry.body.replaceAll('currentColor',ink)}</svg>`;
}
export function composeMaterialArt(kind,existingArt,id){
  const svg=materialSvg(id);if(!svg)return existingArt;
  // Steps and prompts contain confirmed copy in their visual block.
  // A selected symbol supplements that block rather than replacing it.
  if(['steps','prompt'].includes(kind))return existingArt+`<div class="poster-symbol-badge">${svg}</div>`;
  return `<div class="poster-visual symbol-scene"><div class="symbol-disc">${svg}</div></div>`;
}
