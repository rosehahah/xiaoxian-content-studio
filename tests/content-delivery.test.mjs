import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import JSZip from 'jszip';
import {ensureContentFields} from '../content-schema.mjs';
import {stableHash,articleHash,variantHash,articleApproved,variantApproved,updateSources,patchArticle,approveArticle,variantInput,importVariants,approveVariant,patchVariant} from '../content-domain.mjs';
import {storeAsset} from '../content-storage.mjs';
import {EXECUTION_VERSIONS,deliveryPayloadHash,recoverDeliveries,contentArtifact,buildContentPackage,getExportWork,newDelivery,persistDelivery} from '../content-delivery.mjs';

const sha=b=>createHash('sha256').update(b).digest('hex');
const project=()=>ensureContentFields({schema:2,id:'delivery-fixture',revision:0,content:{topic:'fixture',cards:[]},visual:{theme:'sage',layout:'airy'},platforms:{wechat:{title:'',body:'',tags:[]}}});
async function fixture(t){const local=await fs.mkdtemp(path.join(os.tmpdir(),'studio-delivery-unit-'));t.after(()=>fs.rm(local,{recursive:true,force:true}));return local;}
async function article(local){const p=project(),bytes=Buffer.from('47494638396101000100800000000000ffffff21f90400000000002c00000000010001000002024401003b','hex'),{asset}=await storeAsset(local,p,{mimeType:'image/gif',data:'data:image/gif;base64,'+bytes.toString('base64'),alt:'操作动图',caption:'真实步骤'});patchArticle(p,{title:'真实成果',bodyMd:'正文和尾部检查。\n\n![操作](asset:'+asset.id+')',assets:[asset.id]});approveArticle(p,articleHash(p));return {p,asset,bytes};}
function variant(p){p.selectedChannels.overseas=['linkedin'];const input=variantInput(p,[{id:'linkedin-en',channel:'linkedin',format:'post',locale:'en'}],p.article.id);importVariants(p,{revision:p.revision,inputFingerprint:input.inputFingerprint,keys:input.keys,sourceWorkId:p.article.id,variants:[{...input.keys[0],title:'Result',bodyMd:'A useful professional lesson.',assets:[],sourceDeps:[],profileVersion:'2026-10-15'}]});approveVariant(p,'linkedin-en',variantHash(p,p.variants[0]));return p.variants[0];}

test('content hashes exclude destination while delivery keys bind destination and execution versions',async t=>{
 const local=await fixture(t),{p}=await article(local),v=variant(p),content=variantHash(p,v),before=deliveryPayloadHash(p,v);
 patchVariant(p,v.id,{target:{accountId:'other-account'}});assert.equal(variantHash(p,p.variants[0]),content);assert.notEqual(deliveryPayloadHash(p,p.variants[0]),before);assert.notEqual(deliveryPayloadHash(p,v,{destination:'publication-A'}),deliveryPayloadHash(p,v,{destination:'publication-B'}));
 for(const key of ['adapterVersion','converterVersion']){const original=EXECUTION_VERSIONS[key],current=deliveryPayloadHash(p,p.variants[0]);try{EXECUTION_VERSIONS[key]='test-next-'+key;assert.notEqual(deliveryPayloadHash(p,p.variants[0]),current);}finally{EXECUTION_VERSIONS[key]=original;}}
 const vCurrent=p.variants[0];assert.notEqual(deliveryPayloadHash(p,vCurrent),deliveryPayloadHash(p,{...vCurrent,profileVersion:'test-next-profile'}));assert.notEqual(deliveryPayloadHash(p,vCurrent,{mode:'export'}),deliveryPayloadHash(p,vCurrent,{mode:'draft'}));
});
test('only approved source articles and approved variants can be selected for export',async t=>{
 const local=await fixture(t),{p}=await article(local);assert.equal(articleApproved(p),true);assert.equal(getExportWork(p,'article-main').format,'article');variant(p);assert.equal(getExportWork(p,'linkedin-en').id,'linkedin-en');patchArticle(p,{bodyMd:'Revised source.'});assert.throws(()=>getExportWork(p,'article-main'),e=>e.status===409);assert.throws(()=>getExportWork(p,'linkedin-en'),e=>e.status===409);assert.throws(()=>getExportWork(p,'missing'),e=>e.status===404);
});
test('local package includes offline HTML, exact GIF and a valid archive SHA without source materials or credentials',async t=>{
 const local=await fixture(t),{p,asset,bytes}=await article(local);p.sourceBundle.sources.push({id:'private-source',locator:'private.txt',text:'PRIVATE_RAW_MATERIAL_77',contentHash:null});p.privateConfig={token:'PRIVATE_CREDENTIAL_88'};
 const work=getExportWork(p,'article-main'),{delivery}=newDelivery(p,work),pkg=await buildContentPackage(local,p,work,{artifactHash:articleHash(p),deliveryId:delivery.id});
 const archive=await fs.readFile(path.join(local,pkg.relativePath));assert.equal(sha(archive),pkg.sha256);const zip=await JSZip.loadAsync(archive),names=Object.keys(zip.files);const html=await zip.file('article.html').async('string');assert.match(html,/assets\/[a-f0-9]+\.gif/);assert.equal(/<script\b|<link[^>]+https:/i.test(html),false);assert.equal(names.some(n=>n.includes('private')||n.includes('sourceBundle')),false);assert.deepEqual(await zip.file('assets/'+asset.sha256+'.gif').async('nodebuffer'),bytes);
 for(const file of Object.values(zip.files).filter(f=>!f.dir)){const text=await file.async('string');assert.equal(text.includes('PRIVATE_RAW_MATERIAL_77'),false);assert.equal(text.includes('PRIVATE_CREDENTIAL_88'),false);}
 assert.match(await zip.file('使用说明.txt').async('string'),/未写入任何平台/);assert.equal(JSON.parse(await zip.file('审核记录.json').async('string')).artifactHash,articleHash(p));
});
test('standalone previews embed registered image bytes and keep GIF media type',async t=>{const local=await fixture(t),{p}=await article(local),result=await contentArtifact(local,p,p.article,{standalone:true});assert.match(result.html,/data:image\/gif;base64,/);assert.equal(result.files.length,1);});
test('captioned Markdown-only assets are included and rewritten for offline use',async t=>{
 const local=await fixture(t),{p,asset}=await article(local);for(const link of ['asset:'+asset.id+' "不能丢的图注"','<asset:'+asset.id+'> "尖括号图注"']){patchArticle(p,{assets:[],bodyMd:'![操作]('+link+')'});approveArticle(p,articleHash(p));const result=await contentArtifact(local,p,p.article);assert.equal(result.files.length,1);assert.match(result.html,/assets\/[a-f0-9]+\.gif/);assert.equal(result.markdown.includes('asset:'),false);}
});
for(const [label,pngAlt,gifAlt] of [['ordinary','真实截图','操作动图'],['nested alt','真实 [第一步] 截图','操作 [完整演练] 动图']]){
 test(`Markdown-only ${label} PNG and GIF survive caption re-review and offline export`,async t=>{
  const local=await fixture(t),{p,asset:gif,bytes:gifBytes}=await article(local);
  const pngBytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aG1cAAAAASUVORK5CYII=','base64');
  const {asset:png}=await storeAsset(local,p,{mimeType:'image/png',data:'data:image/png;base64,'+pngBytes.toString('base64'),caption:'截图原图注',alt:'截图登记说明'});
  const bodyMd=`![${pngAlt}](asset:${png.id})\n\n![${gifAlt}](<asset:${gif.id}>)`;
  patchArticle(p,{assets:[],bodyMd});approveArticle(p,articleHash(p));variant(p);
  const before=articleHash(p),beforeVariant=variantHash(p,p.variants[0]),changed=structuredClone(p.sourceBundle);changed.assets.find(a=>a.id===gif.id).caption='核对后修正的动图图注';updateSources(p,changed);
  assert.notEqual(articleHash(p),before);assert.notEqual(variantHash(p,p.variants[0]),beforeVariant);assert.equal(p.article.approval,null);assert.equal(p.variants[0].approval,null);
  assert.throws(()=>getExportWork(p,'article-main'),e=>e.status===409);assert.throws(()=>getExportWork(p,'linkedin-en'),e=>e.status===409);
  approveArticle(p,articleHash(p));variant(p);assert.equal(articleApproved(p),true);assert.equal(variantApproved(p,p.variants[0]),true);
  const work=getExportWork(p,'article-main'),offline=await contentArtifact(local,p,work),standalone=await contentArtifact(local,p,work,{standalone:true});
  const pngName='assets/'+png.sha256+'.png',gifName='assets/'+gif.sha256+'.gif';
  assert.equal(offline.files.length,2);assert.equal((offline.html.match(/<img\b/g)||[]).length,2);assert.equal(offline.html.includes('class="article-missing-asset"'),false);
  assert.ok(offline.html.includes(pngName));assert.ok(offline.html.includes(gifName));assert.ok(offline.html.includes('核对后修正的动图图注'));
  assert.ok(offline.html.includes('alt="'+pngAlt+'"'));assert.ok(offline.html.includes('alt="'+gifAlt+'"'));
  assert.equal(offline.markdown.replace('<'+gifName+'>',gifName),bodyMd.replace('asset:'+png.id,pngName).replace('<asset:'+gif.id+'>',gifName));
  assert.ok(standalone.html.includes('data:image/png;base64,'+pngBytes.toString('base64')));assert.ok(standalone.html.includes('data:image/gif;base64,'+gifBytes.toString('base64')));
  const {delivery}=newDelivery(p,work),pkg=await buildContentPackage(local,p,work,{artifactHash:articleHash(p),deliveryId:delivery.id}),zip=await JSZip.loadAsync(await fs.readFile(path.join(local,pkg.relativePath)));
  assert.deepEqual(await zip.file(pngName).async('nodebuffer'),pngBytes);assert.deepEqual(await zip.file(gifName).async('nodebuffer'),gifBytes);
  assert.equal(Object.values(zip.files).filter(f=>!f.dir&&f.name.startsWith('assets/')).length,2);
  assert.equal(await zip.file('article.md').async('string'),'# '+work.title+'\n\n'+offline.markdown);
  const boundaries=JSON.parse(await zip.file('来源与使用边界.json').async('string'));assert.deepEqual(boundaries.assets.map(a=>a.assetId).sort(),[png.id,gif.id].sort());
 });
}
const imageExampleForms=[
 ['inline code',id=>'`![图片示例](asset:'+id+')`'],
 ['fenced code',id=>'```markdown\n![图片示例](asset:'+id+')\n```'],
 ['escaped image',id=>'\\![图片示例](asset:'+id+')']
];
for(const [label,example] of imageExampleForms){
 test(`${label} examples export without registering example IDs or rewriting their text`,async t=>{
  const local=await fixture(t),{p,asset,bytes}=await article(local),literal=example(asset.id)+'\n\n'+example('not-registered');
  const actualImage='![真实动图](asset:'+asset.id+')',bodyMd=actualImage+'\n\n'+literal;
  patchArticle(p,{assets:[],bodyMd});approveArticle(p,articleHash(p));
  const work=getExportWork(p,'article-main'),artifact=await contentArtifact(local,p,work),name='assets/'+asset.sha256+'.gif';
  assert.equal(artifact.files.length,1);assert.deepEqual(artifact.files[0].data,bytes);assert.equal((artifact.html.match(/<img\b/g)||[]).length,1);assert.equal(artifact.html.includes('class="article-missing-asset"'),false);
  assert.equal(artifact.markdown,actualImage.replace('asset:'+asset.id,name)+'\n\n'+literal,'Only a rendered image destination is rewritten');
  if(label!=='escaped image')assert.match(artifact.html,/<code(?:\s[^>]*)?>!\[图片示例\]\(asset:/);
  const {delivery}=newDelivery(p,work),pkg=await buildContentPackage(local,p,work,{artifactHash:articleHash(p),deliveryId:delivery.id}),zip=await JSZip.loadAsync(await fs.readFile(path.join(local,pkg.relativePath)));
  assert.equal(await zip.file('article.md').async('string'),'# '+work.title+'\n\n'+artifact.markdown);
  assert.deepEqual(JSON.parse(await zip.file('来源与使用边界.json').async('string')).assets.map(a=>a.assetId),[asset.id]);
  patchArticle(p,{assets:[],bodyMd:literal});approveArticle(p,articleHash(p));const exampleWork=getExportWork(p,'article-main'),exampleArtifact=await contentArtifact(local,p,exampleWork);
  assert.equal(exampleArtifact.files.length,0);assert.equal(exampleArtifact.markdown,literal);assert.equal((exampleArtifact.html.match(/<img\b/g)||[]).length,0);assert.equal(exampleArtifact.html.includes('class="article-missing-asset"'),false);
  const next=newDelivery(p,exampleWork),examplePackage=await buildContentPackage(local,p,exampleWork,{artifactHash:articleHash(p),deliveryId:next.delivery.id}),exampleZip=await JSZip.loadAsync(await fs.readFile(path.join(local,examplePackage.relativePath)));
  assert.equal(await exampleZip.file('article.md').async('string'),'# '+exampleWork.title+'\n\n'+literal);
  assert.equal(Object.keys(exampleZip.files).some(n=>n.startsWith('assets/')),false);assert.deepEqual(JSON.parse(await exampleZip.file('来源与使用边界.json').async('string')).assets,[]);
 });
}
test('identical deliveries reuse running or completed records; changed targets get different keys',async t=>{
 const local=await fixture(t),{p}=await article(local),v=variant(p),first=newDelivery(p,v),second=newDelivery(p,v);assert.equal(first.reused,false);assert.equal(second.reused,true);assert.equal(first.delivery.id,second.delivery.id);first.delivery.status='local_ready';assert.equal(newDelivery(p,v).reused,true);patchVariant(p,v.id,{target:'second-account'});assert.equal(newDelivery(p,p.variants[0]).reused,false);assert.equal(p.deliveries.length,2);await persistDelivery(local,first.delivery);assert.equal(JSON.parse(await fs.readFile(path.join(local,'deliveries',first.delivery.id+'.json'),'utf8')).status,'local_ready');
});
test('running recovery distinguishes local interruption from unknown remote mutation',()=>{const p=project();p.deliveries=[{id:'a',status:'running',mode:'export'},{id:'b',status:'running',mode:'draft',remoteId:'known-id'},{id:'c',status:'draft_verified',mode:'draft'}];recoverDeliveries([p]);assert.equal(p.deliveries[0].status,'needs_attention');assert.equal(p.deliveries[1].status,'unknown_outcome');assert.equal(p.deliveries[1].remoteId,'known-id');assert.equal(p.deliveries[2].status,'draft_verified');});
test('unverified remote and formal publishing modes cannot create a task',async t=>{const local=await fixture(t),{p}=await article(local),work=getExportWork(p,'article-main');for(const args of [{mode:'draft'},{mode:'publish'},{destination:'https://remote.example'}])assert.throws(()=>newDelivery(p,work,args),e=>e.status===422);assert.equal(p.deliveries.length,0);});
test('cards exports require current generated images and verify their byte fingerprints',async t=>{
 const local=await fixture(t),{p}=await article(local);p.selectedChannels.overseas=['x'];const input=variantInput(p,[{id:'x-en-cards',channel:'x',format:'cards',locale:'en'}],p.article.id);importVariants(p,{revision:p.revision,inputFingerprint:input.inputFingerprint,keys:input.keys,sourceWorkId:p.article.id,variants:[{...input.keys[0],title:'English',bodyMd:'',profileVersion:'2026-10-15',assets:[],sourceDeps:[],cards:[{kind:'editorial',eyebrow:'',title:'Real output',body:'One useful instruction.',note:''}],visual:{theme:'sage',layout:'airy'}}]});const v=p.variants[0],hash=variantHash(p,v);approveVariant(p,v.id,hash);await assert.rejects(buildContentPackage(local,p,v,{artifactHash:hash,deliveryId:'before-render'}),e=>e.status===409);
 const bytes=Buffer.from('rendered-test-bytes'),relativePath=path.join('renders',p.id,hash,'01.png');await fs.mkdir(path.dirname(path.join(local,relativePath)),{recursive:true});await fs.writeFile(path.join(local,relativePath),bytes);v.renderedImages=[{relativePath,name:'01.png',contentHash:stableHash(bytes.toString('base64'))}];v.renderedImageHash=hash;
 const pkg=await buildContentPackage(local,p,v,{artifactHash:hash,deliveryId:'cards-render'}),zip=await JSZip.loadAsync(await fs.readFile(path.join(local,pkg.relativePath)));assert.deepEqual(await zip.file('images/01.png').async('nodebuffer'),bytes);await fs.writeFile(path.join(local,relativePath),'tampered');await assert.rejects(buildContentPackage(local,p,v,{artifactHash:hash,deliveryId:'tampered'}),/已改变/);
});
