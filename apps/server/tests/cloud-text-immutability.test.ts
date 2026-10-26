import {describe,expect,it} from 'vitest';
import {AppwriteCanvasFileContent} from '../src/storage/canvas-appwrite-persistence.js';
import {AppwriteClient} from '../src/storage/appwrite-client.js';
import {CanvasStateError} from '../src/canvas/errors.js';

function fixture(){
 const rows=new Map<string,Record<string,unknown>>(),blobs=new Map<string,Uint8Array>(),deletes:string[]=[];
 const client={
  docsPath:()=>'/databases/db/collections/canvas_files/documents',
  async call(method:string,route:string,body?:{documentId?:string;data?:Record<string,unknown>}){
   const url=new URL(route,'https://fixture.invalid');
   if(method==='GET'){
    const filters=url.searchParams.getAll('queries[]').map(value=>JSON.parse(value) as {method:string;attribute?:string;values:unknown[]});
    return {documents:[...rows.values()].filter(row=>filters.every(q=>q.method!=='equal'||row[q.attribute!]===q.values[0]))};
   }
   if(method==='POST'){rows.set(body!.documentId!,{$id:body!.documentId,...body!.data});return {};}
   if(method==='PATCH'){const id=url.pathname.split('/').pop()!;rows.set(id,{...rows.get(id),...body!.data});return {};}
   if(method==='DELETE'){deletes.push(route);throw Error('Shared blobs must not be deleted');}
   throw Error('Unexpected fixture method');
  },
  async upload(_bucket:string,id:string,_name:string,bytes:Uint8Array){if(blobs.has(id))throw new CanvasStateError(409,'FILE_EXISTS','Immutable content already present');blobs.set(id,bytes.slice());},
  async download(route:string){const id=route.split('/').at(-2)!;if(!blobs.has(id))throw Error('missing blob');return blobs.get(id)!.slice();},
 } as unknown as AppwriteClient;
 return {store:new AppwriteCanvasFileContent(client,'db','bucket'),rows,blobs,deletes};
}
describe('cloud text authority and shared immutable bytes',()=>{
 it('keeps another canvas and retained source readable after an identical original is edited',async()=>{
  const f=fixture();await f.store.write('a','note.md','shared');await f.store.write('b','note.md','shared');
  const original=[...f.blobs.keys()][0]!;
  await f.store.write('a','note.md','updated');
  expect(await f.store.read('a','note.md')).toBe('updated');expect(await f.store.read('b','note.md')).toBe('shared');
  expect(f.blobs.has(original)).toBe(true);expect(f.deletes).toEqual([]);
 });
 it('rejects duplicated path indexes, corrupted bytes and traversal',async()=>{
  const f=fixture();await f.store.write('a','note.md','text');
  const [row]=f.rows.values();f.rows.set('duplicate',{...row,$id:'duplicate'});
  await expect(f.store.read('a','note.md')).rejects.toMatchObject({code:'CANVAS_FILE_INDEX_CORRUPT'});
  f.rows.delete('duplicate');f.blobs.set(String(row!.fileId),new TextEncoder().encode('corrupt'));
  await expect(f.store.read('a','note.md')).rejects.toMatchObject({code:'CANVAS_FILE_INTEGRITY'});
  await expect(f.store.read('a','../note.md')).rejects.toThrow();
 });
 it('does not import a local file when no explicit migration reader is supplied',async()=>{
  const f=fixture();expect(await f.store.read('a','missing.md')).toBeNull();expect(f.rows.size).toBe(0);
 });
});
