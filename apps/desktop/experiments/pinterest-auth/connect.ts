declare const chrome: {
 runtime:{sendMessage(m:{type:string}):Promise<{phase:string;message:string;ok?:boolean}>};
 permissions:{request(o:{origins:string[]}):Promise<boolean>};
};
const status=document.querySelector<HTMLElement>('#status')!;
const submit=document.querySelector<HTMLButtonElement>('#submit')!;
const consent=document.querySelector<HTMLInputElement>('#consent')!;
const retry=document.querySelector<HTMLButtonElement>('#retry')!;
const stop=document.querySelector<HTMLButtonElement>('#stop')!;
let phase='idle',busy=false;
function render(s:{phase:string;message:string}){
 phase=s.phase;status.textContent=s.message;document.body.dataset.phase=phase;
 const waiting=phase==='waiting'||phase==='sending';
 document.querySelector<HTMLElement>('.consent')!.hidden=phase!=='ready';
 submit.hidden=waiting||phase==='done';submit.disabled=busy||(phase==='ready'&&!consent.checked);
 submit.textContent=phase==='ready'?'连接 Pinterest':'重新连接 画布工作区';
 retry.hidden=phase!=='waiting';stop.hidden=!waiting;
 document.querySelector<HTMLElement>('#state-label')!.textContent=({ready:'已连接',waiting:'等待登录',sending:'正在接续',done:'已接续',idle:'待连接',error:'连接中断'} as Record<string,string>)[phase]??'待连接';
}
async function request(type:string){try{render(await chrome.runtime.sendMessage({type}));}catch{render({phase:'error',message:'连接器已更新，请关闭气泡后重新打开。'});}}
consent.addEventListener('change',()=>{submit.disabled=busy||!consent.checked;});
submit.addEventListener('click',async()=>{
 if(busy)return;busy=true;submit.disabled=true;
 try{
  if(phase==='ready'){
   if(!consent.checked)return;
   if(!await chrome.permissions.request({origins:['https://*.pinterest.com/*']})){status.textContent='未授权，未读取或传输数据。';return;}
   await request('start');
  }else await request('pair');
 }finally{busy=false;submit.disabled=phase==='ready'&&!consent.checked;}
});
retry.addEventListener('click',()=>{void request('check');});
stop.addEventListener('click',()=>{void request('stop');});
void request('pair');
const timer=setInterval(()=>{if(!busy)void request('status');},1000);
window.addEventListener('pagehide',()=>clearInterval(timer));
if(new URL(location.href).searchParams.has('launch')){
 void chrome.runtime.sendMessage({type:'open-popup'}).then(r=>{if(!r.ok)document.querySelector<HTMLElement>('#launch-hint')!.hidden=false;});
}
export {};
