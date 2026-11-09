/** Concurrent same-document editors probe. Two Doc + two Sketch installed
 * surfaces against explicit in-memory protocol stubs (scope-keyed, delayed
 * write isolation). Synthetic nonproduction fixture; never real cloud or MA. */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {parseArgs} from 'node:util';
import {dirname,isAbsolute,join} from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
const profile='installed-concurrent-doc-sketch-protocol-stub';
const {values}=parseArgs({options:{consumer:{type:'string'},output:{type:'string'}}});
if(process.env.NODE_ENV==='production'||!values.consumer||!values.output||!isAbsolute(values.consumer)||!isAbsolute(values.output))throw Error('Nonproduction absolute consumer/output required');
const consumer=values.consumer;
const output=values.output;
const versions:Record<string,string>={};
for(const app of ['doc','sketch'])versions[app]=JSON.parse(await readFile(join(consumer,'node_modules/@ks-designai/'+app+'-surface/package.json'),'utf8')).version;
await mkdir(dirname(output),{recursive:true});
await writeFile(join(consumer,'index.html'),'<!doctype html><html lang="en"><meta charset="UTF-8"><title>Installed concurrent Doc/Sketch probe</title><style>body{font:14px system-ui;margin:0;background:#f5f6f8}header{padding:12px 18px;background:#fff;border-bottom:1px solid #ddd}h1{font-size:18px;margin:0 0 6px}p{margin:4px 0}.controls{display:flex;gap:8px;flex-wrap:wrap;margin:8px 0}.controls button{padding:6px 10px}.status{font-weight:600}.slots{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px;padding:12px}.cell{min-width:0;display:flex;flex-direction:column;gap:4px}.cell h2{font-size:13px;margin:0}.slot{height:500px;min-height:0;display:flex;flex-direction:column;overflow:auto;background:#fff;border:1px solid #ddd}pre.fixture-state{margin:0 12px 12px;padding:8px;max-height:240px;overflow:auto;background:#fff;border:1px solid #ddd;font-size:11px}</style><div id="root"></div><script type="module" src="/concurrent-probe.tsx"></script>');
await writeFile(join(consumer,'concurrent-probe.tsx'),`import React from'react';import{createRoot}from'react-dom/client';
import{createDocEditorApp}from'@ks-designai/doc-surface/da';import{DocProviderError}from'@ks-designai/doc-surface/provider';import'@ks-designai/doc-surface/styles.css';
import{createSketchEditorApp}from'@ks-designai/sketch-surface/da';import{SketchProviderError}from'@ks-designai/sketch-surface/provider';import'@ks-designai/sketch-surface/embedded.css';
const h=React.createElement,enc=new TextEncoder();
const sha256=async text=>{const d=await crypto.subtle.digest('SHA-256',enc.encode(text));return Array.from(new Uint8Array(d)).map(b=>b.toString(16).padStart(2,'0')).join('');};
const emit=e=>{void fetch('/__evidence',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(e)});};
const scopeOf=ctx=>[ctx.actor.tenantId,ctx.actor.userId,ctx.applicationId,ctx.applicationVersion,ctx.applicationInstanceId,ctx.providerInstanceId,ctx.bizId].join('|');
const laneOf=ctx=>String(ctx.applicationInstanceId).split('-').pop();
const laneContext=(app,lane)=>Object.freeze({applicationId:app,applicationVersion:'0.1.0',applicationInstanceId:'mai-'+app+'-'+lane,providerInstanceId:'mp-'+app+'-'+lane,bizId:'fixture-biz',sessionId:'fixture-session',actor:Object.freeze({tenantId:'fixture-tenant-'+lane,userId:'fixture-user-'+lane}),locale:'en'});
const cloneContext=ctx=>Object.freeze({...structuredClone(ctx),actor:Object.freeze({...ctx.actor})});
const store=new Map();
const seed=(ctx,content,name)=>{const scope=scopeOf(ctx);const id='fixture-'+scope;store.set(scope,{content,revision:1,updatedAt:new Date().toISOString(),id,name,path:'/fixture/'+ctx.applicationId+'/'+encodeURIComponent(id)+(ctx.applicationId==='doc'?'.md':'.sketch.json')});};
const sketchScene=(shape,seedA,seedB)=>JSON.stringify({type:'excalidraw',version:2,source:'fixture',elements:[{id:'fixture-starter-'+shape,type:shape,x:120,y:120,width:shape==='rectangle'?220:180,height:140,angle:0,strokeColor:'#1e1e1e',backgroundColor:'transparent',fillStyle:'solid',strokeWidth:2,strokeStyle:'solid',roughness:1,opacity:100,groupIds:[],frameId:null,index:'a0',roundness:shape==='rectangle'?{type:3}:{type:2},seed:seedA,version:1,versionNonce:seedB,isDeleted:false,boundElements:null,updated:1,link:null,locked:false}],appState:{},files:{}});
seed(laneContext('doc','A'),'# Document A','Document A');
seed(laneContext('doc','B'),'# Document B','Document B');
seed(laneContext('sketch','A'),sketchScene('rectangle',101,1001),'Sketch A');
seed(laneContext('sketch','B'),sketchScene('ellipse',202,2002),'Sketch B');
let armedScope=null,held=null;
const writeCache=new Map();
const makeProvider=ErrorType=>({async action(ctx,actionId,input,expectedRevision,options){
 const captured=structuredClone(ctx);
 const scope=scopeOf(captured),app=captured.applicationId,slot=app+'-'+laneOf(captured);
 const requestId=options&&options.requestId!=null?String(options.requestId):null;
 const key=options&&options.idempotencyKey!=null?String(options.idempotencyKey):requestId;
 const base={slot,scope,app,action:String(actionId),requestId,key,expectedRevision:expectedRevision===undefined?null:expectedRevision};
 const now=()=>store.has(scope)?store.get(scope).revision:null;
 const reject=(code,status)=>{emit({...base,type:'rejected',currentRevision:now(),contentHash:null,ok:false,code});throw new ErrorType({code,message:'Concurrent fixture stub rejected '+actionId+' ('+code+')',uncertain:false,actionId:String(actionId),requestId:requestId||undefined,idempotencyKey:key||undefined,identity:captured,status});};
 emit({...base,type:'dispatch',currentRevision:now(),contentHash:input&&typeof input.content==='string'?await sha256(input.content):null});
 if(actionId!==app+'.read'&&actionId!==app+'.write')reject('UNSUPPORTED_ACTION',400);
 const entry=store.get(scope);if(!entry)reject('UNKNOWN_SCOPE',404);
 const envelope=hash=>({protocolVersion:'1.0',providerInstanceId:captured.providerInstanceId,actionId:String(actionId),revision:entry.revision,data:{content:entry.content,revision:hash,meta:{id:entry.id,name:entry.name,path:entry.path,size:enc.encode(entry.content).length,updatedAt:entry.updatedAt,providerRevision:entry.revision,revision:hash}}});
 if(actionId===app+'.read'){const hash=await sha256(entry.content);emit({...base,type:'read',expectedRevision:null,currentRevision:entry.revision,contentHash:hash,ok:true});return envelope(hash);}
 if(!input||typeof input.content!=='string')reject('BAD_INPUT',400);
 const content=input.content;
 const cacheKey=key==null?null:JSON.stringify([scope,key]);
 if(cacheKey&&writeCache.has(cacheKey))return writeCache.get(cacheKey);
 const commit=async()=>{
  const current=store.get(scope);
  if(expectedRevision!=null&&expectedRevision!==current.revision)reject('REVISION_CONFLICT',409);
  current.revision+=1;current.content=content;current.updatedAt=new Date().toISOString();
  const hash=await sha256(content);
  emit({...base,type:'commit',currentRevision:current.revision,contentHash:hash,ok:true});
  const result=envelope(hash);
  emit({...base,type:'return',currentRevision:current.revision,contentHash:hash,ok:true});
  return result;
 };
 let promise;
 if(armedScope===scope){armedScope=null;emit({...base,type:'held',currentRevision:entry.revision,contentHash:await sha256(content),ok:true});promise=new Promise((resolve,settle)=>{held={run:()=>commit().then(resolve,settle)};});}
 else promise=commit();
 if(cacheKey)writeCache.set(cacheKey,promise);
 return promise;
}});
const Doc=createDocEditorApp({providerForContext:()=>makeProvider(DocProviderError)});
const Sketch=createSketchEditorApp({providerForContext:()=>makeProvider(SketchProviderError)});
function App(){
 const[docA,setDocA]=React.useState(()=>laneContext('doc','A'));
 const[docB,setDocB]=React.useState(()=>laneContext('doc','B'));
 const[sketchA,setSketchA]=React.useState(()=>laneContext('sketch','A'));
 const[sketchB,setSketchB]=React.useState(()=>laneContext('sketch','B'));
 const[,tick]=React.useState(0);
 React.useEffect(()=>{const i=setInterval(()=>tick(n=>n+1),250);return()=>clearInterval(i);},[]);
 const lane=laneOf(docA);
 const hold=held?'held; waiting for release':(armedScope?'armed for next Document A write':'none');
 const summary=Array.from(store.entries()).map(([scope,e])=>({scope,counter:e.revision,content:e.content}));
 const slot=(label,cls,Comp,ctx)=>h('div',{className:'cell'},h('h2',null,label),h('section',{className:'slot '+cls,style:{height:500,minHeight:0,display:'flex',flexDirection:'column'},role:'region','aria-label':label},h(Comp,{context:ctx})));
 return h(React.Fragment,null,
  h('header',null,
   h('h1',null,'Installed concurrent Doc/Sketch surface probe'),
   h('p',null,'Doc ${versions.doc} / Sketch ${versions.sketch} — Protocol stubs only / no real cloud or MA'),
   h('div',{className:'controls'},
    h('button',{onClick:()=>{armedScope=scopeOf(docA);},disabled:Boolean(held||armedScope)},'Hold next Document A write'),
    h('button',{onClick:()=>{const c=laneContext('doc','C');seed(c,'# Document C','Document C');setDocA(c);},disabled:lane==='C'},'Switch Document A to tenant C'),
    h('button',{onClick:()=>{const pending=held;held=null;if(pending)pending.run();},disabled:!held},'Release held Document A write'),
    h('button',{onClick:()=>{setDocA(cloneContext(docA));setDocB(cloneContext(docB));setSketchA(cloneContext(sketchA));setSketchB(cloneContext(sketchB));}},'Equivalent contexts')),
   h('p',{className:'status'},'Document A lane: '+lane+' (tenant fixture-tenant-'+lane+') · write hold: '+hold)),
  h('main',{className:'slots'},
   slot('Document A','doc-surface-root',Doc,docA),
   slot('Document B','doc-surface-root',Doc,docB),
   slot('Sketch A','sketch-surface-root',Sketch,sketchA),
   slot('Sketch B','sketch-surface-root',Sketch,sketchB)),
  h('pre',{className:'fixture-state','aria-label':'Fixture state'},JSON.stringify(summary,null,2)));
}
createRoot(document.getElementById('root')).render(h(App));`);
const require=createRequire(join(consumer,'package.json'));
const {createServer}=await import(pathToFileURL(require.resolve('vite')).href);
const events:Array<Record<string,unknown>>=[];
let persistQueue=Promise.resolve();
const persist=()=>{const body=JSON.stringify(events,null,2);const next=persistQueue.then(()=>writeFile(output+'.events.json',body));persistQueue=next.catch(()=>{});return next;};
const eventTypes=new Set(['dispatch','read','held','commit','return','rejected']);
const eventFields=new Set(['type','slot','scope','app','action','requestId','key','expectedRevision','currentRevision','contentHash','ok','code']);
const validEvent=(e:unknown):e is Record<string,unknown>=>{
 if(!e||typeof e!=='object'||Array.isArray(e))return false;
 const o=e as Record<string,unknown>;
 for(const k of Object.keys(o))if(!eventFields.has(k))return false;
 if(typeof o.type!=='string'||!eventTypes.has(o.type))return false;
 if(o.app!=='doc'&&o.app!=='sketch')return false;
 for(const k of ['slot','scope','action'])if(typeof o[k]!=='string'||(o[k]as string).length>256)return false;
 for(const k of ['requestId','key','code'])if(o[k]!=null&&(typeof o[k]!=='string'||(o[k]as string).length>128))return false;
 for(const k of ['expectedRevision','currentRevision'])if(o[k]!=null&&!Number.isSafeInteger(o[k]))return false;
 if(o.contentHash!=null&&(typeof o.contentHash!=='string'||!/^[0-9a-f]{64}$/.test(o.contentHash)))return false;
 if(o.ok!=null&&typeof o.ok!=='boolean')return false;
 return true;
};
const server=await createServer({root:consumer,configFile:false,server:{host:'127.0.0.1',port:0,fs:{strict:true,allow:[consumer]}},plugins:[{name:'concurrent-probe-evidence',configureServer(vite:any){
 vite.middlewares.use('/__evidence',async(req:any,res:any)=>{
  if(req.method==='GET'){res.setHeader('content-type','application/json');res.end(JSON.stringify({profile,realCloud:false,formalMa:false,versions,events}));return;}
  if(req.method!=='POST'){res.statusCode=405;res.end();return;}
  let body='';for await(const chunk of req){body+=chunk;if(body.length>4096){res.statusCode=413;res.end();return;}}
  try{const e=JSON.parse(body);if(!validEvent(e))throw Error('bounded events only');events.push(e);await persist();res.statusCode=204;res.end();}catch{if(!res.headersSent){res.statusCode=400;res.end();}}
 });
}}]});
await server.listen();
const url=server.resolvedUrls.local[0];
await persist();
await writeFile(output,JSON.stringify({profile,versions,url,pid:process.pid,realCloud:false,formalMa:false},null,2));
console.log(JSON.stringify({url,pid:process.pid}));
for(const signal of ['SIGTERM','SIGINT']as const)process.once(signal,()=>{void server.close().then(persist);});
