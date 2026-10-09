export const SESSION_TERMINAL=new Set(['logged_in','waiting_login','needs_attention','error']);
// Continue independently of the progress dialog. Closing a dialog is not
// cancellation of the server's browser task.
export async function watchSessionJob({getJob,onUpdate,wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),now=()=>Date.now(),timeout=120000}){
  const deadline=now()+timeout;let failures=0;
  while(now()<deadline){
    let job;
    try{job=await getJob();failures=0;}catch(error){if(++failures>=3)throw Error('暂时无法读取登录检查结果，请重新检查；不会把账号当作已登录。');await wait(1500);continue;}
    await onUpdate(job);
    if(SESSION_TERMINAL.has(job.status))return job;
    await wait(1500);
  }
  throw Error('登录检查仍未返回完整结果，请检查 Ego Lite 页面后重新检查。');
}
