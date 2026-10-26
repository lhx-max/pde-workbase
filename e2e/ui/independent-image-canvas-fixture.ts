/** Explicit local UI fixture: installed public packages + real cloud-backed APIs.
 * Protocol-fixture MA identity stays on this loopback server, never in bundle. */
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {parseArgs} from 'node:util';
import {dirname,isAbsolute,join} from 'node:path';
const{values}=parseArgs({options:{image:{type:'string'},canvas:{type:'string'},consumer:{type:'string'},output:{type:'string'}}});
for(const value of Object.values(values))if(!value||!isAbsolute(value))throw Error('Explicit absolute fixture paths required');
if(!values.image||!values.canvas||!values.consumer||!values.output||process.env.NODE_ENV==='production')throw Error('Explicit nonproduction fixture required');
const image=JSON.parse(await readFile(values.image,'utf8')),canvas=JSON.parse(await readFile(values.canvas,'utf8'));
if(image.profile!=='real-image-cloud-explicit-local-ma-ui-fixture'||canvas.profile!=='real-cloud-reference-fixture'||canvas.workspaceId!==image.workspaceId||canvas.imageOrigin!==image.backend)throw Error('Owned fixture descriptors mismatch');
for(const origin of[image.backend,canvas.url])if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin))throw Error('Only explicit owned loopback backends');
const outDir=dirname(values.output);await mkdir(outDir,{recursive:true});
const require=createRequire(import.meta.url);const esbuild=require(require.resolve('esbuild',{paths:[dirname(require.resolve('tsx/package.json'))]})) as {build:(options:unknown)=>Promise<void>};
const code=`import React from'react';import{createRoot}from'react-dom/client';import{IndependentImageWorkspace,createIndependentImageHttpTransport}from'@ks-designai/image-card-pack/react';import{CanvasWorkbenchSurface}from'@ks-designai/canvas-surface';import'@ks-designai/canvas-surface/styles.css';
const uiHost={renderPopover:p=>React.createElement(React.Fragment,null,p.trigger,p.open?p.children:null),renderHoverCard:p=>p.trigger,renderDialog:p=>p.open?React.createElement('div',{role:'dialog','aria-label':p.ariaLabel},p.children):null,renderMenu:p=>React.createElement(React.Fragment,null,p.trigger,p.open?React.createElement('div',{},p.items.map(i=>React.createElement('button',{key:i.id,disabled:i.disabled,onClick:i.onSelect},i.content))):null),renderTabs:p=>React.createElement('div',{},p.items.map(i=>React.createElement('button',{key:i.value,disabled:i.disabled,onClick:()=>p.onValueChange(i.value)},i.label)))};
const isCanvas=location.pathname==='/canvas-ui';
if(isCanvas)createRoot(document.getElementById('app')).render(React.createElement(CanvasWorkbenchSurface,{projectId:${JSON.stringify(canvas.projectId)},uiHost,transport:{baseUrl:'/canvas',fetch},locale:'zh-CN'}));
else{const transport=createIndependentImageHttpTransport({request:(route,init)=>fetch('/image'+route,init)});createRoot(document.getElementById('app')).render(React.createElement(IndependentImageWorkspace,{workspaceId:${JSON.stringify(image.workspaceId)},transport,onReference:async reference=>{const r=await fetch('/reference',{method:'POST',headers:{'content-type':'application/json','idempotency-key':crypto.randomUUID()},body:JSON.stringify(reference)});if(!r.ok)throw Error('Canvas reference failed '+r.status);document.getElementById('canvas').src='/canvas-ui?revision='+Date.now();document.getElementById('receipt').textContent=JSON.stringify((await r.json()).data);}}));}`;
await esbuild.build({stdin:{contents:code,resolveDir:values.consumer,sourcefile:'combined-installed.tsx',loader:'tsx'},outfile:join(outDir,'bundle.js'),bundle:true,platform:'browser',format:'esm',target:'es2022',define:{'process.env.NODE_ENV':'"development"'}});
await esbuild.build({entryPoints:[join(values.consumer,'node_modules/@ks-designai/image-card-pack/dist/tools/worker.js')],outfile:join(outDir,'worker.js'),bundle:true,platform:'browser',format:'esm',target:'es2022'});
const traces:Array<{method:string;path:string;status:number}>=[];
const server=createServer(async(req,res)=>{try{
 const route=new URL(req.url??'/','http://fixture').pathname;
 if(req.method==='GET'&&(route==='/'||route==='/canvas-ui')){res.setHeader('content-type','text/html');res.end('<!doctype html><html lang="zh-CN"><meta charset="UTF-8"><link rel="stylesheet" href="/bundle.css"><style>html,body{margin:0;height:100%;font:14px system-ui}#app{height:100%;min-height:600px}body.main #app{height:auto;padding:20px}iframe{width:100%;height:650px;border:1px solid #ccc}button,input,select,textarea{font:inherit}textarea{width:90%}button{padding:6px;margin:4px}label{margin:8px}header{display:flex;gap:8px}</style><body class="'+(route==='/'?'main':'canvas')+'"><div id="app"></div>'+(route==='/'?'<p id="receipt" role="status"></p><h2>真实画布 Surface · 云端资源引用</h2><iframe title="画布资源引用" id="canvas" src="/canvas-ui"></iframe>':'')+'<script type="module" src="/bundle.js"></script></html>');return;}
 if(req.method==='GET'&&['/bundle.js','/bundle.css'].includes(route)){res.setHeader('content-type',route.endsWith('.css')?'text/css':'text/javascript');res.end(await readFile(join(outDir,route.slice(1))));return;}
 // The package includes its worker source; no checkout-only runtime resource.
 if(req.method==='GET'&&route==='/worker.js'){res.setHeader('content-type','text/javascript');res.end(await readFile(join(outDir,'worker.js')));return;}
 let body:Buffer|undefined;if(req.method==='POST'||req.method==='PATCH'){const chunks:Buffer[]=[];let size=0;for await(const c of req){size+=c.length;if(size>42*1024*1024)throw Error('Body limit');chunks.push(Buffer.from(c));}body=Buffer.concat(chunks);}
 let upstream:Response;
 if(req.method==='POST'&&route==='/reference'){
  const dto=JSON.parse(body?.toString()??'{}');if(dto.workspaceId!==image.workspaceId||typeof dto.assetId!=='string'||Object.keys(dto).some(k=>!['workspaceId','assetId','mime','sha256','width','height'].includes(k)))throw Error('Invalid reference');
  const current=await fetch(canvas.url+'/api/projects/'+canvas.projectId+'/canvas/state',{headers:canvas.headers}).then(r=>{if(!r.ok)throw Error('Canvas read failed');return r.json();});
  upstream=await fetch(canvas.url+'/api/projects/'+canvas.projectId+'/image-app/references',{method:'POST',headers:{...canvas.headers,'content-type':'application/json','idempotency-key':String(req.headers['idempotency-key']??'')},body:JSON.stringify({applicationInstanceId:canvas.targetApplicationInstanceId,workspaceId:dto.workspaceId,assetId:dto.assetId,x:600,y:80,expectedRevision:current.revision})});
 }else{
  const isImage=route.startsWith('/image/api/apps/image/'),isCanvas=route.startsWith('/canvas/api/');if(!isImage&&!isCanvas){res.writeHead(404);res.end('{}');return;}
  const path=route.slice(isImage?6:7);if(isImage&&path.includes('/instances/')&&!path.startsWith('/api/apps/image/instances/'+image.workspaceId+'/'))throw Error('Foreign workspace');if(isCanvas&&path.startsWith('/api/projects/')&&!path.startsWith('/api/projects/'+canvas.projectId+'/'))throw Error('Foreign project');
  const headers:Record<string,string>={...(isImage?image.headers:canvas.headers)};for(const key of['content-type','idempotency-key'])if(typeof req.headers[key]==='string')headers[key]=req.headers[key];
  upstream=await fetch((isImage?image.backend:canvas.url)+path,{method:req.method,headers,...(body?{body:new Uint8Array(body)}:{}),redirect:'error'});
 }
 traces.push({method:req.method??'GET',path:route,status:upstream.status});res.writeHead(upstream.status,{'content-type':upstream.headers.get('content-type')??'application/json','cache-control':'no-store'});res.end(new Uint8Array(await upstream.arrayBuffer()));
}catch{res.writeHead(503);res.end('{"error":{"code":"COMBINED_FIXTURE_FAILED"}}');}});
await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const url='http://127.0.0.1:'+(server.address() as{port:number}).port;
await writeFile(values.output,JSON.stringify({profile:'installed-surfaces-real-cloud-ma-protocol-fixture',url,pid:process.pid,projectId:canvas.projectId,workspaceId:image.workspaceId,consumer:values.consumer},null,2));console.log(JSON.stringify({url,pid:process.pid}));
for(const signal of['SIGTERM','SIGINT']as const)process.once(signal,()=>{server.close(()=>{void writeFile(values.output!+'.requests.json',JSON.stringify(traces,null,2));});server.closeAllConnections();});
