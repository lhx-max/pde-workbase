/** Monotonic provisioning: GET/POST only except release of our own writer lock.
 * Never rewrites existing attributes, indexes, ACLs, bucket policy or user rows. */
import {AppwriteJsonState,AppwriteWriterLock,writerLockDocumentId} from '../../../packages/app-cloud-state/src/index.js';
import {PRIVATE_STORAGE_SCHEMAS,PRIVATE_STORAGE_CONTRACT_VERSION,type AttributeSpec,type CollectionSpec,type IndexSpec} from './schemas.js';
export interface ProvisionClient {
 call<T>(method:string,path:string,body?:unknown):Promise<T>;
 getOrNull<T>(path:string):Promise<T|null>;
 docsPath(databaseId:string,collectionId:string):string;
}
export interface ProvisionPlan {schemaVersion:string;app:string;databaseId:string;bucketId:string;namespace?:string;privateOnly:true}
export function createProvisionPlan(app:string,databaseId:string,bucketId:string,namespace?:string):ProvisionPlan {
 const spec=Object.hasOwn(PRIVATE_STORAGE_SCHEMAS,app)?PRIVATE_STORAGE_SCHEMAS[app]:undefined;if(!spec)throw Error('Choose canvas, doc, sketch or image');
 for(const id of[databaseId,bucketId])if(!new RegExp('^'+app+'_[A-Za-z0-9_.-]{1,29}$').test(id)||id.endsWith('_dev')||id.endsWith('_assets_v2'))throw Error('Explicit app-owned isolated database and bucket IDs required; development resources are forbidden');
 if(databaseId===bucketId)throw Error('Database and bucket identifiers must differ');
 if(spec.runtimeNamespace&&(!namespace||namespace.length>240||!/^[A-Za-z0-9_.:-]+$/.test(namespace)))throw Error('Explicit bounded namespace required for first runtime boot');
 if(!spec.runtimeNamespace&&namespace!==undefined)throw Error('Sketch does not use a JsonState business namespace');
 return{schemaVersion:PRIVATE_STORAGE_CONTRACT_VERSION,app,databaseId,bucketId,...(namespace?{namespace}:{}),privateOnly:true};
}
type RecordValue=Record<string,unknown>;
const row=(v:unknown):RecordValue=>{if(!v||typeof v!=='object'||Array.isArray(v))throw Error('Invalid resource metadata');return v as RecordValue;};
const canonical=(v:unknown):unknown=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>[k,canonical(x)])):v;
const equal=(a:unknown,b:unknown)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
function permissions(v:RecordValue){if(!Array.isArray(v.$permissions)||v.$permissions.length!==0)throw Error('Existing permissions must be explicitly empty; no ACL changes');}
function checkCollection(v:RecordValue,spec:CollectionSpec){permissions(v);if(v.enabled!==true)throw Error('Existing collection is disabled');if(v.documentSecurity!==true)throw Error('Existing collection is not private');
 if(!Array.isArray(v.attributes)||!Array.isArray(v.indexes))throw Error('Collection metadata lacks schema');
 for(const raw of v.attributes){const a=row(raw),want=spec.attributes.find(s=>s.key===a.key);if(want)checkAttribute(a,want);else if(a.required===true)throw Error('Unknown required attribute blocks first-deployment contract');}
 for(const raw of v.indexes){const i=row(raw),want=spec.indexes.find(s=>s.key===i.key);if(want)checkIndex(i,want);else if(i.type==='unique')throw Error('Unknown unique index blocks first-deployment contract');}
}
function checkAttribute(v:RecordValue,spec:AttributeSpec){
 if(v.type!==spec.type||v.required!==spec.required||v.array===true||spec.type==='string'&&v.size!==spec.size||spec.min!==undefined&&v.min!==spec.min||spec.max!==undefined&&v.max!==spec.max)throw Error('Existing attribute differs: '+spec.key);
 if(v.status==='failed'||v.status==='stuck')throw Error('Attribute creation failed: '+spec.key);
}
function checkIndex(v:RecordValue,spec:IndexSpec){
 const orders=Array.isArray(v.orders)&&v.orders.length?v.orders:spec.attributes.map(()=>'ASC');
 if(v.type!==spec.type||!equal(v.attributes,spec.attributes)||!equal(orders,spec.attributes.map(()=>'ASC')))throw Error('Existing index differs: '+spec.key);
 if(v.status==='failed'||v.status==='stuck')throw Error('Index creation failed: '+spec.key);
}
function checkBucket(v:RecordValue,app:string){const spec=PRIVATE_STORAGE_SCHEMAS[app]!;permissions(v);if(v.name!==spec.bucketName||v.fileSecurity!==true||v.maximumFileSize!==spec.maximumFileSize||v.enabled!==true||!equal(v.allowedFileExtensions,[])||v.compression!=='none'||v.encryption!==false||v.antivirus!==false)throw Error('Existing bucket policy or ownership differs; no policy changes');}
function readyCollection(v:RecordValue,spec:CollectionSpec){return spec.attributes.every(s=>(v.attributes as RecordValue[]).some(a=>a.key===s.key&&a.status==='available'))&&spec.indexes.every(s=>(v.indexes as RecordValue[]).some(i=>i.key===s.key&&i.status==='available'));}
export async function provisionPrivateStorage(client:ProvisionClient,plan:ProvisionPlan,options:{apply:boolean;wait?:(ms:number)=>Promise<void>;attempts?:number}={apply:false}){
 // Validate externally supplied plans too; callers cannot bypass the constructor.
 if(typeof options.apply!=='boolean')throw Error('Explicit boolean apply required');const attempts=options.attempts??60;if(!Number.isSafeInteger(attempts)||attempts<1||attempts>120)throw Error('Schema wait must be bounded');
 const expectedPlan=createProvisionPlan(plan.app,plan.databaseId,plan.bucketId,plan.namespace);if(!equal(expectedPlan,plan))throw Error('Provision plan differs from canonical contract');
 const spec=PRIVATE_STORAGE_SCHEMAS[plan.app]!,db='/databases/'+plan.databaseId,bucket='/storage/buckets/'+plan.bucketId;
 const beforeDb=await client.getOrNull<RecordValue>(db),beforeBucket=await client.getOrNull<RecordValue>(bucket);
 if(beforeDb&&(beforeDb.name!==spec.databaseName||beforeDb.enabled!==true))throw Error('Existing database is not owned by this app provisioner');if(beforeBucket)checkBucket(beforeBucket,plan.app);
 const rows=new Map<string,RecordValue|null>();for(const c of spec.collections){const value=await client.getOrNull<RecordValue>(db+'/collections/'+c.id);if(value)checkCollection(value,c);rows.set(c.id,value);}
 const lockPath=client.docsPath(plan.databaseId,'app_runtime_state')+'/'+writerLockDocumentId(plan.app);
 if(options.apply&&await client.getOrNull(lockPath))throw Error('Application writer exists; stop it before provisioning. No lock takeover.');
 const created:string[]=[];
 if(options.apply){
  if(!beforeDb){await client.call('POST','/databases',{databaseId:plan.databaseId,name:spec.databaseName,enabled:true});created.push('database');}
  for(const c of spec.collections){const base=db+'/collections/'+c.id,old=rows.get(c.id);if(!old){await client.call('POST',db+'/collections',{collectionId:c.id,name:c.name,permissions:[],documentSecurity:true,enabled:true});created.push('collection:'+c.id);}
   for(const a of c.attributes)if(!old||(old.attributes as RecordValue[]).every(v=>v.key!==a.key)){const{type,...body}=a;await client.call('POST',base+'/attributes/'+type,{...body,array:false});created.push('attribute:'+c.id+'/'+a.key);}
  }
  const wait=options.wait??(ms=>new Promise(resolve=>setTimeout(resolve,ms)));
  // Index creation may require attributes to have finished becoming available.
  for(let pass=0;;pass++){
   let all=true;for(const c of spec.collections){const v=row(await client.call('GET',db+'/collections/'+c.id));checkCollection(v,c);rows.set(c.id,v);if(!c.attributes.every(s=>(v.attributes as RecordValue[]).some(a=>a.key===s.key&&a.status==='available')))all=false;}
   if(all)break;if(pass+1>=attempts)throw Error('Attributes are still pending; resume explicitly later');await wait(500);
  }
  for(const c of spec.collections){const v=rows.get(c.id)!;for(const i of c.indexes)if((v.indexes as RecordValue[]).every(k=>k.key!==i.key)){await client.call('POST',db+'/collections/'+c.id+'/indexes',{...i,orders:i.attributes.map(()=>'ASC')});created.push('index:'+c.id+'/'+i.key);}}
  for(let pass=0;;pass++){
   let all=true;for(const c of spec.collections){const v=row(await client.call('GET',db+'/collections/'+c.id));checkCollection(v,c);rows.set(c.id,v);if(!readyCollection(v,c))all=false;}
   if(all)break;if(pass+1>=attempts)throw Error('Indexes are still pending; resume explicitly later');await wait(500);
  }
  if(!beforeBucket){await client.call('POST','/storage/buckets',{bucketId:plan.bucketId,name:spec.bucketName,permissions:[],fileSecurity:true,enabled:true,maximumFileSize:spec.maximumFileSize,allowedFileExtensions:[],compression:'none',encryption:false,antivirus:false});created.push('bucket');}
 }
 const database=await client.getOrNull<RecordValue>(db),storage=await client.getOrNull<RecordValue>(bucket);if(database&&(database.name!==spec.databaseName||database.enabled!==true))throw Error('Database ownership changed');if(storage)checkBucket(storage,plan.app);
 let schemaReady=Boolean(database&&storage);for(const c of spec.collections){const v=await client.getOrNull<RecordValue>(db+'/collections/'+c.id);if(v)checkCollection(v,c);if(!v||!readyCollection(v,c))schemaReady=false;}
 let namespaceReady=false;
 if(schemaReady&&plan.namespace){
  try{const existing=new AppwriteJsonState({client,databaseId:plan.databaseId,collectionId:'app_runtime_state',namespace:plan.namespace,singleWriter:true});await existing.ready;namespaceReady=true;}catch(error){if((error as {code?:unknown}).code!=='CLOUD_STATE_MANIFEST_MISSING')throw error;}
 }
 if(options.apply&&schemaReady&&plan.namespace&&!namespaceReady){
  const lock=new AppwriteWriterLock({client,databaseId:plan.databaseId,collectionId:'app_runtime_state',serviceId:plan.app});await lock.acquire();let confirmed=false;
  try{const state=new AppwriteJsonState({client,databaseId:plan.databaseId,collectionId:'app_runtime_state',namespace:plan.namespace,singleWriter:true,initialize:true});await state.ready;await state.flush();confirmed=true;}finally{if(confirmed)await lock.release();}
  namespaceReady=true;
 }
 if(options.apply&&!schemaReady)throw Error('Final private schema readback is not ready');
 return{schemaVersion:plan.schemaVersion,app:plan.app,databaseId:plan.databaseId,bucketId:plan.bucketId,namespace:plan.namespace??null,applied:options.apply,schemaReady,namespaceRequired:spec.runtimeNamespace,namespaceReady,ready:schemaReady&&(!spec.runtimeNamespace||namespaceReady),created,existingAclChanged:false,existingDataMigrated:false};
}
