// Project-owned compatibility layer. All browser actions go through Ego Lite's
// documented Page API; this never launches or attaches to another browser.
let sequence=0;
export class EgoPageAdapter {
  constructor(page){this.native=page;}
  locator(selector){return new EgoElement(this,{selector});}
  getByRole(role){return new EgoElement(this,{selector:role==='button'?'button,[role="button"]':`[role="${role}"]`});}
  getByText(pattern){return new EgoElement(this,{selector:'body *',pattern:pattern.source,flags:pattern.flags,leaf:true});}
  evaluate(fn,arg){return arg===undefined?this.native.evaluate(fn):this.native.evaluate(fn,arg);}
  async setContent(html){await this.native.goto('about:blank');await this.native.evaluate(html=>{document.open();document.write(html);document.close();},html);}
  async close(){} // Synthetic regression cases reuse one task page.
}
class EgoElement {
  constructor(page,query,index=null){this.page=page;this.query=query;this.index=index;}
  first(){return new EgoElement(this.page,this.query,0);}
  nth(index){return new EgoElement(this.page,this.query,index);}
  inspectSource(source,arg){
    const code=`(()=>{const query=${JSON.stringify(this.query)},index=${JSON.stringify(this.index)};let nodes=[...document.querySelectorAll(query.selector)];if(query.pattern){const re=new RegExp(query.pattern,query.flags);const matches=n=>{re.lastIndex=0;return re.test(n.textContent||'');};nodes=nodes.filter(n=>matches(n)&&(!query.leaf||![...n.children].some(matches)));}return (${source})(nodes,index,${JSON.stringify(arg)??'undefined'});})()`;
    return this.page.native.evaluate(code);
  }
  inspect(fn,arg){return this.inspectSource(fn.toString(),arg);}
  count(){return this.inspect(nodes=>nodes.length);}
  allTextContents(){return this.inspect(nodes=>nodes.map(n=>n.textContent));}
  evaluate(fn,arg){return this.inspectSource(`(nodes,index,arg)=>{const node=nodes[index??0];if(!node)throw Error('页面元素已变化');return (${fn.toString()})(node,arg);}`,arg);}
  isVisible(){return this.inspect((nodes,index)=>{const n=nodes[index??0];return Boolean(n&&n.getClientRects().length&&getComputedStyle(n).visibility!=='hidden');});}
  isEnabled(){return this.evaluate(n=>!n.disabled&&n.getAttribute('aria-disabled')!=='true');}
  innerText(){return this.evaluate(n=>n.innerText);}
  inputValue(){return this.evaluate(n=>n.value);}
  getAttribute(key){return this.evaluate((n,key)=>n.getAttribute(key),key);}
  async target(){const marker='ego-'+(++sequence);await this.evaluate((n,marker)=>n.setAttribute('data-studio-ego-node',marker),marker);return `[data-studio-ego-node="${marker}"]`;}
  async fill(value){return this.page.native.fill(await this.target(),value);}
  async click(options){return this.page.native.click(await this.target(),options);}
  async press(key){return this.page.native.press(await this.target(),key);}
  async pressSequentially(value){await this.page.native.focus(await this.target());return this.page.native.keyboard.insertText(value);}
  async setInputFiles(files){return this.page.native.setInputFiles(await this.target(),files);}
  async waitFor({state='visible',timeout=3000}={}){const end=Date.now()+timeout;do{const visible=await this.isVisible();if(state==='hidden'?!visible:visible)return;await new Promise(r=>setTimeout(r,80));}while(Date.now()<end);throw Error('等待页面元素超时');}
}
