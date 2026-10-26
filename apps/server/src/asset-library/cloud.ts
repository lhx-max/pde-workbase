import {createHash} from 'node:crypto';
import type {SQLInputValue} from 'node:sqlite';
import type {JsonStatePort} from '@ks-designai/app-cloud-state';
import {createPersonalAssetService,type PersonalAssetService} from './core.js';
import type {AssetLibraryAdapter} from './service.js';
import {Database} from '../storage/database.js';
import {AppwriteClient,appwriteEnc as enc} from '../storage/appwrite-client.js';
import {currentRequestTenant,type TenantContext} from '../tenant.js';
import {CanvasStateError} from '../canvas/errors.js';

// Typed business projections, not database files or a directory backup.
const schema:Record<string,readonly string[]>={
 personal_assets:['id','body'],
 asset_library_captures:['scope','capture_id','digest','asset_id'],
 personal_asset_spaces:['scope','body'],
 asset_library_removed_spaces:['space_id'],
 personal_asset_template_baselines:['source_id','body'],
 personal_asset_imports:['source_id','asset_id'],
 personal_asset_uses:['asset_id','project_id','filename','version_id','used_at'],
 personal_asset_template_tag_cleanup:['source_id','original_body','original_baseline'],
 personal_asset_upload_repairs:['id','original_body'],
 personal_asset_space_repairs:['id','original_body'],
};
type Cell=string|number|null;
interface LibraryState {version:1;scope:string;tables:Record<string,Array<Record<string,Cell>>>;blobs:Array<{hash:string;fileId:string}>}
interface WorkingLibrary {db:Database;core:PersonalAssetService;known:Set<string>;tail:Promise<unknown>;failure?:unknown}
const problem=(code:string,message:string,status=503)=>new CanvasStateError(status,code,message);
const hash=(value:string|Uint8Array)=>createHash('sha256').update(value).digest('hex');

/** Existing library domain/UI, with cloud authority and disposable memory only.
 * All public calls capture request scope before awaiting. One service writer is
 * required by the injected JsonStatePort. Bytes precede metadata publication. */
export function createCloudAssetLibrary(options:{state:JsonStatePort;client:AppwriteClient;bucketId:string;authorizeWrite:(actor:TenantContext,action:string)=>boolean|Promise<boolean>}):AssetLibraryAdapter {
 const scopes=new Map<string,Promise<WorkingLibrary>>();
 const fileId=(scope:string,digest:string)=>`al${hash(JSON.stringify([scope,digest])).slice(0,32)}`;
 const filePath=(id:string)=>`/storage/buckets/${enc(options.bucketId)}/files/${enc(id)}`;
 const actor=()=>{
  const value=currentRequestTenant();
  if(!value?.bizId||!value.applicationInstanceId||!value.providerInstanceId||!value.applicationId)
   throw problem('ASSET_LIBRARY_SCOPE_REQUIRED','Cloud library requires a verified MA business-space context',403);
  return {...value};
 };
 const scopeOf=(value:TenantContext)=>JSON.stringify([value.teamId,value.bizId]);
 const slot=(scope:string)=>`asset-library:${hash(scope)}`;
 const validate=(raw:unknown,scope:string):LibraryState=>{
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw problem('ASSET_LIBRARY_CORRUPT','Invalid cloud library state');
  const value=raw as LibraryState;
  if(value.version!==1||value.scope!==scope||!value.tables||typeof value.tables!=='object'||Array.isArray(value.tables)||!Array.isArray(value.blobs)
   ||Object.keys(value).some(k=>!['version','scope','tables','blobs'].includes(k))||Object.keys(value.tables).length!==Object.keys(schema).length)
   throw problem('ASSET_LIBRARY_CORRUPT','Invalid cloud library schema/scope');
  for(const [table,columns] of Object.entries(schema)){
   const rows=value.tables[table];
   if(!Array.isArray(rows)||rows.some(row=>!row||typeof row!=='object'||Array.isArray(row)||Object.keys(row).length!==columns.length
    ||columns.some(c=>!(c in row))||Object.keys(row).some(c=>!columns.includes(c))
    ||Object.values(row).some(v=>v!==null&&typeof v!=='string'&&(typeof v!=='number'||!Number.isFinite(v)))))
    throw problem('ASSET_LIBRARY_CORRUPT','Invalid cloud library rows');
  }
  const seen=new Set<string>();
  for(const blob of value.blobs){
   if(!blob||Object.keys(blob).length!==2||!/^[a-f0-9]{64}$/.test(blob.hash)||blob.fileId!==fileId(scope,blob.hash)||seen.has(blob.hash))
    throw problem('ASSET_LIBRARY_CORRUPT','Invalid cloud library blob mapping');
   seen.add(blob.hash);
  }
  return value;
 };
 const load=async(scope:string):Promise<WorkingLibrary>=>{
  await options.state.ready;const raw=options.state.read(slot(scope));const db=new Database(':memory:');
  let core:PersonalAssetService;
  try{
   core=createPersonalAssetService(db);
   const known=new Set<string>();
   if(raw!==undefined){
    const snapshot=validate(raw,scope);let total=0;
    for(const blob of snapshot.blobs){
     const bytes=await options.client.download(filePath(blob.fileId)+'/download');total+=bytes.byteLength;
     if(total>256*1024*1024)throw problem('ASSET_LIBRARY_WORKING_SET_LIMIT','Cloud library exceeds this worker\'s 256 MiB working-set limit');
     if(hash(bytes)!==blob.hash)throw problem('ASSET_LIBRARY_CORRUPT','Cloud library blob integrity mismatch');
     db.prepare('INSERT INTO personal_asset_blobs(hash,bytes) VALUES (?,?)').run(blob.hash,bytes);known.add(blob.hash);
    }
    db.transaction(()=>{for(const [table,columns] of Object.entries(schema))for(const row of snapshot.tables[table]!)
     db.prepare(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(()=>'?').join(',')})`).run(...columns.map(c=>row[c] as SQLInputValue));})() ;
    // Parse domain bodies and verify all version references before serving data.
    for(const asset of core.list())for(const version of asset.versions)if(!known.has(version.hash))throw problem('ASSET_LIBRARY_CORRUPT','Asset references an absent cloud blob');
   }
   return {db,core,known,tail:Promise.resolve()};
  }catch(error){db.close();throw error;}
 };
 const commit=async(scope:string,working:WorkingLibrary)=>{
  const blobs=working.db.prepare('SELECT hash,bytes FROM personal_asset_blobs').all() as Array<{hash:string;bytes:Uint8Array}>;
  let total=0;
  for(const blob of blobs){
   total+=blob.bytes.byteLength;if(total>256*1024*1024)throw problem('ASSET_LIBRARY_WORKING_SET_LIMIT','Cloud library exceeds this worker\'s 256 MiB working-set limit');
   if(working.known.has(blob.hash))continue;
   const id=fileId(scope,blob.hash);
   try{await options.client.upload(options.bucketId,id,'library-version.bin',blob.bytes,'application/octet-stream');}
   catch(error){if(!(error instanceof CanvasStateError)||error.status!==409)throw error;
    if(hash(await options.client.download(filePath(id)+'/download'))!==blob.hash)throw problem('ASSET_LIBRARY_CORRUPT','Existing cloud blob integrity mismatch');}
   working.known.add(blob.hash);
  }
  const snapshot:LibraryState={version:1,scope,tables:Object.fromEntries(Object.entries(schema).map(([table,columns])=>[table,working.db.prepare(`SELECT ${columns.join(',')} FROM ${table}`).all()])),blobs:blobs.map(blob=>({hash:blob.hash,fileId:fileId(scope,blob.hash)}))} as LibraryState;
  options.state.write(slot(scope),validate(snapshot,scope));await options.state.flush();
 };
 const run=async<K extends keyof PersonalAssetService>(method:K,write:boolean,args:Parameters<PersonalAssetService[K]>):Promise<Awaited<ReturnType<PersonalAssetService[K]>>>=>{
  const identity=actor();const scope=scopeOf(identity);
  if(write&&!await options.authorizeWrite(identity,'canvas.assets.write'))throw problem('APP_WRITE_FORBIDDEN','Cloud library write action is not delegated',403);
  let pending=scopes.get(scope);if(!pending){pending=load(scope);scopes.set(scope,pending);}
  const working=await pending;
  const task=working.tail.then(async()=>{
   if(working.failure)throw working.failure;options.state.read(slot(scope)); // Check shared backend health even for cached reads.
   let publishing=false;
   try{
    const operation=working.core[method] as (...input:unknown[])=>unknown;
    const result=await operation(...args);
    if(write){publishing=true;await commit(scope,working);}
    return result as Awaited<ReturnType<PersonalAssetService[K]>>;
   }catch(error){if(publishing)working.failure=error;throw error;}
  });
  working.tail=task.catch(()=>{});return await task as Awaited<ReturnType<PersonalAssetService[K]>>;
 };
 return {
  source:{id:'builtin-cloud',name:'Cloud asset library',kind:'external'},imageMetadata:true,idempotentCreate:true,
  list:()=>run('list',false,[]),read:id=>run('read',false,[id]),content:(...args)=>run('content',false,args),uses:id=>run('uses',false,[id]),
  readSpaces:scope=>run('readSpaces',false,[scope]),
  create:(...args)=>run('create',true,args),patch:(...args)=>run('patch',true,args),version:(...args)=>run('version',true,args),batch:(...args)=>run('batch',true,args),
  recordUse:(...args)=>run('recordUse',true,args),patchSpaces:(...args)=>run('patchSpaces',true,args),importTemplates:inputs=>run('importTemplates',true,[inputs]),
  async indexImages(){const identity=actor();if(await options.authorizeWrite(identity,'canvas.assets.write'))await run('indexImages',true,[]);},
  async close(){for(const pending of scopes.values()){const working=await pending.catch(()=>undefined);if(working){await working.tail;await working.core.whenIdle();working.db.close();}}scopes.clear();},
 };
}
