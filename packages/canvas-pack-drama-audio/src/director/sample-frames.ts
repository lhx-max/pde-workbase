import { REWRITE_FRAME_MAX_BYTES, type RewriteFrame } from '../rewrite';

function waitForVideo(video: HTMLVideoElement, event: string, signal: AbortSignal, start: () => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      video.removeEventListener(event, done);
      video.removeEventListener('error', failed);
      signal.removeEventListener('abort', aborted);
    };
    const done = () => { cleanup(); resolve(); };
    const failed = () => { cleanup(); reject(new Error('视频无法解码或采样失败')); };
    const aborted = () => { cleanup(); reject(new DOMException('停止等待', 'AbortError')); };
    const timer = setTimeout(failed, 15_000);
    video.addEventListener(event, done, { once: true });
    video.addEventListener('error', failed, { once: true });
    signal.addEventListener('abort', aborted, { once: true });
    if (signal.aborted) { aborted(); return; }
    try { start(); } catch (error) { cleanup(); reject(error); }
  });
}

export async function sampleVideoFrames(url: string, durationMs: number, signal: AbortSignal): Promise<RewriteFrame[]> {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  try {
    await waitForVideo(video, 'loadeddata', signal, () => { video.src = url; video.load(); });
    if (!Number.isFinite(video.duration) || Math.round(video.duration * 1000) !== durationMs || !video.videoWidth || !video.videoHeight) throw new Error('视频时长与已保存节点不同，请先保存正确时长');
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, 320 / Math.max(video.videoWidth, video.videoHeight));
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('浏览器无法抽取视频帧');
    const count = Math.min(12, durationMs);
    const frames: RewriteFrame[] = [];
    for (let index = 0; index < count; index += 1) {
      signal.throwIfAborted();
      const atMs = Math.floor(index * durationMs / count);
      if (video.currentTime !== atMs / 1000) await waitForVideo(video, 'seeked', signal, () => { video.currentTime = atMs / 1000; });
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      let image = '';
      for (const quality of [0.75, 0.55, 0.35, 0.15]) {
        image = canvas.toDataURL('image/jpeg', quality);
        const base64 = image.slice('data:image/jpeg;base64,'.length);
        if (base64.length / 4 * 3 - (base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0) <= REWRITE_FRAME_MAX_BYTES) break;
      }
      frames.push({ atMs, image });
    }
    return frames;
  } finally {
    video.pause();
    video.removeAttribute('src');
    video.load();
  }
}
