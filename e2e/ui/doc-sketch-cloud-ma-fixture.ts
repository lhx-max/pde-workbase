/** Explicit local review bridge. Installed UI -> actual owned test services;
 * synthetic MA authority only. Never a production BFF or a tool bridge. */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {parseArgs} from 'node:util';
import {dirname,isAbsolute,join} from 'node:path';
import {pathToFileURL} from 'node:url';
const {values}=parseArgs({options:{handoff:{type:'string'},consumer:{type:'string'},output:{type:'string'},'drop-doc-write-once':{type:'boolean',default:false}}});
for(const key of ['handoff','consumer','output']as const)if(!values[key]||!isAbsolute(values[key]!))throw Error('Explicit absolute review paths required');
if(process.env.NODE_ENV==='production')throw Error('This synthetic authority bridge is nonproduction only');
const h=JSON.parse(await readFile(values.handoff!,'utf8'));
if(!['root-ui-real-cloud-local-ma-fixture','external-agent-cli-real-cloud-local-ma-fixture'].includes(h.profile)||h.realCloud!==true||h.formalMa!==false||!/^fixture-team-[a-f0-9]{8}$/.test(h.actor?.teamId??'')||h.actor?.userId!=='fixture-agent'||!isAbsolute(h.credentialFile??''))throw Error('An explicit owned-cloud synthetic review identity is required');
const apps=['doc','sketch']as const;type App=typeof apps[number];
const contexts={}as Record<App,Record<string,unknown>>,sourceIds={}as Record<App,string>,origins={}as Record<App,string>,versions={}as Record<App,string>;
for(const app of apps){
 const url=new URL(h.endpoints?.[app]??'');if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||!url.port||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw Error('Exact owned loopback service endpoint required');
 const life=h.businessProof?.lifecycle?.[app],pid=life?.sourceState?.meta?.maProviderInstanceId;
 if(h.maApplicationInstances?.[app]!=='mai-'+app||typeof life?.sourceId!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(life.sourceId)||pid!=='mp-'+app)throw Error('Verified canonical lifecycle binding is required; no implicit creation');
 origins[app]=url.origin;sourceIds[app]=life.sourceId;
 contexts[app]={applicationId:app,applicationVersion:'0.1.0',applicationInstanceId:h.maApplicationInstances[app],providerInstanceId:pid,bizId:'fixture-biz',sessionId:'cloud-ui-review',actor:{tenantId:h.actor.teamId,userId:h.actor.userId},locale:'zh-CN'};
 versions[app]=JSON.parse(await readFile(join(values.consumer!,'node_modules/@ks-designai/'+app+'-surface/package.json'),'utf8')).version;
}
const synthetic=(await readFile(h.credentialFile,'utf8')).trim();if(!/^Bearer fixture-agent-[a-f0-9-]{36}$/.test(synthetic))throw Error('Only a single-run synthetic fixture credential is accepted');
await mkdir(dirname(values.output!),{recursive:true});
await writeFile(join(values.consumer!,'index.html'),'<!doctype html><html lang="zh-CN"><meta charset="UTF-8"><title>Doc / Sketch private-cloud review</title><style>body{font:14px system-ui;margin:0;background:#f5f6f8}header{padding:12px 18px;background:white;border-bottom:1px solid #ddd}main{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px;padding:12px}main>section{min-width:0;height:700px;background:white;border:1px solid #ddd;overflow:auto}h1{font-size:18px;margin:0 0 6px}p{margin:4px 0}@media(max-width:700px){main{grid-template-columns:1fr}}</style><div id="root"></div><script type="module" src="/cloud-review.tsx"></script>');
const code=`import React from'react';import{createRoot}from'react-dom/client';
import{createDocEditorApp}from'@ks-designai/doc-surface/da';import{DocProviderError}from'@ks-designai/doc-surface/provider';import'@ks-designai/doc-surface/styles.css';
import{createSketchEditorApp}from'@ks-designai/sketch-surface/da';import{SketchProviderError}from'@ks-designai/sketch-surface/provider';import'@ks-designai/sketch-surface/embedded.css';
const contexts=${JSON.stringify(contexts)};
const makeProvider=(app,ErrorType)=>({async action(ctx,actionId,input,expectedRevision,options){const requestId=options?.requestId??crypto.randomUUID();const key=options?.idempotencyKey??requestId;const failure=(code,status,uncertain)=>new ErrorType({code,message:app+' request failed; inspect or retry the original operation',uncertain,actionId,requestId,idempotencyKey:key,identity:ctx,status});let response;try{response=await fetch('/fixture-provider/'+app+'/actions/'+actionId,{method:'POST',headers:{'content-type':'application/json','idempotency-key':key},body:JSON.stringify({protocolVersion:'1.0',requestId,idempotencyKey:key,applicationId:ctx.applicationId,applicationVersion:ctx.applicationVersion,applicationInstanceId:ctx.applicationInstanceId,providerInstanceId:ctx.providerInstanceId,bizId:ctx.bizId,sessionId:ctx.sessionId,actor:{userId:ctx.actor.userId,tenantId:ctx.actor.tenantId},actionId,input,...(expectedRevision===undefined?{}:{expectedRevision})})});}catch{throw failure('PROVIDER_NETWORK_UNCERTAIN',undefined,true);}let result;try{result=await response.json();}catch{throw failure('PROVIDER_RESPONSE_UNCERTAIN',response.status,true);}if(!response.ok)throw failure('PROVIDER_HTTP_'+response.status,response.status,response.status>=500||response.status===408);if(result.protocolVersion!=='1.0'||result.providerInstanceId!==ctx.providerInstanceId||result.actionId!==actionId||!Number.isSafeInteger(result.revision)||result.revision<1)throw failure('PROVIDER_RESPONSE_UNCERTAIN',response.status,true);return result;}});
const Doc=createDocEditorApp({providerForContext:()=>makeProvider('doc',DocProviderError)}),Sketch=createSketchEditorApp({providerForContext:()=>makeProvider('sketch',SketchProviderError)});
function App(){return React.createElement(React.Fragment,null,React.createElement('header',null,React.createElement('h1',null,'文档 / 草图 · 真实私有云联调'),React.createElement('p',null,'Appwrite 真实私有存储；MA 为本地协议夹具，非正式 MA 接入。'),React.createElement('p',null,'Doc ${versions.doc} / Sketch ${versions.sketch} · 首次文档写入响应丢失测试：${values['drop-doc-write-once']?'开启':'关闭'}'),React.createElement('p',null,'仅编辑本轮隔离测试实例，不创建或归档其他资源。')),React.createElement('main',null,React.createElement('section',{className:'doc-surface-root',style:{height:700,minHeight:0,display:'flex',flexDirection:'column'}},React.createElement(Doc,{context:contexts.doc})),React.createElement('section',{className:'sketch-surface-root',style:{height:700,minHeight:0,display:'flex',flexDirection:'column'}},React.createElement(Sketch,{context:contexts.sketch}))));}createRoot(document.getElementById('root')).render(React.createElement(App));`;
await writeFile(join(values.consumer!,'cloud-review.tsx'),code);
const require=createRequire(join(values.consumer!,'package.json'));const {createServer}=await import(pathToFileURL(require.resolve('vite')).href);
const traces:Array<Record<string,unknown>>=[];let lost=false;let publicOrigin='';
const persist=()=>writeFile(values.output!+'.requests.json',JSON.stringify(traces,null,2));
const server=await createServer({root:values.consumer,configFile:false,server:{host:'127.0.0.1',port:0,fs:{strict:true,allow:[values.consumer]}},plugins:[{name:'bounded-owned-review',configureServer(vite:any){
 vite.middlewares.use(async(req:any,res:any,next:()=>void)=>{
  const url=new URL(req.url??'/','http://fixture.invalid');
  if(url.pathname==='/__proof'&&req.method==='GET'){res.setHeader('content-type','application/json');res.end(JSON.stringify({profile:'installed-doc-sketch-real-cloud-local-ma-fixture',realCloud:true,formalMa:false,versions,sourceIds,traces}));return;}
  if(!url.pathname.startsWith('/fixture-provider/')){next();return;}
  try{
   const match=/^\/fixture-provider\/(doc|sketch)\/actions\/((?:doc|sketch)\.(?:read|write))$/.exec(url.pathname);
   if(!match||url.search||req.method!=='POST'){res.statusCode=404;res.end('{}');return;}
   const app=match[1]as App,action=match[2]!;
   if(!action.startsWith(app+'.')||req.headers.origin&&req.headers.origin!==publicOrigin){res.statusCode=403;res.end('{}');return;}
   if(!String(req.headers['content-type']??'').startsWith('application/json')){res.statusCode=415;res.end('{}');return;}
   const key=req.headers['idempotency-key'];if(typeof key!=='string'||!/^[\x21-\x7e]{1,128}$/.test(key)){res.statusCode=400;res.end('{}');return;}
   const chunks:Buffer[]=[];let length=0;for await(const part of req){length+=part.length;if(length>2*1024*1024){res.statusCode=413;res.end('{}');return;}chunks.push(Buffer.from(part));}
   const body=Buffer.concat(chunks);const input=JSON.parse(body.toString('utf8'));const ctx=contexts[app];
   if(input.providerInstanceId!==ctx.providerInstanceId||input.applicationId!==app||input.applicationInstanceId!==ctx.applicationInstanceId||input.actionId!==action||input.actor?.tenantId!==h.actor.teamId||input.actor?.userId!==h.actor.userId||input.idempotencyKey!==key){res.statusCode=403;res.end('{}');return;}
   const target=origins[app]+'/open-platform/v1/instances/'+encodeURIComponent(String(ctx.providerInstanceId))+'/actions/'+encodeURIComponent(action);
   const response=await fetch(target,{method:'POST',headers:{'content-type':'application/json','idempotency-key':key,'x-mav-sso-authorization':synthetic,'x-mav-tenant':h.actor.teamId,'x-mav-application-instance-id':h.maApplicationInstances[app]},body:new Uint8Array(body),redirect:'error',signal:AbortSignal.timeout(20_000)});
   const bytes=new Uint8Array(await response.arrayBuffer());const drop=Boolean(values['drop-doc-write-once']&&!lost&&app==='doc'&&action==='doc.write'&&response.ok);if(drop)lost=true;
   traces.push({app,action,backendStatus:response.status,returnedStatus:drop?503:response.status,responseLost:drop,idempotencyKey:key,expectedRevision:input.expectedRevision,requestSha256:createHash('sha256').update(body).digest('hex'),...(typeof input.input?.content==='string'?{contentSha256:createHash('sha256').update(input.input.content).digest('hex')}:{})});await persist();
   res.setHeader('cache-control','no-store');res.setHeader('content-type','application/json');res.statusCode=drop?503:response.status;res.end(drop?' {"error":{"code":"FIXTURE_POST_COMMIT_RESPONSE_LOST"}}':bytes);
  }catch{if(!res.headersSent&&!res.destroyed){res.statusCode=503;res.setHeader('content-type','application/json');res.end('{"error":{"code":"FIXTURE_REVIEW_UNAVAILABLE"}}');}else res.destroy();}
 });
 }}]});
await server.listen();publicOrigin=new URL(server.resolvedUrls.local[0]).origin;
await writeFile(values.output!,JSON.stringify({profile:'installed-doc-sketch-real-cloud-local-ma-fixture',url:publicOrigin+'/',pid:process.pid,versions,sourceIds,realCloud:true,formalMa:false},null,2));console.log(JSON.stringify({url:publicOrigin+'/',pid:process.pid}));
for(const signal of ['SIGTERM','SIGINT']as const)process.once(signal,()=>{void server.close().then(persist);});
