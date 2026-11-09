/** Explicit service-only runtime schema. Never changes existing business ACLs. */
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {parseArgs} from 'node:util';
import path from 'node:path';
import {AppwriteJsonState} from '../packages/app-cloud-state/src/index.js';
import {AppwriteClient,appwriteEnc as enc} from '../apps/server/src/storage/appwrite-client.js';
const {values}=parseArgs({options:{prefs:{type:'string'},database:{type:'string'},collection:{type:'string',default:'app_runtime_state'},output:{type:'string'},namespace:{type:'string'},apply:{type:'boolean',default:false}}});
if(!values.database||!values.output||!path.isAbsolute(values.output))throw Error('Explicit database and absolute output required');
if(!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,35}$/.test(values.collection!))throw Error('Invalid collection ID');
if(values.prefs&&!path.isAbsolute(values.prefs))throw Error('prefs must be absolute');
const credentials=values.prefs?await(async()=>{const p=JSON.parse(await readFile(values.prefs!,'utf8'));return{endpoint:'https://frontend-cloud.corp.kuaishou.com/v1',projectId:'grworkspace',sessionCookie:p[p.current]?.cookie,sessionMode:'admin' as const};})():{endpoint:process.env.APPWRITE_ENDPOINT!,projectId:process.env.APPWRITE_PROJECT!,apiKey:process.env.APPWRITE_API_KEY!};
const client=new AppwriteClient(credentials);const collection=`/databases/${enc(values.database)}/collections/${enc(values.collection!)}`;
const fields=[['namespace',240],['slot',240],['payload',1048576],['updatedAt',64]] as const;
const inspect=async()=>client.getOrNull<{documentSecurity:boolean;$permissions:string[];attributes:Array<{key:string;type:string;size?:number;status:string}>}>(collection);
let current=await inspect();
if(current&&(!current.documentSecurity||current.$permissions.length))throw Error('Existing runtime collection is not service-only; no automatic ACL changes');
if(values.apply){
 if(!current)await client.call('POST',`/databases/${enc(values.database)}/collections`,{collectionId:values.collection,name:'App durable runtime state',permissions:[],documentSecurity:true});
 current=await inspect();
 for(const [key,size] of fields){
  const existing=current?.attributes.find(a=>a.key===key);
  if(existing&&(existing.type!=='string'||existing.size!==size))throw Error(`Existing ${key} schema differs`);
  if(!existing)await client.call('POST',collection+'/attributes/string',{key,size,required:true});
 }
 if(!current?.attributes.some(a=>a.key==='revision'))await client.call('POST',collection+'/attributes/integer',{key:'revision',required:true,min:0});
 const indexPath=collection+'/indexes/runtime_namespace';
 if(!await client.getOrNull(indexPath))await client.call('POST',collection+'/indexes',{key:'runtime_namespace',type:'key',attributes:['namespace'],orders:['ASC']});
 for(let attempt=0;attempt<30;attempt++){
  current=await inspect();if(current?.attributes.some(a=>a.status==='failed'))throw Error('Runtime schema creation failed');
  if([...fields.map(([key])=>key),'revision'].every(key=>current?.attributes.some(a=>a.key===key&&a.status==='available')))break;
  await new Promise(resolve=>setTimeout(resolve,500));
 }
}
current=await inspect();
const ready=Boolean(current&&[...fields.map(([key])=>key),'revision'].every(key=>current?.attributes.some(a=>a.key===key&&a.status==='available')));
if(values.namespace){
 if(!values.apply||!ready)throw Error('Namespace bootstrap requires --apply and available schema');
 const state=new AppwriteJsonState({client,databaseId:values.database,collectionId:values.collection!,namespace:values.namespace,singleWriter:true,initialize:true});await state.ready;await state.flush();
}
const report={namespace:values.namespace??null,verifiedAt:new Date().toISOString(),database:values.database,collection:values.collection,applied:values.apply,ready,serviceOnly:Boolean(current?.documentSecurity&&!current.$permissions.length),fields:current?.attributes.map(a=>({key:a.key,type:a.type,size:a.size,status:a.status}))??[]};
await mkdir(path.dirname(values.output),{recursive:true});await writeFile(values.output,JSON.stringify(report,null,2));console.log(JSON.stringify(report));if(values.apply&&!ready)process.exitCode=1;
