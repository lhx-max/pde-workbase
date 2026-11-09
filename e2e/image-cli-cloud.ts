/** Explicit maintenance-cloud acceptance. Creates an isolated canvas and at most
 * one real image request; never retries or switches providers automatically. */
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {parseArgs} from 'node:util';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const sharp=createRequire(new URL('../apps/server/package.json',import.meta.url))('sharp') as typeof import('../apps/server/node_modules/sharp');
const {values}=parseArgs({options:{output:{type:'string'},'server-url':{type:'string',default:'http://127.0.0.1:17462'},generate:{type:'boolean',default:false},resume:{type:'string'}}});
if(!values.output||!path.isAbsolute(values.output))throw new Error('Pass an explicit absolute --output folder');
const out=values.output;await mkdir(out,{recursive:true});const run=promisify(execFile);
async function cli(args:string[]){const result=await run(process.execPath,[path.resolve('apps/server/dist/cli.js'),...args,'--server-url',values['server-url']!],{maxBuffer:8*1024*1024});return JSON.parse(result.stdout);}
let seq=values.resume?100:0;
async function call(app:string,action:string,input:unknown,options:{instance?:string;revision?:number;key?:string}={}){
 const file=path.join(out,`input-${++seq}.json`);await writeFile(file,JSON.stringify(input,null,2));
 const args=['apps','call',app,action,'--body-file',file,...(options.instance?['--instance',options.instance]:[]),...(options.revision===undefined?[]:['--expected-revision',String(options.revision)]),...(options.key?['--idempotency-key',options.key]:[])];
 const result=await cli(args);await writeFile(path.join(out,`result-${seq}.json`),JSON.stringify(result,null,2));return result.data;
}
const canvasId=values.resume??`image-cli-${Date.now()}`;
if(values.resume&&!/^image-cli-[0-9]+$/.test(canvasId))throw new Error('Resume requires an explicit image-cli acceptance canvas');
if(!values.resume){
await call('canvas','canvas.create',{instanceId:canvasId,name:'图片 CLI 云端验收'});
}
const state=async()=>(await cli(['apps','state','image','--instance',canvasId])).data;
if(!values.resume){
await call('image','image.create',{canvasId,nodeId:'image-cli-source',x:100,y:100,name:'CLI 生图验收',config:{prompt:'一只狗'}},{revision:(await state()).revision,key:'create-1'});
const revision=(await state()).revision;
const set={prompt:'一只狗',model:'designai-gemini-image',aspect:'4:3',resolution:'4K',count:3,references:[]};
await call('image','image.configure',{nodeId:'image-cli-source',set},{instance:canvasId,revision,key:'configure-1'});
assert.deepEqual((await state()).cards[0].config,set);
const replay=await call('image','image.configure',{nodeId:'image-cli-source',set},{instance:canvasId,revision,key:'configure-1'});assert.equal(replay.replayed,true);
}
const summary:Record<string,unknown>={canvasId,configurationReadback:true,idempotencyReadback:true,realGenerationRequested:values.generate||Boolean(values.resume),resumed:Boolean(values.resume)};
console.log(JSON.stringify(summary));
if(values.generate||values.resume){
 const receipt=values.resume?(await cli(['apps','receipt','image','--instance',canvasId,'--id','generate-1'])).data:await call('image','image.generate',{nodeId:'image-cli-source',set:{model:'designai-gpt-image-2',resolution:'2K',count:1}},{instance:canvasId,revision:(await state()).revision,key:'generate-1'});
 const tasks=receipt.result.taskIds;assert.equal(tasks.length,1);console.log('accepted',tasks[0]);
 const replay=await call('image','image.generate',{nodeId:'image-cli-source',set:{model:'designai-gpt-image-2',resolution:'2K',count:1}},{instance:canvasId,revision:0,key:'generate-1'});assert.deepEqual(replay.result.taskIds,tasks);assert.equal(replay.replayed,true);
 let final=receipt;
 const deadline=Date.now()+12*60*1000;
 while(final.status==='accepted'&&Date.now()<deadline){await new Promise(r=>setTimeout(r,3000));final=(await cli(['apps','receipt','image','--instance',canvasId,'--id','generate-1'])).data;}
 summary.generation=final;await writeFile(path.join(out,'generation-receipt.json'),JSON.stringify(final,null,2));
 if(final.status==='succeeded'){
  const status=await call('image','image.status',{nodeId:'image-cli-source'},{instance:canvasId});
  const output=status.result.outputs.find((v:any)=>v.status==='ready');assert.ok(output?.path);
  const file=path.join(out,'result.png');
  await run(process.execPath,[path.resolve('apps/server/dist/cli.js'),'request','GET',`/api/projects/${canvasId}/files/${output.path}`,'--server-url',values['server-url']!,'--output',file],{maxBuffer:1024*1024});
  const metadata=await sharp(await readFile(file)).metadata();assert.ok(metadata.width&&metadata.height);summary.image={path:output.path,width:metadata.width,height:metadata.height};
 }
}
await writeFile(path.join(out,'summary.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary));
if(values.generate||values.resume)assert.equal((summary.generation as {status:string}).status,'succeeded','Real generation must finish and be delivered to the canvas');
