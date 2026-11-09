/** CLI smoke on the isolated UI fixture; CPU-only, no inference. */
import {execFile} from 'node:child_process';import {promisify} from 'node:util';import {readFile,writeFile} from 'node:fs/promises';import path from 'node:path';import {createRequire} from 'node:module';
const run=promisify(execFile),out=path.resolve('docs/verification/image-mvp-api-20261022');
const fixture=JSON.parse(await readFile(path.join(out,'ui-fixture.json'),'utf8')),projectId=fixture.projectId;
if(!/^image-mvp-ui-[0-9]+$/.test(projectId))throw Error('Only the explicit proof canvas is allowed');
const sharp=createRequire(new URL('../apps/server/package.json',import.meta.url))('sharp') as typeof import('sharp').default;
async function cli(args:string[]){const r=await run(process.execPath,[path.resolve('packages/canvas-cli/dist/index.js'),...args],{env:{...process.env,CANVAS_SERVER_URL:'http://127.0.0.1:17462'},maxBuffer:8*1024*1024});return JSON.parse(r.stdout);}
const state=async()=>(await cli(['apps','state','image','--instance',projectId])).data;
async function call(action:string,input:unknown,key?:string){const file=path.join(out,`cli-${action}-${key??'read'}.json`);await writeFile(file,JSON.stringify(input));const revision=(await state()).revision;return(await cli(['apps','call','image',action,'--instance',projectId,'--body-file',file,...(key?['--idempotency-key',key,'--expected-revision',String(revision)]:[])])).data;}
const read=await call('image.edit.read',{nodeId:'source'});const doc=read.result.document;doc.layers[0].opacity=.9;
await call('image.edit.save',{nodeId:'source',document:doc,expectedEditRevision:read.result.editRevision},`cli-edit-proof-${Date.now()}`);
const archive=(await cli(['apps','receipt','image','--instance',projectId,'--id','seed-edit'])).data;if(archive.status!=='succeeded')throw Error('Seed receipt was not archived durably');
const input={nodeId:'source',kind:'crop',params:{x:0,y:0,width:160,height:120}};
let receipt=await call('image.tool',input,'cli-crop-proof');const deadline=Date.now()+60000;
while(receipt.status==='accepted'&&Date.now()<deadline){await new Promise(r=>setTimeout(r,500));receipt=(await cli(['apps','receipt','image','--instance',projectId,'--id','cli-crop-proof'])).data;}
if(receipt.status!=='succeeded')throw Error(JSON.stringify(receipt));
const replay=await call('image.tool',input,'cli-crop-proof');if(!replay.replayed)throw Error('CLI replay failed');
const status=(await call('image.status',{nodeId:'source'})).result;const output=status.outputs.find((v:{taskId:string})=>v.taskId===receipt.result.taskIds[0]);
const target=path.join(out,`cli-crop-${Date.now()}.png`);await cli(['request','GET',`/api/projects/${projectId}/files/${output.path}`,'--output',target]);const metadata=await sharp(await readFile(target)).metadata();if(metadata.width!==160||metadata.height!==120)throw Error('Wrong CLI crop dimensions');
const report={projectId,editRead:true,editSave:true,archivedReceiptRead:true,cropTask:receipt.result.taskIds[0],crop:{width:metadata.width,height:metadata.height},replay:true,inferenceCalls:0};await writeFile(path.join(out,'cli-smoke.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
