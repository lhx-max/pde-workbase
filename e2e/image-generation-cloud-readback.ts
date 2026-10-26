/** Read-only independent evidence for actual paid generation. Does not submit/retry tasks. */
import { readFile, mkdir, writeFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import path from 'node:path';
const { values } = parseArgs({ options: { 'project-id': { type: 'string' }, 'console-prefs': { type: 'string' }, 'output-dir': { type: 'string' }, 'runtime-cache': { type: 'string' } } });
for (const key of ['console-prefs','output-dir','runtime-cache'] as const) if (!values[key] || !path.isAbsolute(values[key]!)) throw Error(`Pass absolute --${key}`);
if (!values['project-id']) throw Error('Pass --project-id');
const id = values['project-id'], endpoint = 'https://frontend-cloud.corp.kuaishou.com/v1';
const prefs = JSON.parse(await readFile(values['console-prefs']!, 'utf8'));
const credential = /a_session_console=([^;,\s]+)/u.exec(prefs[prefs.current].cookie)?.[1];
if (!credential) throw Error('Maintenance session unavailable');
const headers = { 'x-appwrite-project': 'grworkspace', 'x-appwrite-mode': 'admin', cookie: `a_session_console=${credential}` };
async function cloud(route: string) { const r = await fetch(endpoint+route,{headers}); if(!r.ok)throw Error(`Cloud read returned HTTP ${r.status}`);return r; }
const stored = await (await cloud(`/databases/canvas_app_dev/collections/canvases/documents/${encodeURIComponent(id)}`)).json();
const canonical = JSON.parse(stored.state);
const taskResponse = await fetch(`http://127.0.0.1:17462/api/projects/${encodeURIComponent(id)}/media/tasks?includeDone=1`);
if (!taskResponse.ok) throw Error('Runtime task list unavailable');
const tasks = (await taskResponse.json()).tasks as Array<Record<string, any>>;
const checks: Array<Record<string, unknown>> = [];
for (const model of ['designai-gemini-image','designai-gpt-image-2']) {
  const task=tasks.find(t=>t.model===model && t.status==='done' && t.canvasDelivery?.status==='delivered' && !t.canvasDelivery.error);
  if(!task)throw Error(`No fully delivered ${model} task`);
  const queries = new URLSearchParams();for(const q of [{method:'equal',attribute:'canvasId',values:[id]},{method:'equal',attribute:'path',values:[task.file.name]}])queries.append('queries[]',JSON.stringify(q));
  const rows=await (await cloud(`/databases/canvas_app_dev/collections/canvas_files/documents?${queries}`)).json();
  if(rows.documents.length!==1)throw Error('Cloud file index is missing or ambiguous');
  const row=rows.documents[0];
  const bytes=Buffer.from(await (await cloud(`/storage/buckets/canvas_assets_v2/files/${encodeURIComponent(row.fileId)}/download`)).arrayBuffer());
  const digest=createHash('sha256').update(bytes).digest('hex');
  if(bytes.length!==row.size || digest!==row.sha256 || bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw Error('Cloud PNG bytes do not match their index');
  const preview=await fetch(`http://127.0.0.1:17462/api/projects/${encodeURIComponent(id)}/files/${task.file.name.split('/').map(encodeURIComponent).join('/')}`);
  const rendered=Buffer.from(await preview.arrayBuffer());
  if(!preview.ok || createHash('sha256').update(rendered).digest('hex')!==digest)throw Error('Authorized project preview differs from cloud bytes');
  const node=canonical.workbenchImages?.find((item:Record<string,unknown>)=>item.path===task.file.name);
  if(!node || node.status!=='ready')throw Error('Canonical cloud card does not point to the generated file');
  let localFileExists=false;
  try{await stat(path.join(values['runtime-cache']!,'projects',id,task.file.name));localFileExists=true;}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  if(localFileExists)throw Error('Generated business image unexpectedly exists in the local project directory');
  if(canonical.workbenchImageTasks?.[task.taskId]?.status!=='done')throw Error('Cloud task summary is not durable');
  checks.push({model,taskId:task.taskId,elapsedSeconds:task.elapsed,bytes:bytes.length,sha256:digest,width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20),fileId:row.fileId,nodeId:node.id,localFileExists,cloudPreviewMatches:true,cloudTaskSummary:true});
}
const report={verifiedAt:new Date().toISOString(),passed:true,projectId:id,revision:stored.revision,storage:'Appwrite grworkspace/canvas_app_dev + canvas_assets_v2',execution:'Local capability service and full Web UI; current-user SSO; explicit console-maintainer cloud storage session. Not staging or MA multi-user acceptance.',checks,priorFailedDelivery:tasks.filter(t=>t.canvasDelivery?.error).map(t=>({taskId:t.taskId,error:t.canvasDelivery.error}))};
await mkdir(values['output-dir']!,{recursive:true});await writeFile(path.join(values['output-dir']!,'cloud-readback.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
