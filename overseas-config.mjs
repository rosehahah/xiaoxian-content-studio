import fs from 'node:fs/promises';
import path from 'node:path';

export function validateSubstackUrl(value) {
  if(!value)return '';
  let url;try{url=new URL(value);}catch{throw Error('请输入 https://你的刊物.substack.com 形式的地址');}
  if(url.protocol!=='https:'||url.username||url.password||url.port||!url.hostname.endsWith('.substack.com')||url.hostname.split('.').length!==3||url.search||url.hash||!['','/','/publish','/publish/'].includes(url.pathname))throw Error('请填写 HTTPS 的 Substack 刊物地址，不包含文章路径、参数或登录信息');
  return url.origin;
}
export async function loadOverseasConfig(local,env=process.env) {
  let saved={};
  try{const raw=await fs.readFile(path.join(local,'overseas-config.json'),'utf8');if(raw.length>16384)throw Error();saved=JSON.parse(raw);if(!saved||typeof saved!=='object'||Array.isArray(saved))throw Error();}
  catch(error){if(error.code!=='ENOENT')throw Error('本机 overseas-config.json 格式错误，请检查配置文件');}
  const token=env.STUDIO_X_ACCESS_TOKEN||saved.xAccessToken||'';
  if(typeof token!=='string'||token.length>10000)throw Error('本机 X 访问令牌格式错误');
  const publicationUrl=validateSubstackUrl(env.STUDIO_SUBSTACK_URL||saved.substackPublicationUrl||'');
  return {env:{STUDIO_X_ACCESS_TOKEN:token},publicationUrl};
}
export async function saveSubstackUrl(local,value,env=process.env) {
  if(env.STUDIO_SUBSTACK_URL)throw Error('Substack 地址由 STUDIO_SUBSTACK_URL 配置，请在本机环境中修改');
  const publicationUrl=validateSubstackUrl(value);
  const file=path.join(local,'overseas-config.json');let saved={};
  try{saved=JSON.parse(await fs.readFile(file,'utf8'));if(!saved||typeof saved!=='object'||Array.isArray(saved))throw Error();}catch(error){if(error.code!=='ENOENT')throw Error('本机 overseas-config.json 格式错误，请先检查配置文件');}
  await fs.writeFile(file+'.tmp',JSON.stringify({...saved,substackPublicationUrl:publicationUrl},null,2),{mode:0o600});
  await fs.chmod(file+'.tmp',0o600);await fs.rename(file+'.tmp',file);
  return publicationUrl;
}
