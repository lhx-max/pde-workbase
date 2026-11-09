/** Read-only device-flow proof. Never dispatches or retries a generation. */
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import path from 'node:path';
import { AppwriteClient } from '../apps/server/src/storage/appwrite-client.js';
import { CloudImageFiles } from '../apps/server/src/storage/cloud-image-files.js';
const { values } = parseArgs({ options: { 'console-prefs': { type: 'string' }, 'output-dir': { type: 'string' }, 'adapter-token-file': { type: 'string' } } });
for (const field of ['console-prefs','output-dir','adapter-token-file'] as const) if (!values[field] || !path.isAbsolute(values[field]!)) throw Error(`Pass absolute --${field}`);
const prefs=JSON.parse(await readFile(values['console-prefs']!,'utf8'));
const raw=/a_session_console=([^;,\s]+)/u.exec(prefs[prefs.current].cookie)?.[1];if(!raw)throw Error('Missing maintenance session');
const client=new AppwriteClient({endpoint:'https://frontend-cloud.corp.kuaishou.com/v1',projectId:'grworkspace',sessionCookie:`a_session_console=${raw}`,sessionMode:'admin'});
const files=new CloudImageFiles(client,'canvas_app_dev','canvas_assets_v2');
const project='image-device-proof-20261021';
const state=await client.call<{state:string}>('GET',`${client.docsPath('canvas_app_dev','canvases')}/${project}`);
const canonical=JSON.parse(state.state) as {workbenchImages?:Array<{id:string;path:string;status:string}>;workbenchImageTasks?:Record<string,{status:string}>};
const original=JSON.parse(await readFile(path.join(values['output-dir']!,'gpt-readback.json'),'utf8')) as {sha256:string;taskId:string;path:string;originalDelivery:unknown};
const tasks=await(await fetch(`http://127.0.0.1:17462/api/projects/${project}/media/tasks?includeDone=1`)).json() as {tasks:Array<{taskId:string;model:string;status:string;file?:{name:string};canvasDelivery?:{status:string}}>};
const gemini=tasks.tasks.find(t=>t.model==='designai-gemini-image'&&t.status==='done'&&t.canvasDelivery?.status==='delivered');
if(!gemini?.file||canonical.workbenchImageTasks?.[gemini.taskId]?.status!=='done')throw Error('Gemini full canvas delivery not complete');
const gptNode=canonical.workbenchImages?.find(n=>n.id==='device-gpt-result'&&n.status==='ready');
if(!gptNode)throw Error('Retained GPT card missing');
const checks=[];
for (const item of [{model:'designai-gpt-image-2',taskId:original.taskId,path:gptNode.path},{model:'designai-gemini-image',taskId:gemini.taskId,path:gemini.file.name}]) {
 const stored=await files.read(project,item.path);if(!stored)throw Error('Cloud bytes missing');
 const node=canonical.workbenchImages?.find(n=>n.path===item.path&&n.status==='ready');if(!node)throw Error('Canonical canvas image missing');
 const preview=await fetch(`http://127.0.0.1:17462/api/projects/${project}/files/${item.path}`);
 const previewBytes=Buffer.from(await preview.arrayBuffer());
 const sha256=createHash('sha256').update(stored.buffer).digest('hex');
 if(!preview.ok||createHash('sha256').update(previewBytes).digest('hex')!==sha256)throw Error('Preview differs from cloud image');
 if(item.model==='designai-gpt-image-2') {
  const source=await files.read(project,original.path);if(!source||createHash('sha256').update(source.buffer).digest('hex')!==original.sha256)throw Error('Original GPT bytes changed');
  // image.attach performs the existing rotation/PNG normalization, without model inference.
  const sharp=createRequire(new URL('../apps/server/package.json',import.meta.url))('sharp') as (input:Uint8Array)=>{rotate():{png():{toBuffer():Promise<Buffer>}}};
  const normalized=await sharp(source.buffer).rotate().png().toBuffer();
  if(createHash('sha256').update(normalized).digest('hex')!==sha256)throw Error('Canonical GPT differs from expected image.attach normalization');
 }
 checks.push({...item,nodeId:node.id,bytes:stored.buffer.length,width:stored.buffer.readUInt32BE(16),height:stored.buffer.readUInt32BE(20),sha256,cloudPreviewMatches:true});
}
const token=(await readFile(values['adapter-token-file']!,'utf8')).trim();
const auth=await(await fetch('http://127.0.0.1:17465/authorization/status',{headers:{authorization:`Bearer ${token}`}})).json() as {state:string;username:string;expiresAt:number};
if(auth.state!=='ready')throw Error('Device authorization not ready');
const report={verifiedAt:new Date().toISOString(),passed:true,projectId:project,authorization:{mode:'local-single-user-device-flow',...auth},checks,originalGptDelivery:original.originalDelivery,note:'GPT source card was concurrently changed; retained the already-generated cloud bytes through image.attach without regeneration. Gemini completed automatic delivery. No MA multi-user or billing acceptance.'};
await writeFile(path.join(values['output-dir']!,'device-flow-readback.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
