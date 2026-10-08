import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const testPath=fileURLToPath(new URL('../tests/xiaohongshu-topics.test.mjs',import.meta.url));
const space=process.env.STUDIO_EGO_SPACE;
const code=`const task=await taskSpace(${space?Number(space):JSON.stringify('小苋 · 话题编辑器回归')});globalThis.__studioEgoTestPage=task.page('p1');console.log({spaceId:task.spaceId,url:await task.page('p1').url()});const cases=[];let setup,cleanup;globalThis.__studioEgoTestHarness={test:(name,options,fn)=>cases.push({name,fn:fn||options}),before:fn=>setup=fn,after:fn=>cleanup=fn};await import(${JSON.stringify(testPath)});await setup();try{for(const item of cases){await item.fn();console.log('PASS '+item.name);}console.log({passed:cases.length,browser:'ego-lite'});}finally{await cleanup();}${space?'':"await task.finish({keep:[]});"}`;
const child=spawn('ego-browser',['nodejs','-e',code],{stdio:'inherit'});child.on('error',error=>{console.error('Ego Lite 无法启动：'+error.message);process.exitCode=1;});child.on('exit',code=>process.exitCode=code??1);
