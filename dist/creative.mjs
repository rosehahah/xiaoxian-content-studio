export const CREATIVE_STYLES={
 vivid:{name:'明亮综艺',description:'蓝黄红高对比、黑白大字、清楚的形状与强烈视觉中心',background:'#109fea',ink:'#111111',panel:'#ffffff',accent:'#ffe32a',signal:'#f42b31'},
 editorial:{name:'杂志风格',description:'深色背景、米白文字、珊瑚色重点、清楚的标题和留白',background:'#202b38',ink:'#fff8ec',panel:'#fff8ec',accent:'#ffb7a4',signal:'#ec5b49'},
 minimal:{name:'清爽教程',description:'浅蓝底、深蓝文字、黄色重点、整洁的步骤与对照图',background:'#eef7ff',ink:'#133d65',panel:'#ffffff',accent:'#ffdf69',signal:'#e34f40'}
};
const hash=value=>{let h=2166136261;for(const ch of String(value))h=Math.imul(h^ch.charCodeAt(0),16777619);return(h>>>0).toString(16);};
export function newCreative(mode='ask'){return {mode,style:'vivid',portrait:null,result:null};}
export const creativeOf=p=>p.visual?.creative||null;
export function imageDataValid(data){
 if(typeof data!=='string'||data.length>8400000||!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(data))return false;
 try{const encoded=data.split(',')[1];if(encoded.length%4)return false;const header=atob(encoded.slice(0,48));return data.startsWith('data:image/png')?header.startsWith('\x89PNG\r\n\x1a\n'):data.startsWith('data:image/jpeg')?header.startsWith('\xff\xd8\xff'):header.startsWith('RIFF')&&header.slice(8,12)==='WEBP';}catch{return false;}
}
export function validateCreative(p){const c=creativeOf(p);if(!c)return;
 if(!['ask','portrait','text'].includes(c.mode)||!Object.hasOwn(CREATIVE_STYLES,c.style))throw Error('封面选择或设计风格无效');
 for(const key of ['portrait','result']){const x=c[key];if(x!=null&&(!x||typeof x.name!=='string'||x.name.length>300||!imageDataValid(x.data)))throw Error(key==='portrait'?'本人照片格式错误，请上传6MB以内PNG/JPEG/WebP':'生成封面格式错误，请上传6MB以内PNG/JPEG/WebP');}
 if(c.result&&(!/^[a-f0-9]{1,8}$/.test(c.result.inputFingerprint||'')))throw Error('封面缺少生成版本记录');
}
export function creativeInputKey(p){const c=creativeOf(p);if(!c)return null;return hash(JSON.stringify({topic:p.content.topic,mode:c.mode,style:c.style,portrait:c.portrait?hash(c.portrait.data):null,title:p.content.cards[0]?.title||p.content.topic,direction:p.content.brief?.direction||''}));}
export function currentCover(p){const c=creativeOf(p);return c?.mode==='portrait'&&c.result?.inputFingerprint===creativeInputKey(p)?c.result:null;}
export function creationErrors(p){const c=creativeOf(p);if(!c)return [];if(c.mode==='ask')return ['请先选择真人封面或文字封面'];if(c.mode==='portrait'&&!c.portrait)return ['真人封面需要先上传一张本人照片；也可以改选文字封面'];return [];}
export function coverErrors(p){const e=creationErrors(p),c=creativeOf(p);if(!e.length&&c?.mode==='portrait'&&!currentCover(p))e.push('请先生成并导入当前版本的真人封面');return e;}
export function coverPrompt(p){const errors=creationErrors(p);if(errors.length)throw Error(errors.join('；'));const c=creativeOf(p);if(!c)throw Error('请先选择封面方式');const title=p.content.cards[0]?.title||p.content.topic;
 return `Use case: ${c.mode==='portrait'?'identity-preserve':'ads-marketing'}. Create a finished Chinese personal-creator social cover, portrait 3:4. ${c.mode==='portrait'?'Use the supplied person photo as the identity reference. Preserve the same recognizable face, facial proportions, apparent age and natural skin texture. Use an intentional photographic composition; keep the face visible and do not place text over it.':'Create a text-led designed cover; do not include a person or invent a portrait.'} Style: ${CREATIVE_STYLES[c.style].description}. Use strong hierarchy and readable bold Chinese typography. Exact headline: ${JSON.stringify(title)}. One clear visual promise; graphics must explain the topic. No 小苋AI圈 brand signature, extra headline, fake screenshots or fake test results. Additional creative direction: ${p.content.brief?.direction||'延续所选风格，避免文档截图感。'}`;
}
export function coverTask(p,base='http://localhost:4318'){
 const errors=creationErrors(p);if(errors.length)throw Error(errors.join('；'));const c=creativeOf(p);if(!c)throw Error('请先选择封面方式');
 if(c.mode==='text')return `请直接为工作台项目 ${p.id} 制作风格化文字封面及HTML/SVG内页。已选择“${CREATIVE_STYLES[c.style].name}”，不需要真人照片。读取 ${base}/api/projects，使用本期文字与所选风格，不沿用上一期技术结论。成图待用户审核，不代替确认或发布。`;
 return `请直接为工作台项目 ${p.id} 生成真人封面，不需要先查找或选择skill。先读取 ${base}/api/projects/${p.id}/creative-input，取得已上传本人照片的本机路径、生成提示词、inputFingerprint和revision。先查看照片，确认包含可辨认的真人；若没有真人，停止生成并引导用户重新上传本人照片，也可以改选文字。不要把排版参考图当作本人照片。用当前会话的内置imagegen工具，以该本人照片为身份参考，按返回的prompt生成风格化封面。不要用HTML文字页或随机人物代替真人成图。将生成图片复制到本机项目，再将图片的data:image/...;base64内容、文件名、inputFingerprint、revision提交到返回的importEndpoint（POST，JSON字段为data/name/inputFingerprint/revision）。导入成功后核对工作台封面与脸部辨识度，再继续制作所选风格的HTML/SVG教程内页。工具不可用时如实说明。生成与导入不等于用户审核，最终发布由用户执行。`;
}
