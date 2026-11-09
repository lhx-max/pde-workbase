import {afterEach, beforeEach, expect, it} from 'vitest';
import {Database} from '../src/storage/database.js';
import {createPersonalAssetService} from '../src/asset-library/core.js';
let db:Database, store:ReturnType<typeof createPersonalAssetService>;
beforeEach(()=>{db=new Database(':memory:');store=createPersonalAssetService(db);});
afterEach(()=>db.close());
it('returns exact binary Buffers and never serializes SQLite Uint8Array as JSON',()=>{
 const bytes=Buffer.from([0,255,128,10,13,0]);const a=store.create({name:'bytes',kind:'file'},{bytes,filename:'bytes.bin',mime:'application/octet-stream'});
 expect(Buffer.isBuffer(store.content(a.id).bytes)).toBe(true);expect(store.content(a.id).bytes).toEqual(bytes);
});
it.each(['.','..',' /bad','bad\\path','bad\r\nheader'])('rejects unsafe stored filename %s and rolls back blobs',filename=>{
 expect(()=>store.create({name:'asset',kind:'file'},{bytes:Buffer.from('secret'),filename,mime:'text/plain'})).toThrow();
 expect(store.list()).toEqual([]);expect(db.prepare('SELECT count(*) AS n FROM personal_asset_blobs').get()).toEqual({n:0});
});
it('honors optional batch revision before any mutation',()=>{
 const a=store.create({name:'a',kind:'text'});const b=store.create({name:'b',kind:'text'});store.patch(b.id,{name:'changed'});
 expect(()=>store.batch([a.id,b.id],'favorite',{favorite:true,revision:1})).toThrow();expect(store.read(a.id).favorite).toBe(false);
});
it('rejects oversized UTF8 text by bytes, not characters',()=>{expect(()=>store.create({name:'text',kind:'text',content:'中'.repeat(2*1024*1024)})).toThrow();expect(store.list()).toEqual([]);});
it('does not silently accept malformed source objects',()=>{expect(()=>store.create({name:'text',kind:'text',source:[] as never})).toThrow();expect(store.list()).toEqual([]);});
it('imports an approved template batch atomically, never leaving a partial catalogue',()=>{
 const template={name:'Template',kind:'text' as const,content:'prompt',source:{template:{id:'template',type:'Slides' as const,referencePath:'design-templates/template/TEMPLATE.md',posterSrc:null,previewSrc:null,previewVideo:null}}};
 expect(()=>store.importTemplates([template,{...template,name:'../invalid',source:{template:{...template.source.template,id:'invalid',referencePath:'design-templates/invalid/TEMPLATE.md'}}}])).toThrow();
 expect(store.list()).toEqual([]);expect(db.prepare('SELECT count(*) AS n FROM personal_asset_blobs').get()).toEqual({n:0});
});
it('scopes capture receipts, leaves none on failure, and never resurrects deleted captures',()=>{
 const first=store.create({name:'Capture',kind:'text',captureId:'resource-1',source:{projectId:'one'}});
 const second=store.create({name:'Capture',kind:'text',captureId:'resource-1',source:{projectId:'two'}});expect(second.id).not.toBe(first.id);
 expect(()=>store.create({name:'../bad',kind:'text',captureId:'bad'})).toThrow();expect(db.prepare('SELECT count(*) AS n FROM asset_library_captures').get()).toEqual({n:2});
 store.batch([first.id],'delete');expect(()=>store.create({name:'Capture',kind:'text',captureId:'resource-1',source:{projectId:'one'}})).toThrow('permanently deleted');
});
it('moves complete cross-space trees on space removal and detaches roots from other spaces',()=>{
 store.patchSpaces('local',{upsert:['removed','target','other'].map(id=>({id,name:id,createdAt:1})),remove:[]});
 const outer=store.create({name:'Outer',kind:'folder',spaceId:'other'});
 const folder=store.create({name:'Folder',kind:'folder',spaceId:'removed',parentId:outer.id});
 const child=store.create({name:'Cross-space child',kind:'text',content:'kept',spaceId:'other',parentId:folder.id});
 const result=store.patchSpaces('local',{upsert:[],remove:['removed'],targetSpaceId:'target'});
 expect(result.folders.map(f=>f.id)).toEqual(['target','other']);
 expect(store.read(folder.id)).toMatchObject({spaceId:'target',parentId:null,revision:folder.revision+1});
 expect(store.read(child.id)).toMatchObject({spaceId:'target',parentId:folder.id,revision:child.revision+1});
 expect(store.read(outer.id)).toEqual(outer);expect(store.content(child.id).bytes.toString()).toBe('kept');
});
it.each([false,true])('rolls back space metadata, assets and tombstones when removeContents=%s fails publication',(removeContents)=>{
 store.patchSpaces('local',{upsert:[{id:'removed',name:'Removed',createdAt:1}],remove:[]});
 const asset=store.create({name:'Keep',kind:'text',spaceId:'removed'}),spaces=store.readSpaces('local');
 db.exec("CREATE TRIGGER reject_space_publication BEFORE INSERT ON personal_asset_spaces BEGIN SELECT RAISE(ABORT, 'forced space failure'); END");
 expect(()=>store.patchSpaces('local',{upsert:[],remove:['removed'],removeContents})).toThrow('forced space failure');
 expect(store.read(asset.id)).toEqual(asset);expect(store.readSpaces('local')).toEqual(spaces);
 expect(()=>store.create({name:'Still valid',kind:'text',spaceId:'removed'})).not.toThrow();
});
it('permanently removes space trees, uses and unreferenced blobs while retaining shared bytes elsewhere',()=>{
 store.patchSpaces('local',{upsert:['removed','other'].map(id=>({id,name:id,createdAt:1})),remove:[]});
 const folder=store.create({name:'Folder',kind:'folder',spaceId:'removed'});
 const child=store.create({name:'Child',kind:'text',spaceId:'other',parentId:folder.id,content:'private'});
 const shared=store.create({name:'Shared',kind:'text',spaceId:'removed',content:'shared'});
 const keep=store.create({name:'Keep',kind:'text',spaceId:'other',content:'shared'});
 store.recordUse(child.id,{projectId:'p',filename:'child.md',versionId:child.versions[0]!.id,usedAt:0});
 store.patchSpaces('local',{upsert:[],remove:['removed'],removeContents:true});
 expect(store.list()).toEqual([keep]);expect(()=>store.content(shared.id)).toThrow();expect(db.prepare('SELECT count(*) AS n FROM personal_asset_blobs').get()).toEqual({n:1});expect(db.prepare('SELECT * FROM personal_asset_uses').all()).toEqual([]);
});
it('rejects invalid space removal targets without changing assets or space names',()=>{
 store.patchSpaces('local',{upsert:['removed','target'].map(id=>({id,name:id,createdAt:1})),remove:[]});
 const asset=store.create({name:'Keep',kind:'text',spaceId:'removed'}),spaces=store.readSpaces('local');
 for(const request of [{upsert:[],remove:['default-project']},{upsert:[],remove:['removed'],targetSpaceId:'missing'},{upsert:[],remove:['removed','target'],targetSpaceId:'target'},{upsert:[],remove:['removed'],removeContents:'true'}]){
  expect(()=>store.patchSpaces('local',request as never)).toThrow();expect(store.read(asset.id)).toEqual(asset);expect(store.readSpaces('local')).toEqual(spaces);
 }
});
it('keeps capture replays after a space move, rejects late writes and retains historical unknown spaces',()=>{
 store.patchSpaces('local',{upsert:[{id:'removed',name:'Removed',createdAt:1}],remove:[]});
 const request={name:'Capture',kind:'text' as const,spaceId:'removed',captureId:'space-capture'},asset=store.create(request);
 store.patchSpaces('local',{upsert:[],remove:['removed']});
 expect(store.create(request)).toMatchObject({id:asset.id,spaceId:'default-project'});
 for(const create of [()=>store.create({...request,captureId:'new'}),()=>store.patch(asset.id,{spaceId:'removed'}),()=>store.batch([asset.id],'copy',{spaceId:'removed'})])expect(create).toThrow();
 expect(store.create({name:'Legacy',kind:'text',spaceId:'arbitrary-historical'}).spaceId).toBe('arbitrary-historical');
 const reopened=createPersonalAssetService(db);expect(()=>reopened.create({...request,captureId:'another'})).toThrow();
});
it('keeps MIME header safe and deduplicates bytes across assets and versions',()=>{
 const a=store.create({name:'a',kind:'file'},{bytes:Buffer.from('same'),filename:'a.txt',mime:'text/plain\r\nX-Evil: 1'});
 expect(a.versions[0]!.mime).toBe('application/octet-stream');store.create({name:'b',kind:'text',content:'same'});
 expect(db.prepare('SELECT count(*) AS n FROM personal_asset_blobs').get()).toEqual({n:1});
 const unchanged=store.version(a.id,{bytes:Buffer.from('same'),filename:'a.txt',mime:'text/plain'},a.revision);expect(unchanged.revision).toBe(a.revision);
});
