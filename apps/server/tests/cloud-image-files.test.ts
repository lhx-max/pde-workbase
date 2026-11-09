import { createHash } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { CloudImageFiles } from '../src/storage/cloud-image-files.js';
import { AppwriteClient } from '../src/storage/appwrite-client.js';
import { AppwriteCanvasAssetStore } from '../src/storage/canvas-appwrite-assets.js';

function fixture() {
  const rows: Record<string, any>[] = [], files = new Map<string, Uint8Array>();
  const client = new AppwriteClient({ endpoint: 'https://cloud.example/v1', projectId: 'p', sessionCookie: 'test' });
  vi.spyOn(client, 'upload').mockImplementation(async (_bucket, id, _name, bytes) => { files.set(id, bytes); return { $id: id }; });
  vi.spyOn(client, 'call').mockImplementation(async (method, _path, body) => {
    if (method === 'GET') return { documents: rows, total: rows.length } as never;
    const data = body as { documentId: string; data: Record<string, unknown> };
    rows.push({ $id: data.documentId, ...data.data }); return {} as never;
  });
  vi.spyOn(client, 'download').mockImplementation(async path => files.get(path.split('/').at(-2)!)!);
  return { client, rows, files, storage: () => new CloudImageFiles(client, 'db', 'bucket') };
}
it('stores authoritative bytes/index remotely and a fresh storage instance reads the exact bytes', async () => {
  const f = fixture(), bytes = Buffer.from('actual-image-bytes');
  const saved = await f.storage().write('canvas-a', 'outputs/image.png', bytes, 'image/png');
  expect(saved.name).toBe('outputs/image.png'); expect(f.rows[0]!.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
  const restored = await f.storage().read('canvas-a', saved.name);
  expect(restored?.buffer).toEqual(bytes);
  await expect(f.storage().write('canvas-a', saved.name, Buffer.from('other'), 'image/png')).rejects.toMatchObject({ status: 409 });
  expect(f.client.upload).toHaveBeenCalledTimes(1);
});
it('rejects cloud failure, corruption and unsafe paths instead of falling back to project disk', async () => {
  const f = fixture();
  await f.storage().write('a', 'image.png', Buffer.from('bytes'), 'image/png');
  vi.mocked(f.client.download).mockResolvedValueOnce(Buffer.from('corrupt'));
  await expect(f.storage().read('a', 'image.png')).rejects.toMatchObject({ status: 502 });
  await expect(f.storage().write('a', '../outside.png', Buffer.from('bytes'), 'image/png')).rejects.toThrow();
  vi.mocked(f.client.call).mockRejectedValue(new Error('cloud unavailable'));
  await expect(f.storage().read('a', 'image.png')).rejects.toThrow('cloud unavailable');
});
it('returns an authorized project preview URL rather than exposing a cookie-dependent bucket URL',async()=>{
 const f=fixture(),bytes=Buffer.from('image bytes');
 const assets=new AppwriteCanvasAssetStore(f.client,'db','bucket','canvas-a');
 const image=await assets.putImage(bytes);
 expect(image.src).toBe(`/api/projects/canvas-a/files/${image.path}`);
 expect(image.src).not.toContain('cloud.example');
 expect((await assets.putImage(bytes)).src).toBe(image.src);
});
it('revalidates cloud metadata but deduplicates immutable originals and preview work',async()=>{
 const f=fixture();const source=await (await import('sharp')).default({create:{width:800,height:400,channels:3,background:'#80b090'}}).png().toBuffer();
 const storage=f.storage();await storage.write('a','image.png',source,'image/png');
 const opened=await storage.open('a','image.png');expect(opened).not.toBeNull();
 const results=await Promise.all(Array.from({length:5},()=>opened!.preview({width:256,fit:'inside'})));
 expect(f.client.download).toHaveBeenCalledTimes(1);expect(results.every(value=>value===results[0])).toBe(true);
 const meta=await (await import('sharp')).default(results[0]).metadata();expect([meta.width,meta.height]).toEqual([256,128]);
 const again=await storage.open('a','image.png');await again!.preview({width:128,fit:'inside'});
 expect(f.client.download).toHaveBeenCalledTimes(1);
 await expect(storage.read('a','../outside.png')).rejects.toThrow();
 vi.mocked(f.client.call).mockRejectedValue(new Error('metadata authorization revoked'));
 await expect(storage.open('a','image.png')).rejects.toThrow('metadata authorization revoked');
});
it('uses official thumbnail bytes without downloading the original, and never falls back on denied access',async()=>{
 const f=fixture(),sharp=(await import('sharp')).default;
 const source=await sharp({create:{width:800,height:400,channels:3,background:'#80b090'}}).png().toBuffer();
 const thumbnail=await sharp(source).resize(64,64,{fit:'cover'}).webp().toBuffer();
 const storage=f.storage();await storage.write('a','image.png',source,'image/png');
 vi.mocked(f.client.download).mockImplementation(async route=>{expect(route).toContain('/preview?');return thumbnail;});
 const opened=await storage.open('a','image.png');
 await Promise.all([opened!.preview({width:64,fit:'cover'}),opened!.preview({width:64,fit:'cover'})]);
 expect(f.client.download).toHaveBeenCalledTimes(1);
 vi.mocked(f.client.download).mockRejectedValueOnce(Object.assign(new (await import('@bezier/canvas-core')).CanvasStateError(403,'CANVAS_FORBIDDEN','denied')));
 await expect(opened!.preview({width:128,fit:'cover'})).rejects.toMatchObject({status:403});
 expect(f.client.download).toHaveBeenCalledTimes(2);
});
it('does not retain failed originals or reuse a prior version after metadata changes',async()=>{
 const f=fixture();const storage=f.storage();await storage.write('a','image.png',Buffer.from('one'),'image/png');
 vi.mocked(f.client.download).mockRejectedValueOnce(new Error('network unavailable'));
 await expect(storage.read('a','image.png')).rejects.toThrow('network unavailable');
 expect((await storage.read('a','image.png'))?.buffer.toString()).toBe('one');
 f.rows[0]!.sha256=createHash('sha256').update('two').digest('hex');
 f.files.set(String(f.rows[0]!.fileId),Buffer.from('two'));
 expect((await storage.read('a','image.png'))?.buffer.toString()).toBe('two');
 expect(f.client.download).toHaveBeenCalledTimes(3);
});
