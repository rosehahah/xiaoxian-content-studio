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

import {eventReader,classifyCreatorSession,runEgoCreatorTask} from '../draft-automation.mjs';
test('状态流支持中文跨字节、分块及没有末尾换行，拒绝未知成功状态',()=>{
  const events=[],reader=eventReader(e=>events.push(e));const data=Buffer.from('noise\nSTUDIO_EGO_EVENT '+JSON.stringify({status:'logged_in',message:'已登录'}));
  for(const byte of data)reader.push(Buffer.from([byte]));reader.end();assert.equal(events[0].message,'已登录');
  assert.throws(()=>eventReader(()=>{}).push(Buffer.from('STUDIO_EGO_EVENT {"status":"success","message":"未知"}\n')),/格式错误/);
});
test('登录与安全验证优先于隐藏编辑器；支持已登录的默认视频页，未知页面不解锁',()=>{
  const base={url:'https://creator.xiaohongshu.com/publish/publish',text:'发布笔记 笔记管理 上传图文',creatorNavigation:true};
  assert.equal(classifyCreatorSession(base,'xiaohongshu').status,'logged_in');
  assert.equal(classifyCreatorSession({...base,loginForm:true,editor:true},'xiaohongshu').status,'waiting_login');
  assert.equal(classifyCreatorSession({...base,challenge:true},'xiaohongshu').status,'needs_attention');
  assert.equal(classifyCreatorSession({url:base.url,text:'',hiddenFileInput:true},'xiaohongshu').status,'unknown');
  assert.equal(classifyCreatorSession({...base,url:'https://unrelated.example/'},'xiaohongshu').status,'unknown');
});
test('登录检查仅观察，不切换图文、不上传；已登录后一次完成',async()=>{
  const events=[];let finish=0;
  const page={goto:async()=>{},snapshot:async()=>{},evaluate:async()=>({url:'https://creator.xiaohongshu.com/publish/publish',creatorNavigation:true})};
  await runEgoCreatorTask({kind:'session',platform:'xiaohongshu'},{configurePermissions:async()=>{},taskSpace:async()=>({spaceId:1,page:()=>page,finish:async()=>finish++,handOff:async()=>assert.fail()}),onEvent:e=>events.push(e)});
  assert.deepEqual(events.map(e=>e.status),['opening','logged_in']);assert.equal(finish,1);
});
test('需要登录时移交页面，不能宣布已登录或继续填写',async()=>{
  let handOff=0,finish=0;const events=[];
  const page={goto:async()=>{},snapshot:async()=>{},evaluate:async()=>({url:'https://creator.xiaohongshu.com/login',loginForm:true,editor:true})};
  await runEgoCreatorTask({kind:'session',platform:'xiaohongshu'},{configurePermissions:async()=>{},taskSpace:async()=>({spaceId:2,page:()=>page,finish:async()=>finish++,handOff:async()=>handOff++}),onEvent:e=>events.push(e)});
  assert.equal(handOff,1);assert.equal(finish,0);assert.equal(events.at(-1).status,'waiting_login');
});
test('控制台没有输出时仍从本机进度文件读取结果；只有中间状态不能算成功',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'studio-ego-journal-')),savedPath=process.env.PATH;
  try{
    const bin=path.join(dir,'ego-browser');
    await writeFile(bin,`#!${process.execPath}\nconst fs=require('node:fs');const source=process.argv.at(-1);const file=JSON.parse(source.match(/appendFile\\(("(?:[^"\\\\]|\\\\.)*")/)[1]);fs.writeFileSync(file,JSON.stringify({status:'opening',message:'打开'})+'\\n'+JSON.stringify({status:'logged_in',message:'已登录',spaceId:7})+'\\n'+JSON.stringify({complete:true})+'\\n');`);await chmod(bin,0o755);process.env.PATH=dir;
    const events=[];await executeEgoTask({kind:'session',platform:'xiaohongshu'},async(s,m,e)=>events.push(e));assert.equal(events.at(-1).status,'logged_in');assert.equal(events.at(-1).spaceId,7);
    await writeFile(bin,`#!${process.execPath}\nprocess.stdout.write('STUDIO_EGO_EVENT '+JSON.stringify({status:'opening',message:'只打开页面'}));`);
    await assert.rejects(executeEgoTask({kind:'session',platform:'xiaohongshu'},async()=>{}),/未返回完整结果/);
  }finally{process.env.PATH=savedPath;await rm(dir,{recursive:true,force:true});}
});
test('移交后的窗口没有 p1 时接回现有页面，不依赖旧标签',async()=>{
  let adopted=0;const kept=[];
  const page={label:'p2',goto:async()=>{},snapshot:async()=>{},evaluate:async()=>({url:'https://creator.xiaohongshu.com/publish/publish',creatorNavigation:true})};
  const task={spaceId:28,pages:async()=>[],tabs:async()=>[{active:true,page}],adopt:async p=>{adopted++;return p;},page:()=>assert.fail('旧标签不能再被使用'),finish:async result=>kept.push(result.keep),handOff:async()=>assert.fail()};
  await runEgoCreatorTask({kind:'session',platform:'xiaohongshu'},{configurePermissions:async()=>{},taskSpace:async()=>task,onEvent:()=>{}});assert.equal(adopted,1);assert.deepEqual(kept,[['p2']]);
});
test('CLI 异常退出时不把此前的已登录事件提交为成功',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'studio-ego-incomplete-')),savedPath=process.env.PATH;
  try{const bin=path.join(dir,'ego-browser');await writeFile(bin,`#!${process.execPath}\nconsole.log('STUDIO_EGO_EVENT '+JSON.stringify({status:'logged_in',message:'尚未完成'}));process.exitCode=1;`);await chmod(bin,0o755);process.env.PATH=dir;const events=[];await assert.rejects(executeEgoTask({kind:'session',platform:'xiaohongshu'},async s=>events.push(s)));assert.ok(!events.includes('logged_in'));}finally{process.env.PATH=savedPath;await rm(dir,{recursive:true,force:true});}
});
test('两个平台的登录检查都在打开创作中心前拒绝权限；设置失败不继续打开',async()=>{
  for(const platform of ['douyin','xiaohongshu']){
    const order=[];
    const page={label:'p1',goto:async()=>order.push('navigate'),snapshot:async()=>{},evaluate:async()=>({url:'https://creator.'+platform+'.com/publish',editor:true})};
    const task={spaceId:1,page:()=>page,finish:async()=>{},handOff:async()=>{}};
    await runEgoCreatorTask({kind:'session',platform},{taskSpace:async()=>task,configurePermissions:async(p,key)=>{assert.equal(p,page);assert.equal(key,platform);order.push('deny');},onEvent:()=>{}});
    assert.deepEqual(order,['deny','navigate']);order.length=0;
    await assert.rejects(runEgoCreatorTask({kind:'session',platform},{taskSpace:async()=>task,configurePermissions:async()=>{throw Error('权限设置未保存');},onEvent:()=>{}}),/权限设置未保存/);
    assert.deepEqual(order,[]);
  }
});
