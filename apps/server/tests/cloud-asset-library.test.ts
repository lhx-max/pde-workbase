import {afterEach,expect,it} from 'vitest';
import {createCloudAssetLibrary} from '../src/asset-library/cloud.js';
import type {AssetLibraryAdapter} from '../src/asset-library/service.js';
import {AppwriteClient} from '../src/storage/appwrite-client.js';
import {CanvasStateError} from '../src/canvas/errors.js';
import {runWithRequestTenant,type TenantContext} from '../src/tenant.js';
const actor:TenantContext={teamId:'team-a',userId:'writer',bizId:'biz-a',applicationId:'canvas',applicationInstanceId:'instance',providerInstanceId:'provider'};
const libraries:AssetLibraryAdapter[]=[];
afterEach(async()=>{for(const library of libraries.splice(0))await library.close?.();});
function fixture(){
 const durable=new Map<string,unknown>();const files=new Map<string,Uint8Array>();let fail=false;
 const port=()=>{
  const state=new Map([...durable].map(([key,value])=>[key,structuredClone(value)]));let poisoned=false;
  return {ready:Promise.resolve(),read(key:string){if(poisoned)throw Error('unavailable');return structuredClone(state.get(key));},
   write(key:string,value:unknown){if(poisoned)throw Error('unavailable');state.set(key,structuredClone(value));},
   async flush(){if(fail||poisoned){poisoned=true;throw Error('unavailable');}for(const [key,value]of state)durable.set(key,structuredClone(value));}};
 };
 const client={
  async upload(_bucket:string,id:string,_name:string,bytes:Uint8Array){if(files.has(id))throw new CanvasStateError(409,'CANVAS_CONFLICT','exists');files.set(id,new Uint8Array(bytes));return{$id:id};},
  async download(target:string){const id=target.split('/').at(-2)!;const value=files.get(id);if(!value)throw new CanvasStateError(404,'CANVAS_NOT_FOUND','missing');return new Uint8Array(value);},
 } as unknown as AppwriteClient;
 const make=()=>{const library=createCloudAssetLibrary({state:port(),client,bucketId:'private-assets',authorizeWrite:identity=>identity.userId==='writer'});libraries.push(library);return library;};
 return {make,files,durable,set fail(value:boolean){fail=value;}};
}
const as=<T>(run:()=>T,who:TenantContext=actor)=>runWithRequestTenant(who,run);
it('restores original library metadata, versions and exact bytes in a fresh adapter',async()=>{
 const f=fixture();const first=f.make();
 const folder=await as(()=>first.create({kind:'folder',name:'Folder'}));
 const item=await as(()=>first.create({kind:'file',name:'Binary',parentId:folder.id},{bytes:Buffer.from([0,255,12]),filename:'file.bin',mime:'application/octet-stream'}));
 await as(()=>first.version(item.id,{bytes:Buffer.from('version-two'),filename:'file.bin',mime:'application/octet-stream'},item.revision));
 const second=f.make();const recovered=await as(()=>second.read(item.id));expect(recovered.parentId).toBe(folder.id);expect(recovered.versions).toHaveLength(2);
 expect((await as(()=>second.content(item.id))).bytes).toEqual(Buffer.from('version-two'));
 expect((await as(()=>second.content(item.id,item.versions[0]!.id))).bytes).toEqual(Buffer.from([0,255,12]));
 expect(f.files.size).toBe(2);expect([...f.durable.keys()].every(key=>key.startsWith('asset-library:'))).toBe(true);
});
it('separates teams and business spaces and permits reads without write grants',async()=>{
 const f=fixture();const library=f.make();const item=await as(()=>library.create({kind:'text',name:'Owned',content:'private'}));
 for(const foreign of [{...actor,teamId:'team-b'},{...actor,bizId:'biz-b'}]){
  expect(await as(()=>library.list(),foreign)).toEqual([]);await expect(as(()=>library.read(item.id),foreign)).rejects.toMatchObject({status:404});
 }
 const reader={...actor,userId:'reader'};expect((await as(()=>library.read(item.id),reader)).name).toBe('Owned');
 await expect(as(()=>library.create({kind:'text',name:'Denied'}),reader)).rejects.toMatchObject({code:'APP_WRITE_FORBIDDEN'});
 await expect(library.list()).rejects.toMatchObject({code:'ASSET_LIBRARY_SCOPE_REQUIRED'});
});
it('refuses success and poisons unconfirmed memory after a cloud commit failure',async()=>{
 const f=fixture();const library=f.make();f.fail=true;
 await expect(as(()=>library.create({kind:'text',name:'Must not acknowledge',content:'draft'}))).rejects.toThrow('unavailable');
 await expect(as(()=>library.list())).rejects.toThrow('unavailable');
 f.fail=false;expect(await as(()=>f.make().list())).toEqual([]);
});
it('detects corrupt or missing binary versions on recovery',async()=>{
 const f=fixture();const library=f.make();await as(()=>library.create({kind:'file',name:'File'},{bytes:Buffer.from('original'),filename:'file.bin',mime:'application/octet-stream'}));
 for(const key of f.files.keys())f.files.set(key,new Uint8Array([9]));
 await expect(as(()=>f.make().list())).rejects.toMatchObject({code:'ASSET_LIBRARY_CORRUPT'});
});
it('keeps domain validation rollback without making the scope unavailable',async()=>{
 const f=fixture();const library=f.make();
 await expect(as(()=>library.create({kind:'file',name:'Invalid'},{bytes:Buffer.from('x'),filename:'../escape',mime:'text/plain'}))).rejects.toMatchObject({status:400});
 expect(await as(()=>library.list())).toEqual([]);
});
