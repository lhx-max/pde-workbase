import { mkdtemp, rm, stat, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { execFile, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { createCanvasPreview, PreviewCache } from '../src/media/canvas-preview.js';

let directory = '';
afterEach(async () => { if (directory) await rm(directory, { recursive: true, force: true }); directory = ''; });

describe('bounded canvas previews', () => {
  it.skipIf(spawnSync(process.env.BEZIER_FFMPEG_PATH || 'ffmpeg', ['-version']).status !== 0)('creates a real small video and poster without changing the source', async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'canvas-preview-test-'));
    const filePath = path.join(directory, 'source.mp4');
    await promisify(execFile)(process.env.BEZIER_FFMPEG_PATH || 'ffmpeg', [
      '-nostdin', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=24',
      '-t', '1', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', filePath,
    ]);
    const source = await stat(filePath);
    const input = { filePath, size: source.size, mtime: source.mtimeMs, mime: 'video/mp4', width: 512, runtimeDir: directory };
    const poster = await createCanvasPreview({ ...input, kind: 'poster' });
    const metadata = await sharp(poster).metadata();
    expect([metadata.width, metadata.height]).toEqual([512, 288]);
    const video = await createCanvasPreview({ ...input, kind: 'video' });
    expect(video.length).toBeLessThan(source.size);
    expect(video.subarray(4, 8).toString()).toBe('ftyp');
    expect(await createCanvasPreview({ ...input, kind: 'video' })).toBe(video);
    expect((await stat(filePath)).mtimeMs).toBe(source.mtimeMs);
    expect(await readdir(path.join(directory, 'canvas-preview-temp'))).toEqual([]);
  });
  it('deduplicates pending work, limits queue, releases rejected jobs and evicts by byte size', async () => {
    const cache = new PreviewCache(4, 1, 2);
    let finish!: (value: Buffer) => void;
    let calls = 0;
    const first = cache.get('one', () => { calls++; return new Promise(resolve => { finish = resolve; }); });
    const same = cache.get('one', async () => { throw new Error('duplicate'); });
    const failed = cache.get('two', async () => { throw new Error('expected'); });
    const failure = expect(failed).rejects.toThrow('expected');
    await expect(cache.get('three', async () => Buffer.alloc(1))).rejects.toThrow('queue full');
    finish(Buffer.alloc(4));
    expect(await first).toBe(await same);
    await failure;
    await cache.get('two', async () => Buffer.alloc(4));
    await cache.get('one', async () => { calls++; return Buffer.alloc(4); });
    expect(calls).toBe(2);
  });

  it('preserves aspect ratio, bounds resolution and invalidates a changed file', async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'canvas-preview-test-'));
    const filePath = path.join(directory, 'wide.png');
    await writeFile(filePath, await sharp({ create: { width: 1600, height: 800, channels: 3, background: '#ff0000' } }).png().toBuffer());
    const source = await stat(filePath);
    const input = { filePath, size: source.size, mtime: source.mtimeMs, mime: 'image/png', kind: 'image' as const, width: 256, runtimeDir: directory };
    const first = await createCanvasPreview(input);
    const metadata = await sharp(first).metadata();
    expect([metadata.width, metadata.height, metadata.format]).toEqual([256, 128, 'webp']);
    expect(await createCanvasPreview(input)).toBe(first);
    await writeFile(filePath, await sharp({ create: { width: 1600, height: 800, channels: 3, background: '#0000ff' } }).png().toBuffer());
    const changed = await createCanvasPreview({ ...input, mtime: source.mtimeMs + 1 });
    expect(changed.equals(first)).toBe(false);
    await expect(createCanvasPreview({ ...input, width: 123 })).rejects.toThrow('invalid preview width');
    await expect(createCanvasPreview({ ...input, mime: 'text/html' })).rejects.toThrow('invalid preview media');
  });

  it('cleans conversion temporary files after invalid video input', async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'canvas-preview-test-'));
    const filePath = path.join(directory, 'bad.mp4');
    await writeFile(filePath, 'not a video');
    await expect(createCanvasPreview({ filePath, size: 11, mtime: 1, mime: 'video/mp4', kind: 'poster', width: 256, runtimeDir: directory })).rejects.toThrow();
    expect(await readdir(path.join(directory, 'canvas-preview-temp'))).toEqual([]);
  });
});
