type State = { phase: string; message: string; code?: string; expires?: number };
declare const chrome: {
 runtime: {id:string;getURL(p:string):string;sendNativeMessage(n:string,m:unknown):Promise<{code?:string}>;onMessage:{addListener(fn:(m:{type?:string},s:{id?:string;url?:string;tab?:{id?:number}},r:(v:unknown)=>void)=>boolean):void}};
 storage:{session:{get(k:string):Promise<{connection?:State}>;set(v:{connection:State}):Promise<void>}};
 permissions:{contains(o:{origins:string[]}):Promise<boolean>};
 action:{openPopup():Promise<void>;setBadgeText(o:{text:string}):Promise<void>};
 tabs:{create(o:{url:string}):Promise<unknown>;remove(id:number):Promise<void>};
 cookies:{getAll(o:{domain:string}):Promise<Array<{name:string;value:string;domain:string;partitionKey?:unknown}>>;onChanged:{addListener(fn:(i:{cookie:{domain:string}})=>void):void}};
};
const idle: State = {phase:'idle',message:'先在 DA 点击 Google 登录，再回到这里接续。'};
const domains=['pinterest.com','.pinterest.com','www.pinterest.com'];
let queue=Promise.resolve();
function serial<T>(fn:()=>Promise<T>):Promise<T>{const next=queue.then(fn);queue=next.then(()=>undefined,()=>undefined);return next;}
async function save(state:State){await chrome.storage.session.set({connection:state});await chrome.action.setBadgeText({text:state.phase==='waiting'?'…':state.phase==='done'?'✓':''}).catch(()=>undefined);return state;}
async function read():Promise<State>{
 const s=(await chrome.storage.session.get('connection')).connection??idle;
 if(s.code&&(s.expires??0)<=Date.now())return save({phase:'error',message:'连接已过期，请从 DA 重新发起。'});
 return s;
}
async function pair(){
 const s=await read();if(s.code)return s;
 try{
  const result=await chrome.runtime.sendNativeMessage('com.canvas_workspace.pinterest_auth',{type:'claim'});
  const url=new URL(result.code??'');
  if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||!url.port||url.pathname!=='/'||url.username||url.password||url.search||!/^#[a-f0-9]{64}$/.test(url.hash))throw new Error();
  return save({phase:'ready',message:'已连接 DA，可以接续当前 Pinterest 账号。',code:url.href,expires:Date.now()+290000});
 }catch{return s.phase==='done'?s:save({...idle,message:'尚未连接 DA，请从 DA 的 Google 按钮发起。'});}
}
async function transfer(manual=false){
 const s=await read();if(s.phase!=='waiting'||!s.code)return s;
 try{
  if(!await chrome.permissions.contains({origins:['https://*.pinterest.com/*']}))return save({phase:'error',message:'Pinterest 授权已撤回，接续已停止。'});
  const cookies=(await chrome.cookies.getAll({domain:'pinterest.com'})).filter(c=>domains.includes(c.domain));
  if(!cookies.some(c=>c.name==='_pinterest_sess'&&c.value)||(!manual&&!cookies.some(c=>c.name==='_auth'&&c.value==='1')))return s;
  if(cookies.some(c=>c.partitionKey))return save({phase:'error',message:'暂不支持此分区会话，未发送数据。'});
  await save({...s,phase:'sending',message:'正在接续到 DA…'});
  const url=new URL(s.code),token=url.hash.slice(1);url.hash='';url.pathname='/connect';
  const response=await fetch(url.href,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(cookies),credentials:'omit',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(20000)});
  return save(response.ok?{phase:'done',message:'会话已接回 DA，请确认页面账号和采集正常。'}:{phase:'error',message:'接续未完成，请从 DA 重新发起。'});
 }catch{return save({phase:'error',message:'连接中断，请回 DA 检查并重试。'});}
}
async function handle(type:string|undefined){
 if(type==='pair')return pair();
 if(type==='stop')return save({...idle,message:'已停止接续。'});
 if(type==='check')return transfer(true);
 if(type==='start'){
  const s=await read();if(s.phase!=='ready'||!s.code)return s;
  if(!await chrome.permissions.contains({origins:['https://*.pinterest.com/*']}))return {...s,message:'需要先授权 Pinterest。'};
  await save({...s,phase:'waiting',message:'在 Pinterest 完成登录即可，关闭气泡也会继续等待。'});
  const result=await transfer();if(result.phase==='waiting')await chrome.tabs.create({url:'https://www.pinterest.com/login/'});
  return result;
 }
 return read();
}
chrome.runtime.onMessage.addListener((m,s,reply)=>{
 if(s.id!==chrome.runtime.id||!s.url)return false;
 const url=new URL(s.url);if(url.origin!==new URL(chrome.runtime.getURL('connect.html')).origin||url.pathname!=='/connect.html')return false;
 if(m.type==='open-popup'){
  // Closing the launcher after opening a popup immediately dismisses it.
  reply({ok:true});
  void (async()=>{
   if(s.tab?.id!==undefined)await chrome.tabs.remove(s.tab.id);
   try{await chrome.action.openPopup();}
   catch{await chrome.tabs.create({url:chrome.runtime.getURL('connect.html')});}
  })();
 }else void serial(()=>handle(m.type)).then(v=>reply({phase:v.phase,message:v.message})).catch(()=>reply({phase:'error',message:'连接器暂不可用，请重试。'}));
 return true;
});
// Top-level listener survives popup closure and wakes a suspended worker.
chrome.cookies.onChanged.addListener(i=>{if(domains.includes(i.cookie.domain))void serial(()=>transfer());});
export {};
