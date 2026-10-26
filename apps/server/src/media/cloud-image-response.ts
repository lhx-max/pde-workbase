import { createHash } from 'node:crypto';
import type { Request, Response } from 'express';
import sharp from 'sharp';
import { PreviewCache, PREVIEW_WIDTHS } from './canvas-preview.js';
const caches=new WeakMap<ImageFileStorage,PreviewCache>();
import type { ImageFileStorage } from '../storage/cloud-image-files.js';

/** Called after project authorization. Originals stay in cloud storage;
 * thumbnails are bounded, disposable derivatives, never a local source fallback. */
export async function sendCloudImage(req:Request,res:Response,storage:ImageFileStorage|undefined,projectId:string,relative:string):Promise<boolean>{
 if(!storage)return false;
 const thumbnail=req.query.odThumbnailWidth;
 const canvas=req.query.odCanvasPreview;
 const requested=thumbnail??(canvas!==undefined?(req.query.odPreviewWidth??256):undefined);
 const width=requested===undefined?undefined:Number(requested);
 const invalid=thumbnail!==undefined&&canvas!==undefined||width!==undefined&&(!Number.isInteger(width)||
   (thumbnail!==undefined?(width<16||width>512):!PREVIEW_WIDTHS.some(value=>value===width)));
 if(invalid){res.status(400).json({error:{code:'BAD_REQUEST',message:'Invalid image preview width'}});return true;}
 const opened=storage.open?await storage.open(projectId,relative):null;
 const remote=storage.open?null:await storage.read(projectId,relative);
 if(!opened&&!remote){
  if(/\.(?:png|jpe?g|webp|gif|avif)$/i.test(relative)){
   res.status(404).json({error:{code:'FILE_NOT_FOUND',message:'Image is not present in cloud storage'}});return true;
  }
  return false;
 }
 if(canvas!==undefined&&canvas!=='image'){res.status(415).json({error:{code:'UNSUPPORTED_MEDIA_TYPE',message:'Image preview source required'}});return true;}
 const revision=opened?.revision??createHash('sha256').update(remote!.buffer).digest('hex');
 const fit=thumbnail!==undefined?'cover':'inside';
 const etag=`"cloud-image-v2-${fit}-${width??'original'}-${revision}"`;
 res.setHeader('ETag',etag);
 // Revalidate access before a private cache is used, including account switches.
 res.setHeader('Cache-Control','private, no-cache');
 res.setHeader('Vary','Cookie, Authorization');
 res.setHeader('X-Content-Type-Options','nosniff');
 const validators=req.get('if-none-match')?.split(',').map(value=>value.trim().replace(/^W\//u,''));
 if(validators?.some(value=>value==='*'||value===etag)){res.status(304).end();return true;}
 let body:Buffer;
 if(width===undefined)body=opened?await opened.read():remote!.buffer;
 else if(opened)body=await opened.preview({width,fit});
 else {
   let cache=caches.get(storage);if(!cache){cache=new PreviewCache(32*1024*1024);caches.set(storage,cache);}
   body=await cache.get(JSON.stringify([projectId,relative,revision,width,fit]),()=>sharp(remote!.buffer,{animated:false,limitInputPixels:80_000_000}).rotate().resize(width,width,{fit,withoutEnlargement:true}).webp({quality:78,effort:2}).timeout({seconds:10}).toBuffer());
 }
 res.setHeader('Content-Type',width===undefined?(opened?.file??remote!.file).mime:'image/webp');
 if(width===undefined&&(opened?.file??remote!.file).mime==='image/svg+xml')res.setHeader('Content-Security-Policy',"sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:; object-src 'none'; base-uri 'none'");
 res.setHeader('Content-Length',body.byteLength);
 res.send(body);return true;
}
