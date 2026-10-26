import {expect,it} from 'vitest';
import {assertPrivateAppwriteStorage} from '../src/private-storage.js';
import type {AppwriteStateClient} from '../src/port.js';
const fixture=(get:(route:string)=>unknown)=>({client:{call:async(_method:string,route:string)=>get(route)} as AppwriteStateClient,databaseId:'private_db',collectionIds:['business','runtime'],bucketId:'private_bucket'});
it('verifies private collections and bucket without any mutation',async()=>{
 const calls:string[]=[];
 await assertPrivateAppwriteStorage(fixture(route=>{calls.push(route);return {$permissions:[],documentSecurity:true,fileSecurity:true};}));
 expect(calls).toHaveLength(3);
});
it('refuses reader-wide grants or disabled per-resource security',async()=>{
 for(const metadata of [{$permissions:['read("users")'],documentSecurity:true,fileSecurity:true},{$permissions:[],documentSecurity:false,fileSecurity:true},{$permissions:[],documentSecurity:true,fileSecurity:false},{}]){
  await expect(assertPrivateAppwriteStorage(fixture(()=>metadata))).rejects.toMatchObject({code:'CLOUD_STORAGE_NOT_PRIVATE'});
 }
});
it('does not leak backend messages and refuses incomplete configuration',async()=>{
 const problem=await assertPrivateAppwriteStorage(fixture(()=>{throw Error('secret credential');})).catch(error=>error);
 expect(problem.code).toBe('CLOUD_STORAGE_UNAVAILABLE');expect(String(problem)).not.toContain('secret credential');
 await expect(assertPrivateAppwriteStorage({...fixture(()=>({})),collectionIds:[]})).rejects.toMatchObject({code:'CLOUD_STORAGE_NOT_CONFIGURED'});
});
