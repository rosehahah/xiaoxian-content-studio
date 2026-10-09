// Persist real site permissions through Ego Lite's built-in settings UI.
// Its CDP endpoint does not implement Browser.setPermission/grantPermissions.
const ORIGINS={
  douyin:['https://creator.douyin.com','https://www.douyin.com','https://douyin.com'],
  xiaohongshu:['https://creator.xiaohongshu.com','https://www.xiaohongshu.com','https://xiaohongshu.com'],
};
export async function configureCreatorPermissions(page,platform){
  const origins=ORIGINS[platform];if(!origins)throw Error('不支持的平台');
  for(const origin of origins){
    await page.goto('chrome://settings/content/siteDetails?site='+encodeURIComponent(origin));
    await page.waitForSelector('select[aria-label="位置信息"]',{state:'attached',timeout:10000});
    const controls=await page.evaluate(()=>{
      const result=[];
      // Settings uses nested open shadow roots. Only permission gates are blocked;
      // JavaScript, images and other rendering settings are not permission requests.
      const additional=new Set(['location','media-stream-camera','media-stream-mic','notifications','sensors','payment-handler','federated-identity-api','automatic-fullscreen']);
      function scan(root){for(const el of root.querySelectorAll('*')){
        if(el.tagName==='SELECT'&&el.getClientRects().length){
          const category=el.getRootNode().host?.category;
          const asks=[...el.options].some(o=>o.value==='default'&&/询问|ask/i.test(o.textContent));
          if((asks||additional.has(category))&&[...el.options].some(o=>o.value==='block')){
            const marker='permission-'+result.length;el.setAttribute('data-studio-permission',marker);
            result.push({marker,category,value:el.value});
          }
        }
        if(el.shadowRoot)scan(el.shadowRoot);
      }}scan(document);return result;
    });
    if(!controls.some(c=>c.category==='location'))throw Error('未能读取'+origin+'的权限设置，已停止打开创作中心');
    for(const control of controls)if(control.value!=='block')await page.selectOption('[data-studio-permission="'+control.marker+'"]','block');
    // Reload to verify these are saved browser settings, not just changed form values.
    await page.reload();
    await page.waitForSelector('select[aria-label="位置信息"]',{state:'attached',timeout:10000});
    const blocked=await page.evaluate(categories=>{
      const values={};function scan(root){for(const el of root.querySelectorAll('*')){
        if(el.tagName==='SELECT')values[el.getRootNode().host?.category]=el.value;
        if(el.shadowRoot)scan(el.shadowRoot);
      }}scan(document);return categories.every(category=>values[category]==='block');
    },controls.map(c=>c.category));
    if(!blocked)throw Error(origin+'的自动拒绝权限设置未保存，已停止打开创作中心');
  }
}
