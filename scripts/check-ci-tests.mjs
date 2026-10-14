import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
const files=(await fs.readdir('tests')).filter(f=>f.endsWith('.test.mjs')).map(f=>path.join('tests',f));
const child=spawn(process.execPath,['--test','--test-reporter=tap',...files],{stdio:['ignore','pipe','inherit']});
let output='';child.stdout.on('data',chunk=>{output+=chunk;process.stdout.write(chunk);});
const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});
const skips=output.split('\n').filter(line=>/# SKIP/.test(line));
const expected=[
 '七个标签都在多段正文末尾，选择精确名称并处理编辑器替换',
 '延迟候选和异步编辑器替换不会使下一个标签插入正文',
 '只有相近候选时保留普通话题，绝不选择巅峰赛',
 '长正文滚出视口、嵌套段落和末尾结构化话题都能正确追加',
 'textarea和空正文也支持末尾定位，无候选时按原顺序保留',
 '正文填写不完整时不添加话题；选中后正文损坏时停止后续输入'
];
const unexpected=skips.filter(line=>!expected.some(name=>line.includes(name)));
if(code!==0||unexpected.length||skips.length!==expected.length){console.error('CI测试或skip白名单失败', {code,skips:skips.length,unexpected});process.exitCode=1;}
else console.log('CI: only the six declared Ego cases skipped. Release additionally requires same-SHA local Ego evidence; CI does not prove browser or remote publishing success.');
