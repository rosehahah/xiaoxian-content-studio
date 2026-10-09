import {test} from 'node:test';import assert from 'node:assert/strict';
import {watchSessionJob} from '../dist/session-monitor.mjs';
test('关闭进度窗口后继续读取抖音任务，最终状态仍送回页面',async()=>{
 let dialogOpen=true,calls=0;const states=[];
 const job=await watchSessionJob({getJob:async()=>({platform:'douyin',status:++calls===1?'opening':'logged_in'}),onUpdate:job=>{states.push(job.status);dialogOpen=false;},wait:async()=>{}});
 assert.equal(dialogOpen,false);assert.equal(job.status,'logged_in');assert.deepEqual(states,['opening','logged_in']);
});
test('抖音需要登录或验证时有明确终态，不伪造已登录',async()=>{
 for(const status of ['waiting_login','needs_attention','error']){let calls=0;const job=await watchSessionJob({getJob:async()=>{calls++;return {status};},onUpdate:()=>{},wait:async()=>{}});assert.equal(job.status,status);assert.equal(calls,1);}
});
test('短暂读取失败会重试；持续失败和无终态超时有可操作提示',async()=>{
 let calls=0;const job=await watchSessionJob({getJob:async()=>{if(++calls===1)throw Error('network');return {status:'logged_in'};},onUpdate:()=>{},wait:async()=>{}});assert.equal(job.status,'logged_in');
 await assert.rejects(watchSessionJob({getJob:async()=>{throw Error('network');},onUpdate:()=>{},wait:async()=>{}}),/无法读取登录检查结果/);
 let clock=0;await assert.rejects(watchSessionJob({getJob:async()=>({status:'checking'}),onUpdate:()=>{},now:()=>clock,timeout:2,wait:async()=>clock++}),/未返回完整结果/);
});
