/** Explicit local MA-props UI acceptance. Installs App-owned factory; auth
 * remains in this loopback protocol fixture, never in the browser bundle. */
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {parseArgs} from 'node:util';
import {dirname,isAbsolute,join} from 'node:path';
const {values}=parseArgs({options:{image:{type:'string'},consumer:{type:'string'},output:{type:'string'}}});
for(const key of ['image','consumer','output'] as const)if(!values[key]||!isAbsolute(values[key]!))throw Error('Explicit absolute fixture paths required');
if(process.env.NODE_ENV==='production')throw Error('Nonproduction protocol fixture only');
const image=JSON.parse(await readFile(values.image!,'utf8'));
if(image.profile!=='real-image-cloud-explicit-local-ma-ui-fixture'||!/^http:\/\/127\.0\.0\.1:\d+$/.test(image.backend))throw Error('An existing owned real-cloud fixture is required');
const out=dirname(values.output!);await mkdir(out,{recursive:true});
const context={applicationId:image.caller.applicationId,applicationVersion:'0.9.1',applicationInstanceId:image.caller.applicationInstanceId,providerInstanceId:image.caller.providerInstanceId,bizId:image.caller.bizId,sessionId:'image-wrapper-acceptance',actor:{tenantId:image.caller.teamId,userId:image.caller.userId},locale:'zh-CN'};
const providerPath='/open-platform/v1/instances/'+encodeURIComponent(context.providerInstanceId);
// Mounting itself is strictly read-only. This explicit fixture preparation
// creates a binding only when missing, using a fixed creation request.
let snapshotResponse=await fetch(image.backend+providerPath,{headers:image.headers});
if(snapshotResponse.status===404){
 const key='image-wrapper-create-20261023';
 const created=await fetch(image.backend+providerPath+'/actions/image.create',{method:'POST',headers:{...image.headers,'content-type':'application/json','idempotency-key':key},body:JSON.stringify({...context,locale:undefined,protocolVersion:'1.0',requestId:key,idempotencyKey:key,actionId:'image.create',input:{name:'MA wrapper acceptance'}})});
 if(!created.ok)throw Error('Fixture binding creation rejected: '+created.status);
 snapshotResponse=await fetch(image.backend+providerPath,{headers:image.headers});
}
if(!snapshotResponse.ok)throw Error('Fixture snapshot rejected: '+snapshotResponse.status);
const snapshot=await snapshotResponse.json() as {content:{workspace:{id:string;revision:number}}};
const workspaceId=snapshot.content.workspace.id;
const statePath='/api/apps/image/instances/'+workspaceId;
const state=await fetch(image.backend+statePath+'/state',{headers:image.headers}).then(async r=>{if(!r.ok)throw Error('Fixture state rejected');return r.json();});
if(!state.data.assets.length){
 // Copy a bounded already-owned raster from the prior test workspace. No
 // model dispatch or Canvas/MA shared-file storage is involved.
 const prior=await fetch(image.backend+'/api/apps/image/instances/'+image.workspaceId+'/state',{headers:image.headers}).then(r=>r.json());
 const source=prior.data.assets.find((a:{mime:string;byteLength:number})=>a.mime==='image/png'&&a.byteLength<=30_000_000);
 if(!source)throw Error('No bounded owned PNG for fixture preparation');
 const bytes=await fetch(image.backend+'/api/apps/image/instances/'+image.workspaceId+'/assets/'+source.id,{headers:image.headers}).then(async r=>{if(!r.ok)throw Error('Source denied');return Buffer.from(await r.arrayBuffer());});
 const imported=await fetch(image.backend+statePath+'/assets',{method:'POST',headers:{...image.headers,'content-type':'application/json','idempotency-key':'image-wrapper-import-20261023'},body:JSON.stringify({input:{path:'originals/wrapper.png',mime:'image/png',role:'original',contentBase64:bytes.toString('base64')},expectedRevision:state.data.workspace.revision})});
 if(!imported.ok)throw Error('Fixture import rejected: '+imported.status);
}
const require=createRequire(import.meta.url);
const esbuild=require(require.resolve('esbuild',{paths:[dirname(require.resolve('tsx/package.json'))]})) as {build:(options:unknown)=>Promise<void>};
const code=`import React from'react';import{createRoot}from'react-dom/client';import{createIndependentImageMaApp,IndependentImageMaApp}from'@ks-designai/image-card-pack/react';
const configured=createIndependentImageMaApp({requestForContext:context=>{let failOnce=context.applicationVersion.endsWith('-stream-test');return(route,init)=>{if(failOnce&&route.includes('/assets/')){failOnce=false;return Promise.resolve(new Response(new ReadableStream({start(controller){controller.error(new Error('PRIVATE_STREAM_MARKER_DO_NOT_DISPLAY'));}}),{headers:{'content-type':'image/png'}}));}return fetch('/image'+route,init);};}});
function App(){const[valid,setValid]=React.useState(true);const[configuredMode,setConfigured]=React.useState(true);const[streamError,setStreamError]=React.useState(false);const Component=configuredMode?configured:IndependentImageMaApp;return React.createElement(React.Fragment,null,React.createElement('header',null,React.createElement('strong',null,'已安装制品 · MA props / 本地认证协议夹具'),React.createElement('button',{onClick:()=>setValid(v=>!v)},valid?'切换缺失上下文':'恢复上下文'),React.createElement('button',{onClick:()=>setConfigured(v=>!v)},configuredMode?'切换未配置组件':'恢复配置组件'),React.createElement('button',{onClick:()=>setStreamError(v=>!v)},streamError?'恢复资源读取':'模拟资源流异常')),React.createElement(Component,{context:valid?{...${JSON.stringify(context)},applicationVersion:streamError?'0.9.1-stream-test':'0.9.1'}:undefined}));}createRoot(document.getElementById('app')).render(React.createElement(App));`;
await esbuild.build({stdin:{contents:code,resolveDir:values.consumer,sourcefile:'installed-image-ma.tsx',loader:'tsx'},outfile:join(out,'bundle.js'),bundle:true,platform:'browser',format:'esm',target:'es2022',define:{'process.env.NODE_ENV':'"development"'}});
await esbuild.build({entryPoints:[join(values.consumer!,'node_modules/@ks-designai/image-card-pack/dist/tools/worker.js')],outfile:join(out,'worker.js'),bundle:true,platform:'browser',format:'esm',target:'es2022'});
const traces:Array<{method:string;path:string;status:number;idempotencyKey?:string;expectedRevision?:number}>=[];
const server=createServer(async(req,res)=>{try{
 const route=new URL(req.url??'/','http://fixture').pathname;
 if(req.method==='GET'&&route==='/'){res.setHeader('content-type','text/html');res.end('<!doctype html><html lang="zh-CN"><meta charset="UTF-8"><style>body{font:14px system-ui;margin:20px}button{margin:4px;padding:6px}header{padding:10px;border-bottom:1px solid #ddd}input,textarea,select{margin:8px;font:inherit}img{max-height:420px;max-width:100%}</style><div id="app"></div><script type="module" src="/bundle.js"></script>');return;}
 if(req.method==='GET'&&['/bundle.js','/worker.js'].includes(route)){res.setHeader('content-type','text/javascript');res.end(await readFile(join(out,route.slice(1))));return;}
 if(req.method==='GET'&&route==='/__proof'){res.setHeader('content-type','application/json');res.end(JSON.stringify({profile:'app-owned-ma-wrapper-real-cloud-local-authority-fixture',traces}));return;}
 const path=route.startsWith('/image/')?route.slice(6):'';
 const allowed=path===providerPath||path==='/api/apps/image/capabilities'||path.startsWith(statePath+'/');
 if(!allowed||!['GET','POST'].includes(req.method??'')){res.writeHead(404);res.end('{}');return;}
 let body:Buffer|undefined;if(req.method==='POST'){const chunks:Buffer[]=[];let size=0;for await(const part of req){size+=part.length;if(size>42*1024*1024)throw Error('Fixture body limit');chunks.push(Buffer.from(part));}body=Buffer.concat(chunks);}
 const headers:Record<string,string>={...image.headers};for(const key of ['content-type','idempotency-key'])if(typeof req.headers[key]==='string')headers[key]=req.headers[key];
 const response=await fetch(image.backend+path,{method:req.method,headers,...(body?{body:new Uint8Array(body)}:{}),redirect:'error'});
 const write=body?JSON.parse(body.toString()) as {expectedRevision?:number}:undefined;
 traces.push({method:req.method??'GET',path,status:response.status,...(typeof req.headers['idempotency-key']==='string'?{idempotencyKey:req.headers['idempotency-key']}:{}),...(typeof write?.expectedRevision==='number'?{expectedRevision:write.expectedRevision}:{})});
 res.writeHead(response.status,{'content-type':response.headers.get('content-type')??'application/json','cache-control':'no-store'});res.end(new Uint8Array(await response.arrayBuffer()));
 }catch{res.writeHead(503);res.end('{"error":{"code":"IMAGE_MA_FIXTURE_UNAVAILABLE"}}');}});
await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
const url='http://127.0.0.1:'+(server.address() as {port:number}).port;
await writeFile(values.output!,JSON.stringify({profile:'app-owned-ma-wrapper-real-cloud-local-authority-fixture',url,pid:process.pid,workspaceId,context,formalMa:false,consumer:values.consumer},null,2));
console.log(JSON.stringify({url,pid:process.pid}));
for(const signal of ['SIGTERM','SIGINT'] as const)process.once(signal,()=>{server.close(()=>{void writeFile(values.output!+'.requests.json',JSON.stringify(traces,null,2));});server.closeAllConnections();});
