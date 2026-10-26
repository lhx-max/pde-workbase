/** Protocol fixture enforces schema before accepting real state/lock writes. */
import{PRIVATE_STORAGE_SCHEMAS}from'../src/schemas.js';import{createProvisionPlan,type ProvisionClient}from'../src/private-storage.js';
export type Row=Record<string,any>;
export class StorageFixture implements ProvisionClient {
 rows=new Map<string,Row>();calls:Array<{method:string;path:string;body?:any}>=[];pendingAttributes=false;pendingIndexes=false;postFaultAt=0;posts=0;
 docsPath(db:string,c:string){return`/databases/${db}/collections/${c}/documents`;}
 async getOrNull<T>(path:string):Promise<T|null>{this.calls.push({method:'GET',path});return this.rows.has(path)?structuredClone(this.rows.get(path)) as T:null;}
 async call<T>(method:string,path:string,body?:any):Promise<T>{
  this.calls.push({method,path,body:structuredClone(body)});if(method==='POST'&&++this.posts===this.postFaultAt)throw Error('Injected uncertain request; explicit operator resume required');
  if(method==='GET'){
   const[qbase,q]=path.split('?');if(q){let docs=[...this.rows].filter(([p])=>p.startsWith(qbase+'/')&&p.slice(qbase.length+1).indexOf('/')<0).map(([,r])=>structuredClone(r));const queries=new URLSearchParams(q).getAll('queries[]').map(v=>JSON.parse(v));for(const query of queries){if(query.method==='equal')docs=docs.filter(r=>r[query.attribute]===query.values[0]);if(query.method==='orderAsc')docs.sort((a,b)=>String(a[query.attribute]).localeCompare(String(b[query.attribute])));if(query.method==='cursorAfter'){const index=docs.findIndex(r=>r.$id===query.values[0]);docs=docs.slice(index+1);}if(query.method==='limit')docs=docs.slice(0,query.values[0]);}return{documents:docs,total:docs.length}as T;}
   if(!this.rows.has(path))throw Object.assign(Error('404'),{status:404});return structuredClone(this.rows.get(path))as T;
  }
  if(method==='POST'){
   if(path==='/databases'){this.insert(path+'/'+body.databaseId,body);return structuredClone(body);}
   if(path==='/storage/buckets'){this.insert(path+'/'+body.bucketId,{$id:body.bucketId,$permissions:body.permissions,...body});return structuredClone(this.rows.get(path+'/'+body.bucketId))as T;}
   if(path.endsWith('/collections')){const value={$id:body.collectionId,$permissions:body.permissions,...body,attributes:[],indexes:[]};this.insert(path+'/'+body.collectionId,value);return structuredClone(value)as T;}
   const attr=path.match(/^(.*)\/attributes\/(string|integer)$/);if(attr){const collection=this.rows.get(attr[1]!)!;const value={...body,type:attr[2],status:this.pendingAttributes?'processing':'available'};if(collection.attributes.some((a:Row)=>a.key===body.key))throw Object.assign(Error('409'),{status:409});collection.attributes.push(value);return structuredClone(value)as T;}
   if(path.endsWith('/indexes')){const collection=this.rows.get(path.slice(0,-8))!;if(collection.attributes.some((a:Row)=>a.status!=='available'))throw Error('Index attempted before attributes ready');const value={...body,status:this.pendingIndexes?'processing':'available'};collection.indexes.push(value);return structuredClone(value)as T;}
   if(path.endsWith('/documents')){const collection=this.rows.get(path.slice(0,-10));if(!collection)throw Error('No collection');for(const a of collection.attributes){const v=body.data[a.key];if(a.required&&(v===undefined||v===null))throw Error('Missing '+a.key);if(v!==undefined&&v!==null&&(a.type==='string'&&(typeof v!=='string'||v.length>a.size)||a.type==='integer'&&(!Number.isSafeInteger(v)||v<a.min||a.max!==undefined&&v>a.max)))throw Error('Bad '+a.key);}for(const key of Object.keys(body.data))if(!collection.attributes.some((a:Row)=>a.key===key))throw Error('Unknown '+key);const value={$id:body.documentId,$permissions:[],...body.data};this.insert(path+'/'+body.documentId,value);return structuredClone(value)as T;}
  }
  if(method==='DELETE'){if(!path.includes('/documents/'))throw Error('Unexpected destructive operation');this.rows.delete(path);return undefined as T;}
  throw Error('Unexpected '+method+' '+path);
 }
 private insert(p:string,v:Row){if(this.rows.has(p))throw Object.assign(Error('409'),{status:409});this.rows.set(p,structuredClone(v));}
 seed(app:string){const plan=createProvisionPlan(app,app+'_test_private',app+'_test_assets',PRIVATE_STORAGE_SCHEMAS[app]!.runtimeNamespace?app+'-test':undefined),spec=PRIVATE_STORAGE_SCHEMAS[app]!;const base='/databases/'+plan.databaseId;this.rows.set(base,{name:spec.databaseName,enabled:true});for(const c of spec.collections)this.rows.set(base+'/collections/'+c.id,{name:c.name,enabled:true,documentSecurity:true,$permissions:[],attributes:c.attributes.map(a=>({...a,status:'available',array:false})),indexes:c.indexes.map(i=>({...i,orders:[],status:'available'}))});this.rows.set('/storage/buckets/'+plan.bucketId,{name:spec.bucketName,enabled:true,fileSecurity:true,$permissions:[],maximumFileSize:spec.maximumFileSize,allowedFileExtensions:[],compression:'none',encryption:false,antivirus:false});return plan;}
}
