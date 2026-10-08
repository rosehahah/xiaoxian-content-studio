import {validatePlanning} from './planning.mjs';
import {validateCreative} from './creative.mjs';
import {ICON_IDS} from './icon-ids.mjs';
export const SCHEMA = 1;
// Resource ceilings protect the local editor; they are not editorial targets.
export const MAX_CARDS = 20;
export const CARD_KINDS = ['editorial','cover','cabinet','steps','clean','prompt'];
export const BLOCK_TYPES = ['text','list','steps','compare','callout'];
export const PAGE_LAYOUTS = ['flow','split','feature'];
export const PLATFORMS = {wechat:{name:'微信公众号',title:20,text:1000,tags:10},xiaohongshu:{name:'小红书',title:20,text:1000,tags:10},douyin:{name:'抖音',title:20,text:1000,tags:5}};
export const count = value => Array.from(String(value || '')).length;
export const fingerprint = value => {
  let h = 2166136261;
  for (const ch of JSON.stringify(value)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return (h >>> 0).toString(16);
};
export const contentKey = p => fingerprint(p.content);
export const cardKey = p => fingerprint({content:p.content,visual:p.visual});
export const contentApproved = p => p.contentApproval?.fingerprint === contentKey(p);
export const cardsApproved = p => contentApproved(p) && p.cardApproval?.fingerprint === cardKey(p);
export function validatePlatform(p, key) {
  const rule = PLATFORMS[key], copy = p.platforms[key];
  if (!rule || !copy) return {errors:['平台不存在'],warnings:[]};
  const text = [copy.body,...copy.tags.map(x=>'#'+x)].filter(Boolean).join('\n');
  const errors=[],warnings=[];
  if (!copy.title.trim()) errors.push('请填写标题');
  if (count(copy.title)>rule.title) errors.push('标题超过 '+rule.title+' 字');
  if (count(text)>rule.text) errors.push('正文与话题合计超过 '+rule.text+' 字');
  if (copy.tags.length>rule.tags) errors.push('话题超过 '+rule.tags+' 个');
  if (copy.tags.some(x=>!x.trim() || /[\s#]/.test(x))) errors.push('话题不能含空格或 #');
  if (key==='douyin' && (count(text)<120 || count(text)>180)) warnings.push('建议控制在 120–180 字左右');
  return {errors,warnings,textLength:count(text),titleLength:count(copy.title),tagCount:copy.tags.length};
}
export function validateContent(p) {
  const errors=[];
  if (!p.content.topic.trim()) errors.push('请填写选题');
  if (!p.content.takeaway.trim()) errors.push('请说明核心判断或读者收益');
  if (!p.content.cards.length || p.content.cards.length>MAX_CARDS) errors.push('请准备至少一张图卡；本机最多保存 '+MAX_CARDS+' 张');
  p.content.cards.forEach((c,i)=>{
    if (![c.title,c.body,c.note,...(c.blocks||[]).map(b=>b.text)].some(x=>x.trim())) errors.push('第 '+(i+1)+' 张还没有实质内容');
  });
  return errors;
}
export function invalidateContent(p) {p.contentApproval=null;p.cardApproval=null;p.stage='content';clearDelivery(p);}
export function invalidateVisual(p) {p.cardApproval=null;p.stage='design';clearDelivery(p);}
export function clearDelivery(p) {
  for (const item of Object.values(p.platforms)) {
    if(item.delivery) {item.history=item.history||[];item.history.push(item.delivery);}
    item.delivery=null;
  }
}
export function seedProject() {
  return {
    id:'github-mac-lesson-01',schema:SCHEMA,revision:0,stage:'content',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),
    content:{topic:'Mac 满了，项目又不敢删',series:'外行人的 AI 学习笔记',takeaway:'先把能恢复的代码存好，再清理本地空间。',cards:[
      {kind:'cover',eyebrow:'给电脑减负 · 第 01 课',title:'Mac 满了，\n项目不敢删？',body:'我先把代码存好，\n再给电脑腾点空间。',note:'先学会一件小事，就够了。'},
      {kind:'cabinet',eyebrow:'先弄懂',title:'给代码一个\n「存档柜」',body:'GitHub 能保存代码和修改记录。\n以后要接着做，再取回来。',note:'视频、照片和密钥，要另外存好。'},
      {kind:'steps',eyebrow:'只做三步',title:'先存好，\n再考虑删。',body:'让 AI 检查哪些文件该上传\n存到 GitHub 的私有仓库\n重新取回，确认能恢复',note:'密钥、证书、数据库要单独备份。'},
      {kind:'clean',eyebrow:'从小处开始',title:'先清理那些\n能重新生成的。',body:'安装的依赖、编译时生成的文件，\n通常可以重新生成。',note:'不确定的先别删，让 AI 解释原因。'},
      {kind:'prompt',eyebrow:'拿来就能用',title:'把这句话，\n发给你的 AI。',body:'帮我检查这个项目：哪些文件适合存到 GitHub，哪些要单独备份，哪些能重新生成。先列清单和理由，不要直接删除。',note:'不用记命令，先让它把事情讲清楚。'}
    ]},
    visual:{theme:'sage',layout:'airy'},contentApproval:null,cardApproval:null,reviewNote:'',
    platforms:{
      wechat:{title:'Mac满了，项目不敢删？',body:'用 AI 做了几个项目后，我开始关心一个很实际的问题：电脑满了，哪些文件能清理？\n\n这次先学一件小事：把代码存好，确认能恢复，再给电脑减负。我把思路整理成了 5 张图，最后一张是可以直接问 AI 的提示词。\n\n密钥、证书、数据库和原始素材记得单独备份；不确定的文件先别删。先收藏，下次空间不够时照着检查。',tags:['AI开发','小白学GitHub'],delivery:null},
      xiaohongshu:{title:'Mac满了，项目又不敢删',body:'项目越做越多，电脑却快装不下了。想删，又怕以后找不回来。\n\n我最近在学：给代码找一个“存档柜”。先存到 GitHub，试着取回来，确认能恢复，再清理本地。\n\n整理了 5 张小白也能看懂的图。最后一张可以直接发给 AI，让它先检查、讲理由。\n\n密钥、证书和素材另行备份，不确定的先别删。一起慢慢学会这些小事。',tags:['AI开发','GitHub入门','独立开发'],delivery:null},
      douyin:{title:'电脑满了，项目怎么存？',body:'用 AI 做项目，电脑越来越满，旧项目又不敢删？我也在慢慢学：先把代码存到 GitHub 私有仓库，再取回来验证，确认能恢复后才清理本地。这 5 张图只讲一件小事，最后一张是可以直接问 AI 的提示词。不确定的先别删，密钥、证书和素材要另行备份。先收藏，下次电脑空间不够时翻出来。',tags:['AI开发','GitHub入门'],delivery:null}
    }
  };
}
export function validateProject(p) {
  if (!p || typeof p!=='object' || p.schema!==SCHEMA || !/^[a-zA-Z0-9_-]{1,80}$/.test(p.id||'')) throw new Error('无效的项目文件');
  if (!p.content || typeof p.content.topic!=='string' || typeof p.content.takeaway!=='string' || typeof p.content.series!=='string' || !Array.isArray(p.content.cards) || p.content.cards.length>MAX_CARDS) throw new Error('项目内容格式错误');
  for(const c of p.content.cards) {
    if(!CARD_KINDS.includes(c.kind) || ['eyebrow','title','body','note'].some(k=>typeof c[k]!=='string' || c[k].length>3000)) throw new Error('图卡格式错误');
    if(c.blocks!==undefined && (!Array.isArray(c.blocks)||c.blocks.length>20||c.blocks.some(b=>!b||!BLOCK_TYPES.includes(b.type)||typeof b.heading!=='string'||typeof b.text!=='string'||b.heading.length>3000||b.text.length>3000))) throw new Error('内容区块格式错误');
  }
  if(p.content.brief!==undefined){
    const b=p.content.brief;
    if(!b||['audience','benefit','direction'].some(k=>typeof b[k]!=='string'||b[k].length>12000)||!Array.isArray(b.references)||b.references.length>4)throw new Error('创作简报格式错误');
    for(const ref of b.references)if(!ref||typeof ref.name!=='string'||ref.name.length>300||typeof ref.note!=='string'||ref.note.length>3000||typeof ref.data!=='string'||ref.data.length>2800000||!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(ref.data))throw new Error('参考图格式错误，仅接受本地 PNG、JPEG 或 WebP');
  }
  validatePlanning(p.planning);
  validateCreative(p);
  if(!p.visual || !['sage','ink','rose'].includes(p.visual.theme) || !['airy','compact'].includes(p.visual.layout)) throw new Error('视觉配置错误');
  if(p.visual.artwork!==undefined){
    if(!p.visual.artwork||typeof p.visual.artwork!=='object'||Array.isArray(p.visual.artwork))throw new Error('素材配置错误');
    for(const [index,id] of Object.entries(p.visual.artwork))if(!/^(0|[1-9]\d*)$/.test(index)||Number(index)>=p.content.cards.length||!ICON_IDS.has(id))throw new Error('素材不存在，请重新选择');
  }
  if(p.visual.pageLayouts!==undefined){
    if(!p.visual.pageLayouts||typeof p.visual.pageLayouts!=='object'||Array.isArray(p.visual.pageLayouts))throw new Error('页面编排格式错误');
    for(const [index,layout] of Object.entries(p.visual.pageLayouts))if(!/^(0|[1-9]\d*)$/.test(index)||Number(index)>=p.content.cards.length||!PAGE_LAYOUTS.includes(layout))throw new Error('页面编排格式错误');
  }
  for(const k of Object.keys(PLATFORMS)) if(!p.platforms?.[k] || typeof p.platforms[k].title!=='string' || typeof p.platforms[k].body!=='string' || !Array.isArray(p.platforms[k].tags) || p.platforms[k].tags.some(t=>typeof t!=='string')) throw new Error('平台配文格式错误');
  return p;
}
