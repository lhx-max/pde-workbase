import sharp from 'sharp';
import { PreviewCache } from '../media/canvas-preview.js';
import { createHash } from 'node:crypto';
import type { ProjectFile } from '@bezier/contracts';
import { CanvasStateError } from '@bezier/canvas-core';
import { normalizeSafeProjectFilePath } from '../canvas/persistence.js';
import { AppwriteClient, appwriteEnc as enc } from './appwrite-client.js';

export interface CloudImageSource {
  file: ProjectFile;
  revision: string;
  read(): Promise<Buffer>;
  preview(options: {width:number;fit:'inside'|'cover'}):Promise<Buffer>;
}
export interface ImageFileStorage {
  open?(projectId:string,path:string):Promise<CloudImageSource|null>;
  write(projectId: string, path: string, bytes: Uint8Array, mime: string): Promise<ProjectFile>;
  read(projectId: string, path: string): Promise<{ buffer: Buffer; file: ProjectFile } | null>;
  list(projectId: string): Promise<ProjectFile[]>;
}
type Row = { $id: string; canvasId: string; path: string; fileId: string; mime: string; size: number; sha256: string; createdAt: string };
/** Generated/uploaded images are authoritative in the bucket. No filesystem fallback. */
export class CloudImageFiles implements ImageFileStorage {
  // Scoped to this storage/client instance. Metadata is always revalidated first.
  private readonly originals = new PreviewCache(64 * 1024 * 1024, 3, 24);
  private readonly previews = new PreviewCache(32 * 1024 * 1024, 2, 24);
  constructor(private readonly client: AppwriteClient, private readonly databaseId: string, private readonly bucketId: string) {}
  private path() { return this.client.docsPath(this.databaseId, 'canvas_files'); }
  private async row(projectId: string, relative: string) {
    const q = AppwriteClient.query([AppwriteClient.eq('canvasId', projectId), AppwriteClient.eq('path', relative), AppwriteClient.limit(1)]);
    return (await this.client.call<{ documents: Row[] }>('GET', `${this.path()}?${q}`)).documents[0] ?? null;
  }
  private meta(row: Row): ProjectFile { return { name: row.path, path: row.path, size: row.size, mtime: Date.parse(row.createdAt), kind: 'image', mime: row.mime, type: 'file' }; }
  async write(projectId: string, relative: string, bytes: Uint8Array, mime: string): Promise<ProjectFile> {
    relative = normalizeSafeProjectFilePath(relative);
    if (!mime.startsWith('image/') || bytes.byteLength > 30_000_000 || !bytes.byteLength) throw new CanvasStateError(400, 'CANVAS_INVALID_IMAGE', 'Image exceeds cloud bucket limits');
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const existing = await this.row(projectId, relative);
    if (existing) {
      if (existing.sha256 !== sha256) throw new CanvasStateError(409, 'CANVAS_IMAGE_CONTENT_CHANGED', 'Cloud image path already contains different content');
      return this.meta(existing);
    }
    const fileId = `img-${sha256.slice(0, 30)}`;
    try { await this.client.upload(this.bucketId, fileId, relative.split('/').pop()!, bytes, mime); }
    catch (error) { if (!(error instanceof CanvasStateError && error.status === 409)) throw error; }
    const row: Row = { $id: `m-${createHash('sha256').update(`${projectId}\0${relative}`).digest('hex').slice(0, 30)}`, canvasId: projectId, path: relative, fileId, mime, size: bytes.byteLength, sha256, createdAt: new Date().toISOString() };
    const { $id, ...data } = row;
    try { await this.client.call('POST', this.path(), { documentId: $id, data: { ...data, kind: 'image' } }); }
    catch (error) {
      if (!(error instanceof CanvasStateError && error.status === 409)) throw error;
      const winner = await this.row(projectId, relative);
      if (!winner || winner.sha256 !== sha256) throw new CanvasStateError(409, 'CANVAS_IMAGE_CONTENT_CHANGED', 'Concurrent cloud image write changed the target');
      return this.meta(winner);
    }
    return this.meta(row);
  }
  async open(projectId:string,relative:string):Promise<CloudImageSource|null> {
    relative=normalizeSafeProjectFilePath(relative);
    const row=await this.row(projectId,relative);
    if(!row||!row.mime.startsWith('image/'))return null;
    const key=JSON.stringify([projectId,relative,row.fileId,row.sha256]);
    const read=()=>this.originals.get(key,async()=>{
      const buffer=Buffer.from(await this.client.download(`/storage/buckets/${enc(this.bucketId)}/files/${enc(row.fileId)}/download`));
      if(buffer.byteLength!==row.size||createHash('sha256').update(buffer).digest('hex')!==row.sha256)throw new CanvasStateError(502,'CANVAS_IMAGE_CONTENT_CHANGED','Cloud image integrity check failed');
      return buffer;
    });
    return {file:this.meta(row),revision:row.sha256,read,preview:({width,fit})=>{
      if(!Number.isInteger(width)||width<16||width>2048)throw new CanvasStateError(400,'BAD_REQUEST','Invalid image preview width');
      return this.previews.get(JSON.stringify([key,width,fit,'webp-v1']),async()=>{
        if(fit==='cover'){
          // Use the instance's official image transformation endpoint for list thumbnails.
          // Older deployments/large files may not support previews: derive from the same
          // authorized original then. Auth failures are never bypassed by this fallback.
          try {
            const bytes=Buffer.from(await this.client.download(`/storage/buckets/${enc(this.bucketId)}/files/${enc(row.fileId)}/preview?width=${width}&height=${width}&output=webp&quality=78`));
            const meta=await sharp(bytes,{limitInputPixels:80_000_000}).metadata();
            if(meta.format!=='webp'||!meta.width||!meta.height||meta.width>width||meta.height>width)throw new Error('Invalid upstream preview');
            return bytes;
          }catch(error){if(error instanceof CanvasStateError&&(error.status===401||error.status===403))throw error;}
        }
        return sharp(await read(),{animated:false,limitInputPixels:80_000_000}).rotate().resize(width,width,{fit,withoutEnlargement:true}).webp({quality:78,effort:2}).timeout({seconds:10}).toBuffer();
      });
    }};
  }
  async read(projectId: string, relative: string) {
    const source=await this.open(projectId,relative);
    return source?{buffer:await source.read(),file:source.file}:null;
  }
  async list(projectId: string) {
    const q = AppwriteClient.query([AppwriteClient.eq('canvasId', projectId), AppwriteClient.eq('kind', 'image'), AppwriteClient.limit(5000)]);
    const result = await this.client.call<{ documents: Row[]; total: number }>('GET', `${this.path()}?${q}`);
    if (result.total > result.documents.length) throw new CanvasStateError(503, 'CANVAS_CAPABILITY_UNAVAILABLE', 'Cloud image listing exceeds the supported page limit');
    return result.documents.map(row => this.meta(row));
  }
}
