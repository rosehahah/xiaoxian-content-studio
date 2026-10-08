import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,chmod,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {executeEgoTask,draftAutomationAvailable,runCreatorDraft} from '../draft-automation.mjs';

test('正式驱动仅调用 Ego CLI，按顺序回传状态，缺失时直接报错',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'studio-ego-driver-')),savedPath=process.env.PATH,driver=process.env.STUDIO_DRAFT_DRIVER;
  delete process.env.STUDIO_DRAFT_DRIVER;
  try{
    const log=path.join(dir,'args.json'),bin=path.join(dir,'ego-browser');
    await writeFile(bin,`#!${process.execPath}\nconst fs=require('node:fs');if(process.argv.includes('--version')){console.log('ego-test');process.exit(0);}fs.writeFileSync(${JSON.stringify(log)},JSON.stringify(process.argv.slice(2)));console.log('STUDIO_EGO_EVENT '+JSON.stringify({status:'opening',message:'Ego Lite'}));console.log('STUDIO_EGO_EVENT '+JSON.stringify({status:'filled',message:'已填好'}));`);await chmod(bin,0o755);process.env.PATH=dir;
    assert.equal(await draftAutomationAvailable(),true);const updates=[];
    await executeEgoTask({kind:'draft',platform:'xiaohongshu',title:'测试 $() `文字`',body:'只做本机测试',tags:[],imageFiles:[]},async(s,m)=>updates.push([s,m]));
    const args=JSON.parse(await readFile(log,'utf8'));assert.deepEqual(args.slice(0,2),['nodejs','-e']);assert.ok(args[2].includes('runEgoCreatorTask'));assert.ok(!args[2].includes('launchPersistentContext'));assert.deepEqual(updates.map(x=>x[0]),['opening','filled']);
    await rm(bin);assert.equal(await draftAutomationAvailable(),false);await assert.rejects(runCreatorDraft({platform:'douyin',title:'',body:'',tags:[],imageFiles:[],onUpdate:async()=>{}}),/Ego Lite.*不会改用 Chrome/);
  }finally{process.env.PATH=savedPath;if(driver===undefined)delete process.env.STUDIO_DRAFT_DRIVER;else process.env.STUDIO_DRAFT_DRIVER=driver;await rm(dir,{recursive:true,force:true});}
});
