import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

/** Process-local LRU. Deduplicates work, bounds queue + bytes, never caches failures. */
export class PreviewCache {
  private values = new Map<string, { body: Buffer; expires: number }>();
  private pending = new Map<string, Promise<Buffer>>();
  private waiting: Array<() => void> = [];
  private active = 0;
  private bytes = 0;
  constructor(private maxBytes: number, private concurrency = 2, private maxPending = 24) {}

  async get(key: string, create: () => Promise<Buffer>): Promise<Buffer> {
    const cached = this.values.get(key);
    if (cached) {
      this.values.delete(key);
      if (cached.expires > Date.now()) { this.values.set(key, cached); return cached.body; }
      this.bytes -= cached.body.length;
    }
    const pending = this.pending.get(key);
    if (pending) return pending;
    if (this.pending.size >= this.maxPending) throw new Error('preview queue full');
    const job = (async () => {
      if (this.active >= this.concurrency) await new Promise<void>(resolve => this.waiting.push(resolve));
      else this.active++;
      try {
        const body = await create();
        if (body.length <= this.maxBytes) {
          this.values.set(key, { body, expires: Date.now() + 10 * 60_000 });
          this.bytes += body.length;
          while (this.bytes > this.maxBytes || this.values.size > 256) {
            const oldest = this.values.keys().next().value!;
            this.bytes -= this.values.get(oldest)!.body.length;
            this.values.delete(oldest);
          }
        }
        return body;
      } finally {
        const next = this.waiting.shift();
        if (next) next(); else this.active--;
      }
    })();
    this.pending.set(key, job);
    try { return await job; } finally { this.pending.delete(key); }
  }
}

const images = new PreviewCache(32 * 1024 * 1024);
const videos = new PreviewCache(64 * 1024 * 1024, 1, 8);
export type CanvasPreviewKind = 'image' | 'poster' | 'video';
export const PREVIEW_WIDTHS = [128, 256, 512, 1024, 2048] as const;

export async function createCanvasPreview(input: {
  filePath: string; size: number; mtime: number; mime: string;
  kind: CanvasPreviewKind; width: number; runtimeDir: string; fit?: 'inside' | 'cover';
}): Promise<Buffer> {
  const { kind, width } = input;
  const legacyCover = kind === 'image' && input.fit === 'cover' && Number.isInteger(width) && width >= 16 && width <= 512;
  if (!legacyCover && !PREVIEW_WIDTHS.some(value => value === width)) throw new Error('invalid preview width');
  if (kind === 'image' ? !input.mime.startsWith('image/') : !input.mime.startsWith('video/')) throw new Error('invalid preview media');
  if (input.size > (kind === 'image' ? 64 : 1024) * 1024 * 1024) throw new Error('preview source too large');
  const key = JSON.stringify([input.runtimeDir, input.filePath, input.size, input.mtime, kind, width, input.fit]);
  if (kind === 'image') return images.get(key, () => sharp(input.filePath, { animated: false, limitInputPixels: 80_000_000 })
    .rotate().resize(width, width, { fit: input.fit ?? 'inside', withoutEnlargement: true })
    .webp({ quality: 78, effort: 2 }).timeout({ seconds: 10 }).toBuffer());
  return videos.get(key, async () => {
    const root = path.join(input.runtimeDir, 'canvas-preview-temp');
    await mkdir(root, { recursive: true });
    const directory = await mkdtemp(path.join(root, 'render-'));
    const output = path.join(directory, kind === 'poster' ? 'poster.jpg' : 'preview.mp4');
    try {
      await new Promise<void>((resolve, reject) => {
        const args = ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y', '-threads', '1',
          '-protocol_whitelist', 'file,pipe', '-i', input.filePath, '-map', '0:v:0',
          '-vf', `scale=w='min(${width},iw)':h='min(${width},ih)':force_original_aspect_ratio=decrease:force_divisible_by=2`,
          '-threads', '1'];
        args.push(...(kind === 'poster' ? ['-frames:v', '1', '-q:v', '4'] : [
          '-map', '0:a:0?', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '30', '-pix_fmt', 'yuv420p',
          '-c:a', 'aac', '-b:a', '64k', '-movflags', '+faststart',
        ]), output);
        const child = spawn(process.env.BEZIER_FFMPEG_PATH || 'ffmpeg', args, { stdio: 'ignore' });
        let failure: Error | undefined;
        const stop = (message: string) => { failure = new Error(message); child.kill('SIGKILL'); };
        const timer = setTimeout(() => stop('preview timed out'), kind === 'poster' ? 10_000 : 60_000);
        const sizeCheck = setInterval(() => { void stat(output).then(info => {
          if (info.size > 24 * 1024 * 1024) stop('preview exceeds byte budget');
        }).catch(() => {}); }, 250);
        const cleanup = () => { clearTimeout(timer); clearInterval(sizeCheck); };
        child.once('error', err => { cleanup(); reject(err); });
        child.once('close', code => { cleanup(); if (failure || code !== 0) reject(failure || new Error('preview conversion failed')); else resolve(); });
      });
      const info = await stat(output);
      if (!info.size || info.size > 24 * 1024 * 1024) throw new Error('invalid preview output');
      return await readFile(output);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
}
