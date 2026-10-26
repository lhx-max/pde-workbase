/** Read-only production storage preflight against explicitly named development stores. */
import{readFile,writeFile}from'node:fs/promises';
import path from'node:path';
import{parseArgs}from'node:util';
import{AppwriteClient}from'../apps/server/src/storage/appwrite-client.js';
import{assertPrivateAppwriteStorage}from'../packages/app-cloud-state/src/index.js';
const{values}=parseArgs({options:{prefs:{type:'string'},output:{type:'string'}}});
if(!values.prefs||!values.output||![values.prefs,values.output].every(path.isAbsolute))throw Error('Absolute prefs and output paths required');
const p=JSON.parse(await readFile(values.prefs,'utf8'));
const client=new AppwriteClient({endpoint:'https://frontend-cloud.corp.kuaishou.com/v1',projectId:'grworkspace',sessionCookie:p[p.current].cookie,sessionMode:'admin'});
const apps=[{app:'canvas',databaseId:'canvas_app_dev',bucketId:'canvas_assets_v2',collectionIds:['canvases','canvas_files','canvas_operations','apps','card_packs','card_grants','app_runtime_state']},{app:'doc',databaseId:'doc_app_dev',bucketId:'doc_assets_v2',collectionIds:['documents','app_runtime_state']},{app:'sketch',databaseId:'sketch_app_dev',bucketId:'sketch_assets_v2',collectionIds:['sketches','app_runtime_state']}];
const checks=[];
for(const app of apps){try{await assertPrivateAppwriteStorage({client,...app});checks.push({app:app.app,preflight:'accepted-private-storage'});}catch(error){const code=(error as{code?:string}).code;if(code!=='CLOUD_STORAGE_NOT_PRIVATE')throw error;checks.push({app:app.app,preflight:'rejected-nonprivate-development-storage',code});}}
await writeFile(values.output,JSON.stringify({checkedAt:new Date().toISOString(),passed:true,mode:'read-only metadata preflight; no ACL or data changes; no production identity/deployment claim',checks},null,2)+'\n');console.log(JSON.stringify({passed:true,checks:checks.length}));
