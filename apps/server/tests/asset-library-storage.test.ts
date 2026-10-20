import {afterEach, beforeEach, expect, it} from 'vitest';
import {mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync, readFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {openAssetLibraryDatabase} from '../src/storage/asset-library.js';
import {createLocalAssetLibrary} from '../src/asset-library/service.js';
let root:string;
beforeEach(()=>{root=mkdtempSync(path.join(os.tmpdir(),'canvas-library-storage-'));});
afterEach(()=>{if(path.dirname(root)===os.tmpdir()&&path.basename(root).startsWith('canvas-library-storage-'))rmSync(root,{recursive:true,force:true});});
it('requires an explicit absolute storage root',()=>{expect(()=>openAssetLibraryDatabase('')).toThrow();expect(()=>openAssetLibraryDatabase('relative')).toThrow();});
it.each(['asset-library','asset-library/library.sqlite','asset-library/library.sqlite-wal','asset-library/library.sqlite-shm'])('rejects symlinked storage %s without touching the destination',relative=>{
 const outside=path.join(root,'destination');writeFileSync(outside,'untouched');
 if(relative.includes('/'))mkdirSync(path.join(root,'asset-library'));
 symlinkSync(outside,path.join(root,relative));expect(()=>openAssetLibraryDatabase(root)).toThrow('Unsafe asset library storage path');expect(readFileSync(outside,'utf8')).toBe('untouched');
});
it('drains asynchronous image metadata decoding before closing and persists its result',async()=>{
 const library=createLocalAssetLibrary(root),bytes=await sharp({create:{width:32,height:16,channels:3,background:'#ff0000'}}).png().toBuffer();
 const asset=await library.create({name:'Red',kind:'image'},{bytes,filename:'red.png',mime:'image/png'});
 const indexing=library.indexImages();await library.close?.();await indexing;
 const reopened=createLocalAssetLibrary(root);try{expect((await reopened.read(asset.id)).versions[0]!.imageMetadata).toMatchObject({width:32,height:16,status:'ready'});}finally{await reopened.close?.();}
});
it('serializes two library instances on the same explicit root without overwriting stale revisions',async()=>{
 const one=createLocalAssetLibrary(root),two=createLocalAssetLibrary(root);try{
 const a=await one.create({name:'Shared',kind:'text',captureId:'same-key'});
 const replay=await two.create({kind:'text',captureId:'same-key',name:'Shared'});expect(replay.id).toBe(a.id);
 await one.patch(a.id,{name:'Edited',revision:a.revision});expect(()=>two.patch(a.id,{name:'Stale',revision:a.revision})).toThrow();
 expect((await two.read(a.id)).name).toBe('Edited');
 }finally{await one.close?.();await two.close?.();}
});
