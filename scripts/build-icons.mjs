import fs from 'node:fs/promises';
const escape=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const tags=new Set(['path','circle','rect','line','ellipse','polyline','polygon']);
const attrs=new Set(['d','cx','cy','r','x','y','width','height','rx','ry','x1','x2','y1','y2','fill','points','opacity','stroke']);
function shapes(nodes){return nodes.map(([tag,a])=>{
  if(!tags.has(tag))throw new Error('Unexpected SVG element: '+tag);
  for(const [key,value] of Object.entries(a))if(!attrs.has(key)||/[<>]|url\(|javascript:|https?:/i.test(String(value)))throw new Error('Unexpected SVG attribute');
  return '<'+tag+' '+Object.entries(a).map(([k,v])=>k+'="'+escape(v)+'"').join(' ')+'/>';
}).join('');}
const read=async p=>JSON.parse(await fs.readFile(p,'utf8'));
const lucide=await read('node_modules/lucide-static/icon-nodes.json'),ltags=await read('node_modules/lucide-static/tags.json');
const tabler=await read('node_modules/@tabler/icons/icons.json');
const entries=[];
for(const [name,nodes] of Object.entries(lucide))entries.push({id:'lucide:'+name,set:'lucide',name,tags:ltags[name]||[],body:shapes(nodes)});
for(const style of ['outline','filled']){
  const nodes=await read('node_modules/@tabler/icons/tabler-nodes-'+style+'.json');
  for(const [name,parts] of Object.entries(nodes))entries.push({id:'tabler-'+style+':'+name,set:'tabler-'+style,name,tags:[tabler[name]?.category||'',...(tabler[name]?.tags||[])],body:shapes(parts)});
}
entries.sort((a,b)=>a.id.localeCompare(b.id));
await fs.writeFile('dist/icon-data.mjs','// Generated from pinned Lucide and Tabler packages. See licenses/.\nexport default '+JSON.stringify(entries)+';\n');
await fs.writeFile('icon-ids.mjs','export const ICON_IDS=new Set('+JSON.stringify(entries.map(x=>x.id))+');\n');
await fs.copyFile('icon-ids.mjs','dist/icon-ids.mjs');
await fs.mkdir('dist/licenses',{recursive:true});
for(const [name,file] of [['lucide','node_modules/lucide-static/LICENSE'],['tabler','node_modules/@tabler/icons/LICENSE']])await fs.copyFile(file,'dist/licenses/'+name+'.txt');
console.log('Local SVG dictionary:',entries.length,'icons');
