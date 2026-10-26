/** Isolated HTTP target for an actual Agent/installed-CLI acceptance run.
 * No model, cloud credential, user workspace or MA production identity is used.
 */
import {createServer} from 'node:http';
import {mkdir,writeFile,appendFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import {parseArgs} from 'node:util';
import {randomUUID} from 'node:crypto';

const {values}=parseArgs({options:{'local-test':{type:'boolean'},'data-dir':{type:'string'},reopen:{type:'boolean'}}});
if(!values['local-test']||process.env.NODE_ENV==='production')throw Error('Explicit non-production --local-test required');
const root=values['data-dir'];
if(!root||!path.isAbsolute(root))throw Error('Absolute --data-dir required');
await mkdir(root,{recursive:true});
let previous:{runId:string;instanceId:string}|undefined;
try{previous=JSON.parse(await readFile(path.join(root,'fixture.json'),'utf8'));}
catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
if(values.reopen){
  if(!previous||!/^[a-f0-9-]{36}$/.test(previous.runId)||!/^agent-[a-f0-9]{8}$/.test(previous.instanceId))throw Error('--reopen requires a valid existing fixture');
}else if(previous)throw Error('Existing fixture: pass --reopen or use a new isolated directory');
for(const key of Object.keys(process.env))if(/^(APPWRITE_|MAV_|CANVAS_AUTH_TOKEN$|TEAM_PERMISSIONS_URL$)/.test(key))delete process.env[key];
const {createCanvasServer}=await import('../apps/server/src/server.js');
const canvas=createCanvasServer({dataRoot:path.join(root,'data'),host:'127.0.0.1',providerLocalDevelopment:true});
await canvas.ready;
const runId=previous?.runId??randomUUID(),instanceId=previous?.instanceId??`agent-${runId.slice(0,8)}`;
let journal=Promise.resolve();
const server=createServer((req,res)=>{
  res.once('finish',()=>{
    // Do not consume request bytes before Express's asynchronous auth/parser.
    // Inputs are retained by the Agent separately; no headers are recorded.
    const entry={runId,at:new Date().toISOString(),method:req.method,path:req.url,status:res.statusCode};
    journal=journal.then(()=>appendFile(path.join(root,'http.jsonl'),JSON.stringify(entry)+'\n'));
  });
  canvas.app(req,res);
});
await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>resolve());});
const url=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
const context={'x-team-id':'agent-fixture','x-user-id':'agent-writer'};
const response=values.reopen
  ?await fetch(url+`/api/apps/canvas/instances/${instanceId}/state`,{headers:context})
  :await fetch(url+'/api/apps/canvas/actions/canvas.create',{method:'POST',headers:{...context,'content-type':'application/json','idempotency-key':runId},body:JSON.stringify({input:{instanceId,name:'Agent CLI isolated acceptance'}})});
if(!response.ok){const error=await response.text();await new Promise<void>(resolve=>server.close(()=>resolve()));await canvas.close();await journal;throw Error(`Fixture seed failed: HTTP ${response.status} ${error}`);}
const fixture={mode:'explicit-local-test',cloud:false,maIdentity:false,models:false,runId,instanceId,url,teamId:'agent-fixture',userId:'agent-writer'};
await writeFile(path.join(root,'fixture.json'),JSON.stringify(fixture,null,2)+'\n');
console.log(JSON.stringify(fixture));
let closing=false;
for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,async()=>{
  if(closing)return;closing=true;
  await new Promise<void>(resolve=>{server.close(()=>resolve());server.closeIdleConnections();});
  await canvas.close();await journal;process.exit(0);
});
