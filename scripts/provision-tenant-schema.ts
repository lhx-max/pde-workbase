/** Additive schema only; existing rows and ACLs are not reassigned. */
import {execFile} from 'node:child_process';
import {promisify,parseArgs} from 'node:util';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
const exec=promisify(execFile);
const {values}=parseArgs({options:{cli:{type:'string'},'config-dir':{type:'string'},'output-dir':{type:'string'},apply:{type:'boolean',default:false}}});
for(const key of ['cli','config-dir','output-dir'] as const)if(!values[key]||!path.isAbsolute(values[key]!))throw Error(`${key} must be absolute`);
const config=JSON.parse(await readFile(path.join(values['config-dir']!,'appwrite-cf.config.json'),'utf8'));
if(config.projectId!=='grworkspace')throw Error('Only the development project is supported');
async function call(args:string[]):Promise<Record<string,any>>{
 const {stdout}=await exec(process.execPath,['--import','data:text/javascript,BigInt.prototype.toJSON=function(){return%20String(this)}',values.cli!,...args,'--json'],{cwd:values['config-dir'],timeout:30000,maxBuffer:2*1024*1024});
 return JSON.parse(stdout.slice(stdout.indexOf('{')));
}
const definitions=[{database:'canvas_app_dev',collection:'canvases',fields:{teamId:200,createdBy:200,assetMetadata:16777215}},{database:'doc_app_dev',collection:'documents',fields:{teamId:200,bizId:200,createdBy:200,nodeId:200,mirrorCanvasId:200,mirrorPath:2000,archivedAt:200}}];
await mkdir(values['output-dir']!,{recursive:true});
const before=[];
for(const spec of definitions)before.push(await call(['databases','get-collection','--database-id',spec.database,'--collection-id',spec.collection]));
await writeFile(path.join(values['output-dir']!,'schema-before.json'),JSON.stringify(before,null,2));
if(values.apply){
 for(let i=0;i<definitions.length;i++){
  const spec=definitions[i]!;const attributes=before[i]!.attributes as Array<{key:string;type:string;size:number}>;
  for(const [key,size] of Object.entries(spec.fields)){
   const attr=attributes.find(attr=>attr.key===key);
   if(attr){if(attr.type!=='string'||attr.size<size)throw Error(`Incompatible existing attribute ${key}`);continue;}
   await call(['databases','create-string-attribute','--database-id',spec.database,'--collection-id',spec.collection,'--key',key,'--size',String(size),'--required','false']);
  }
 }
}
const after=[];
for(const spec of definitions){
 let ready=false;
 for(let attempt=0;attempt<20;attempt++){
  const row=await call(['databases','get-collection','--database-id',spec.database,'--collection-id',spec.collection]);
  ready=Object.keys(spec.fields).every(key=>row.attributes.some((attribute:{key:string;status:string})=>attribute.key===key&&attribute.status==='available'));
  if(ready||!values.apply){after.push(row);break;}
  await new Promise(resolve=>setTimeout(resolve,500));
 }
 if(values.apply&&!ready)throw Error('Schema provisioning has not become available');
}
await writeFile(path.join(values['output-dir']!,'schema-after.json'),JSON.stringify(after,null,2));
console.log(JSON.stringify({applied:values.apply,collections:after.map(row=>({id:row.$id,fields:row.attributes.map((a:{key:string})=>a.key)}))}));
