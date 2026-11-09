/** Real private Appwrite state. Bootstrap and cleanup only a new probe namespace. */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {parseArgs} from 'node:util';
import path from 'node:path';
import assert from 'node:assert/strict';
import {AppwriteJsonState} from '../packages/app-cloud-state/src/index.js';
import {AppwriteClient} from '../apps/server/src/storage/appwrite-client.js';
const {values}=parseArgs({options:{prefs:{type:'string'},output:{type:'string'}}});
if(!values.prefs||!values.output||![values.prefs,values.output].every(path.isAbsolute))throw Error('Absolute prefs/output required');
const prefs=JSON.parse(await readFile(values.prefs,'utf8'));const client=new AppwriteClient({endpoint:'https://frontend-cloud.corp.kuaishou.com/v1',projectId:'grworkspace',sessionCookie:prefs[prefs.current].cookie,sessionMode:'admin'});
const namespace=`state-probe-${Date.now()}`;const options={client,databaseId:'canvas_app_dev',collectionId:'app_runtime_state',namespace,singleWriter:true};
const checks:Array<{name:string;passed:boolean}>=[];const cleanup:Array<{id:string;deleted:boolean}>=[];let failure:string|undefined;
const check=(name:string,run:()=>void)=>{run();checks.push({name,passed:true});};
try{
 const first=new AppwriteJsonState({...options,initialize:true});await first.ready;
 const value={version:1,tenant:'probe-team',pending:[{id:'p-1',status:'pending'}]};first.write('probe',value);value.pending[0]!.status='mutated-after-write';await first.flush();
 const second=new AppwriteJsonState(options);await second.ready;
 check('New instance recovers exact original cloud snapshot',()=>assert.equal((second.read('probe') as typeof value).pending[0]!.status,'pending'));
 const copy=second.read('probe') as typeof value;copy.pending=[];
 check('Reads cannot mutate cloud state by reference',()=>assert.equal((second.read('probe') as typeof value).pending.length,1));
 const missing=new AppwriteJsonState({...options,namespace:namespace+'-missing'});await assert.rejects(missing.ready);checks.push({name:'Missing namespace fails instead of becoming an empty store',passed:true});
 second.write('probe',{version:1,tenant:'probe-team',pending:[]});await second.flush();const third=new AppwriteJsonState(options);await third.ready;
 check('Subsequent revision survives another reconstruction',()=>assert.equal((third.read('probe') as typeof value).pending.length,0));
 const resources=await client.call<{documentSecurity:boolean;$permissions:string[]}>('GET','/databases/canvas_app_dev/collections/app_runtime_state');
 check('Runtime collection has no public or users collection grants',()=>assert.ok(resources.documentSecurity&&resources.$permissions.length===0));
}catch(error){failure=error instanceof Error?error.message:String(error);}
finally{
 const base=client.docsPath(options.databaseId,options.collectionId);
 const rows=await client.call<{documents:Array<{$id:string;namespace:string}>}>('GET',`${base}?${AppwriteClient.query([AppwriteClient.eq('namespace',namespace),AppwriteClient.limit(100)])}`);
 for(const row of rows.documents){assert.equal(row.namespace,namespace);try{await client.call('DELETE',`${base}/${row.$id}`);cleanup.push({id:row.$id,deleted:true});}catch{cleanup.push({id:row.$id,deleted:false});}}
 const report={verifiedAt:new Date().toISOString(),storage:'real Appwrite private runtime collection',namespace,passed:!failure&&cleanup.every(x=>x.deleted),checks,cleanup,...(failure?{failure}:{})};
 await mkdir(path.dirname(values.output),{recursive:true});await writeFile(values.output,JSON.stringify(report,null,2));console.log(JSON.stringify(report));if(!report.passed)process.exitCode=1;
}
