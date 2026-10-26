import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {parseArgs} from 'node:util';
import path from 'node:path';
import assert from 'node:assert/strict';
import {AppwriteWriterLock,writerLockDocumentId} from '../packages/app-cloud-state/src/index.js';
import {AppwriteClient} from '../apps/server/src/storage/appwrite-client.js';
const {values}=parseArgs({options:{prefs:{type:'string'},output:{type:'string'}}});
if(!values.prefs||!values.output||![values.prefs,values.output].every(path.isAbsolute))throw Error('Absolute prefs/output required');
const prefs=JSON.parse(await readFile(values.prefs,'utf8'));
const client=new AppwriteClient({endpoint:'https://frontend-cloud.corp.kuaishou.com/v1',projectId:'grworkspace',sessionCookie:prefs[prefs.current].cookie,sessionMode:'admin'});
const serviceId=`exclusive-probe-${Date.now()}`;
const options={client,databaseId:'canvas_app_dev',collectionId:'app_runtime_state',serviceId};
const a=new AppwriteWriterLock(options),b=new AppwriteWriterLock(options),c=new AppwriteWriterLock(options);
const checks:string[]=[];let failure:string|undefined,cleaned=false;
try{
 await a.acquire();checks.push('First writer acquires a real cloud lock');
 await assert.rejects(b.acquire(),{code:'CLOUD_WRITER_LOCKED'});checks.push('Second independent writer is refused atomically');
 await b.release();await assert.rejects(new AppwriteWriterLock(options).acquire(),{code:'CLOUD_WRITER_LOCKED'});checks.push('A refused writer cannot release the active owner');
 await a.release();await c.acquire();checks.push('A new writer can acquire only after verified owner release');
 await c.release();await assert.rejects(a.acquire(),{code:'CLOUD_WRITER_RELEASED'});checks.push('Released objects cannot silently reacquire');
}catch(error){failure=error instanceof Error?error.message:String(error);}
finally{
 for(const lock of [a,b,c]){try{await lock.release();}catch{}}
 cleaned=await client.getOrNull(`${client.docsPath(options.databaseId,options.collectionId)}/${writerLockDocumentId(serviceId)}`)===null;
 const report={checkedAt:new Date().toISOString(),passed:!failure&&cleaned,storage:'real private Appwrite collection',serviceId,checks,cleaned,...(failure?{failure}:{})};
 await mkdir(path.dirname(values.output),{recursive:true});await writeFile(values.output,JSON.stringify(report,null,2));console.log(JSON.stringify(report));if(!report.passed)process.exitCode=1;
}
