import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {diskPreflight} from '../content-storage.mjs';
import {execFileSync} from 'node:child_process';
import os from 'node:os';
const root=fileURLToPath(new URL('..',import.meta.url));
async function size(directory){
  let s;try{s=await fs.stat(directory);}catch(e){if(e.code==='ENOENT')return 0;throw e;}
  if(!s.isDirectory())return s.size;
  let total=0;for(const name of await fs.readdir(directory)){const file=path.join(directory,name),entry=await fs.lstat(file);if(entry.isSymbolicLink())continue;total+=entry.isDirectory()?await size(file):entry.size;}return total;
}
const dependencies=(await size(path.join(root,'node_modules')))||200*1024*1024,dist=await size(path.join(root,'dist'));
const data=process.env.STUDIO_DATA_DIR?await size(path.join(process.env.STUDIO_DATA_DIR,'projects.json')):0;
const expectedBytes=dependencies*2+dist*3+data*3+150*1024*1024;
const reserveBytes=Math.max(1024*1024*1024,Math.ceil((expectedBytes+data)*.2));
const report=await diskPreflight(root,{expectedBytes,backupBytes:data,reserveBytes});
const paths=[root,os.tmpdir(),path.join(os.homedir(),'.npm')],df=execFileSync('df',['-k',...paths.filter(p=>{try{return Boolean(execFileSync('test',['-e',p]));}catch{return false;}})],{encoding:'utf8'});
console.log(JSON.stringify({timestamp:new Date().toISOString(),operation:process.argv[2]||'build-test-package',paths_and_volumes:paths,df_raw:df,free_bytes:report.availableBytes,peak_incremental_bytes:expectedBytes,new_rollback_backup_bytes:data,safety_margin_bytes:reserveBytes,required_free_bytes:expectedBytes+data+reserveBytes,estimate_basis_or_fallback:'2 dependency copies (200MiB fallback) + 3 dist copies + migration snapshots + 150MiB package allowance',decision:'proceed',...report},null,2));
