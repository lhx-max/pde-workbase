import { afterEach, expect, it, vi } from 'vitest';
import express from 'express';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { createProjectRegistry } from '../src/storage/project-registry.js';
import { registerProjectFileRoutes } from '../src/routes/files.js';
const cleanups:Array<()=>Promise<void>>=[];
afterEach(async()=>{for(const close of cleanups.splice(0))await close();});
async function fixture(denied=false){
 const root=await mkdtemp(path.join(tmpdir(),'cloud-image-raw-'));
 const registry=createProjectRegistry(root), project=registry.create({name:'Cloud sidebar'});
 const bytes=await sharp({create:{width:256,height:128,channels:3,background:'#80b090'}}).png().toBuffer();
 const file={name:'outputs/image.png',path:'outputs/image.png',size:bytes.length,mtime:1700000000000,kind:'image' as const,mime:'image/png',type:'file' as const};
 const read=vi.fn(async(_id:string,name:string)=>name===file.name?{file,buffer:bytes}:null);
 const app=express();registerProjectFileRoutes(app,{registry,imageFiles:{read,write:async()=>file,list:async()=>[file]},authorize:async(_req,res)=>{if(denied)res.sendStatus(403);return !denied;}});
 const listener=app.listen(0,'127.0.0.1');await once(listener,'listening');
 cleanups.push(async()=>{await new Promise<void>(r=>listener.close(()=>r()));await rm(root,{recursive:true,force:true});});
 const address=listener.address();if(!address||typeof address==='string')throw Error('listener');
 return{url:`http://127.0.0.1:${address.port}/api/projects/${project.id}/raw/outputs/image.png`,bytes,read};
}
it('serves cloud originals and small WebP sidebar thumbnails without a local source file',async()=>{
 const f=await fixture();const original=await fetch(f.url);expect(original.status).toBe(200);expect(Buffer.from(await original.arrayBuffer())).toEqual(f.bytes);
 const thumb=await fetch(f.url+'?odThumbnailWidth=64');expect(thumb.status).toBe(200);expect(thumb.headers.get('content-type')).toContain('image/webp');
 const meta=await sharp(Buffer.from(await thumb.arrayBuffer())).metadata();expect(meta.width).toBe(64);expect(meta.height).toBe(64);
 const cached=await fetch(f.url+'?odThumbnailWidth=64',{headers:{'if-none-match':thumb.headers.get('etag')!}});expect(cached.status).toBe(304);
 expect((await fetch(f.url+'?odThumbnailWidth=900')).status).toBe(400);
 expect((await fetch(f.url.replace('image.png','missing.png'))).status).toBe(404);
});
it('checks project access before reading cloud image bytes',async()=>{
 const f=await fixture(true);expect((await fetch(f.url+'?odThumbnailWidth=64')).status).toBe(403);expect(f.read).not.toHaveBeenCalled();
});
it('honors canvas preview sizes without cropping and keeps originals exact',async()=>{
 const f=await fixture();
 const preview=await fetch(f.url+'?odCanvasPreview=image&odPreviewWidth=128');expect(preview.status).toBe(200);
 const bytes=Buffer.from(await preview.arrayBuffer());expect((await sharp(bytes).metadata())).toMatchObject({width:128,height:64,format:'webp'});
 expect((await fetch(f.url+'?odCanvasPreview=image&odPreviewWidth=129')).status).toBe(400);
 const original=await fetch(f.url);expect(Buffer.from(await original.arrayBuffer())).toEqual(f.bytes);
});
