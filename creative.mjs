import {coverReference,COVER_DESIGN_RULES} from './cover-library.mjs';
export const CREATIVE_STYLES={
 vivid:{name:'明亮综艺',description:'蓝黄红高对比、黑白大字、清楚的形状与强烈视觉中心',background:'#109fea',ink:'#111111',panel:'#ffffff',accent:'#ffe32a',signal:'#f42b31'},
 editorial:{name:'杂志风格',description:'深色背景、米白文字、珊瑚色重点、清楚的标题和留白',background:'#202b38',ink:'#fff8ec',panel:'#fff8ec',accent:'#ffb7a4',signal:'#ec5b49'},
 minimal:{name:'清爽教程',description:'浅蓝底、深蓝文字、黄色重点、整洁的步骤与对照图',background:'#eef7ff',ink:'#133d65',panel:'#ffffff',accent:'#ffdf69',signal:'#e34f40'}
};
const hash=value=>{let h=2166136261;for(const ch of String(value))h=Math.imul(h^ch.charCodeAt(0),16777619);return(h>>>0).toString(16);};
export function newCreative(mode='ask'){return {workflow:2,mode,style:'vivid',portrait:null,referenceId:null,reference:null,coverDirection:'',coverCopy:{headline:'',kicker:'',points:[],benefit:''},candidates:[],selectedCandidateId:null,result:null};}
export const creativeOf=p=>p.visual?.creative||null;
export function imageDataValid(data){
 if(typeof data!=='string'||data.length>8400000||!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(data))return false;
 try{const encoded=data.split(',')[1];if(encoded.length%4)return false;const header=atob(encoded.slice(0,48));return data.startsWith('data:image/png')?header.startsWith('\x89PNG\r\n\x1a\n'):data.startsWith('data:image/jpeg')?header.startsWith('\xff\xd8\xff'):header.startsWith('RIFF')&&header.slice(8,12)==='WEBP';}catch{return false;}
}
export function validateCreative(p){const c=creativeOf(p);if(!c)return;
 if(!['ask','portrait','text'].includes(c.mode)||!Object.hasOwn(CREATIVE_STYLES,c.style))throw Error('封面选择或设计风格无效');
 for(const key of ['portrait','reference','result']){const x=c[key];if(x!=null&&(!x||typeof x.name!=='string'||x.name.length>300||!imageDataValid(x.data)))throw Error(key==='portrait'?'本人照片格式错误，请上传6MB以内PNG/JPEG/WebP':key==='reference'?'构图参考图格式错误':'生成封面格式错误，请上传6MB以内PNG/JPEG/WebP');}
 if(c.result&&(!/^[a-f0-9]{1,8}$/.test(c.result.inputFingerprint||'')))throw Error('封面缺少生成版本记录');
 if(c.workflow!==undefined&&c.workflow!==2)throw Error('封面流程版本无效');
 if(c.workflow===2){
  if(c.referenceId!=null&&!coverReference(c.referenceId)&&c.referenceId!=='custom')throw Error('封面参考不存在');
  if(typeof c.coverDirection!=='string'||c.coverDirection.length>3000)throw Error('封面偏好过长');
  if(c.coverCopy!==undefined){const copy=c.coverCopy;if(!copy||['headline','kicker','benefit'].some(k=>typeof copy[k]!=='string'||copy[k].length>300)||!Array.isArray(copy.points)||copy.points.length>3||copy.points.some(x=>typeof x!=='string'||x.length>300))throw Error('封面文案格式错误：辅助要点最多3条，每项300字以内');}
  if(!Array.isArray(c.candidates)||c.candidates.length>6)throw Error('最多保留6张封面候选，请先移除不需要的版本');
  const ids=new Set();for(const x of c.candidates){if(!x||typeof x.id!=='string'||!/^[a-zA-Z0-9_-]{1,80}$/.test(x.id)||ids.has(x.id)||typeof x.name!=='string'||x.name.length>300||!imageDataValid(x.data)||!/^[a-f0-9]{1,8}$/.test(x.inputFingerprint||''))throw Error('候选封面格式错误');ids.add(x.id);}
  if(c.selectedCandidateId!=null&&!ids.has(c.selectedCandidateId))throw Error('已选候选不存在');
  if(c.selectedCandidateId){const selected=c.candidates.find(x=>x.id===c.selectedCandidateId);if(!c.result||selected.data!==c.result.data||selected.inputFingerprint!==c.result.inputFingerprint)throw Error('成品与已选候选不一致');}
  const size=[c.portrait,c.reference,c.result,...c.candidates].reduce((n,x)=>n+(x?.data.length||0),0);if(size>29*1024*1024)throw Error('封面素材总容量过大，请先移除不需要的候选');
 }
}
export function creativeInputKey(p){const c=creativeOf(p);if(!c)return null;
 const common={topic:p.content.topic,mode:c.mode,portrait:c.mode==='portrait'&&c.portrait?hash(c.portrait.data):null,title:p.content.cards[0]?.title||p.content.topic};
 return hash(JSON.stringify(c.workflow===2?{...common,referenceId:c.referenceId,reference:c.referenceId==='custom'&&c.reference?hash(c.reference.data):null,design:coverReference(c.referenceId)?.composition||'custom',rules:COVER_DESIGN_RULES,direction:c.coverDirection,copy:c.coverCopy||null}:{topic:p.content.topic,mode:c.mode,style:c.style,portrait:c.portrait?hash(c.portrait.data):null,title:p.content.cards[0]?.title||p.content.topic,direction:p.content.brief?.direction||''}));
}
export function currentCover(p){const c=creativeOf(p);if(!c||c.result?.inputFingerprint!==creativeInputKey(p))return null;if(c.workflow===2&&!c.selectedCandidateId)return null;return c.result;}
export function creationErrors(p){const c=creativeOf(p);if(!c)return [];
 const errors=[];if(c.workflow===2&&(!c.referenceId||(c.referenceId==='custom'&&!c.reference)))errors.push('请先看参考图，选择一个方向或上传喜欢的封面');
 if(c.mode==='ask')errors.push('选择参考后，可使用真人或不使用真人');
 if(c.mode==='portrait'&&!c.portrait)errors.push('真人封面需要先上传一张本人照片；也可以改选不使用真人');return errors;
}
export function coverErrors(p){const e=creationErrors(p),c=creativeOf(p);if(!e.length&&c&&(c.workflow===2||c.mode==='portrait')&&!currentCover(p))e.push(c.workflow===2?'请先生成候选，再挑选一张作为本期封面':'请先生成并导入当前版本的真人封面');return e;}
export function coverPrompt(p){const errors=creationErrors(p);if(errors.length)throw Error(errors.join('；'));const c=creativeOf(p);if(!c)throw Error('请先选择封面方式');const title=c.coverCopy?.headline||p.content.cards[0]?.title||p.content.topic;
 const ref=coverReference(c.referenceId);
 const direction=c.workflow===2?(ref?.composition||'Use the supplied custom reference for visual structure and typography only.'):`${CREATIVE_STYLES[c.style].description}. ${p.content.brief?.direction||''}`;
 return `Use case: ${c.mode==='portrait'?'identity-preserve':'ads-marketing'}. Create ONE finished Chinese creator social cover, portrait 3:4, for topic ${JSON.stringify(p.content.topic)}. ${c.mode==='portrait'?'Use ONLY the supplied person photo as the identity reference. Preserve the same recognizable face, facial proportions, apparent age and natural skin texture. Keep the face visible. The identity photo may itself be an old cover: ignore all its typography, clothing styling, pose and background; create a fresh topic-appropriate photographic composition.':'Do not include any person or invent a portrait. Use meaningful objects, graphics and typography.'} Layout direction: ${direction}. ${c.workflow===2?(c.mode==='portrait'?'Input image order: first image is the identity photo, second image is the independent composition reference. ':'The supplied image is the composition reference only. ')+'The reference atlas or custom cover is COMPOSITION reference only, never identity. Study only the specified atlas cell, never copy the grid or its sample headline.':''} Exact headline: ${JSON.stringify(title)}. Optional copy, use EXACTLY and only if nonempty: ${JSON.stringify({kicker:c.coverCopy?.kicker||'',points:c.coverCopy?.points||[],benefit:c.coverCopy?.benefit||''})}. Do not invent extra copy from the sample. Topic benefit/context for visual understanding only: ${JSON.stringify(p.content.takeaway)}. ${COVER_DESIGN_RULES} Do not make the previous cover with replaced words. No brand signature, fake screenshots or fake results. User preferences: ${c.coverDirection||''}`;
}
export function coverTask(p,base='http://localhost:4318'){
 const errors=creationErrors(p);if(errors.length)throw Error(errors.join('；'));const c=creativeOf(p);if(!c)throw Error('请先选择封面方式');
 return `请为工作台项目 ${p.id} 生成3张构图有区别的封面候选，不需要先查找或选择skill。先读取 ${base}/api/projects/${p.id}/creative-input，取得本人照片路径（如需真人）、独立的referencePath、参考说明、prompt、inputFingerprint和revision。先查看图片。${c.mode==='portrait'?'本人照片必须包含可辨认真人；没有则停止并引导重新上传或改为不使用真人。本人照片只决定身份，构图参考只决定视觉组织，不把参考中的人当作用户。':'当前选择不使用真人，不需要真人照片，也不生成随机人物。'}给imagegen传图时，本人身份照片在前，构图参考在后，并明确各自用途。用当前会话内置imagegen工具按prompt逐张生成，辅助文案只使用输入中的封面文案，不照搬参考的数字、承诺或经历；在240–360px缩略尺寸检查标题、利益点与人物关系，变化景别、位置、动作或视觉结构，不只换颜色和字；保持主题和本人辨识度。每张生成后复制到本机项目，将data:image/...;base64、name、inputFingerprint和当时最新revision提交到importEndpoint（POST JSON）。每次导入后使用响应的新revision继续导入。导入只加入候选，不自动选为成品，不等于审核。保留用户已确认正文，让用户在工作台挑选、修改和最终确认；内页独立设计，不必与封面使用同一种风格。工具不可用时如实说明，最终发布由用户执行。`;
}
