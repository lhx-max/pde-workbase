#!/usr/bin/env node
/** Explicit operator command. Plan mode performs no cloud or credential I/O. */
import{parseArgs}from'node:util';import{readFile,writeFile}from'node:fs/promises';import{isAbsolute}from'node:path';
import{createProvisionPlan,provisionPrivateStorage}from'./private-storage.js';import{PRIVATE_STORAGE_SCHEMAS}from'./schemas.js';import{createProvisionClient}from'./http.js';
const{values}=parseArgs({options:{help:{type:'boolean'},app:{type:'string'},database:{type:'string'},bucket:{type:'string'},namespace:{type:'string'},endpoint:{type:'string'},project:{type:'string'},prefs:{type:'string'},output:{type:'string'},inspect:{type:'boolean',default:false},apply:{type:'boolean',default:false}}});
if(values.help){console.log('provision-private-storage --app canvas|doc|sketch|image --database APP_ISOLATED_DB --bucket APP_ISOLATED_BUCKET [--namespace NAME] [--inspect|--apply] [--endpoint HTTPS_V1 --project ID] [--output ABSOLUTE_JSON]\nDefault is a no-I/O plan. Explicit cloud modes require APPWRITE_PROVISION_KEY or APPWRITE_PROVISION_KEY_FILE; non-production local maintenance may instead provide --prefs ABSOLUTE_PATH. Existing ACL/data/schema are never rewritten; only our own acquired writer-lock document may be deleted.');process.exit(0);}
if(!values.app||!values.database||!values.bucket)throw Error('Explicit app, database and bucket identifiers required');if(values.inspect&&values.apply)throw Error('Select inspect or apply, not both');if(values.output&&!isAbsolute(values.output))throw Error('Output must be absolute');
const plan=createProvisionPlan(values.app,values.database,values.bucket,values.namespace);let report:unknown={...plan,mode:'plan',cloudRequests:0,contract:PRIVATE_STORAGE_SCHEMAS[plan.app]};
if(values.inspect||values.apply){
 const endpoint=values.endpoint??process.env.APPWRITE_ENDPOINT,projectId=values.project??process.env.APPWRITE_PROJECT;
 if(!endpoint||!projectId)throw Error('Explicit endpoint and project required for cloud inspection/provisioning');
 const key=process.env.APPWRITE_PROVISION_KEY,file=process.env.APPWRITE_PROVISION_KEY_FILE;if(key&&file||values.prefs&&(key||file))throw Error('Select exactly one provisioning credential source');
 let apiKey=key,consoleCookie:string|undefined;
 if(file){if(!isAbsolute(file))throw Error('Provisioning key file must be absolute');const bytes=await readFile(file);if(bytes.length>16384)throw Error('Provisioning key file is too large');apiKey=bytes.toString('utf8').trim();}
 if(values.prefs){if(process.env.NODE_ENV==='production'||!isAbsolute(values.prefs))throw Error('Maintenance prefs require explicit nonproduction absolute path');try{const p=JSON.parse(await readFile(values.prefs,'utf8'));consoleCookie=p[p.current]?.cookie;}catch{throw Error('Maintenance prefs unavailable or invalid');}}
 const client=createProvisionClient({endpoint,projectId,databaseId:plan.databaseId,bucketId:plan.bucketId,app:plan.app,...(apiKey?{apiKey}:{}),...(consoleCookie?{consoleCookie}:{})});report=await provisionPrivateStorage(client,plan,{apply:values.apply});
}
const output=JSON.stringify(report,null,2)+'\n';if(values.output)await writeFile(values.output,output,{mode:0o600});console.log(output);
