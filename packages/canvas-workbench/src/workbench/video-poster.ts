// Poster extraction is bounded independently of how many nodes are visible.
// No video decoder is retained after success, error, timeout or cancellation.
import { canvasPreviewUrl } from './CanvasPreviewImage';
export const VIDEO_POSTER_CONCURRENCY = 2;
const posters = new Map<string, string>();
const queue: Array<() => void> = [];
let active = 0;
function drain() { while (active < VIDEO_POSTER_CONCURRENCY && queue.length) queue.shift()!(); }

export async function loadVideoPoster(src: string, signal: AbortSignal): Promise<string> {
  const derivative = canvasPreviewUrl(src, 'poster', 512);
  if (derivative !== src) {
    try {
      const response = await fetch(derivative, { signal: AbortSignal.any([signal, AbortSignal.timeout(12_000)]) });
      if (!response.ok) throw new Error('poster unavailable');
      const blob = await response.blob();
      if (blob.size > 2 * 1024 * 1024) throw new Error('poster too large');
      return await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => signal.aborted ? reject(new Error('Poster cancelled')) : resolve(String(reader.result));
        reader.onerror = () => reject(new Error('Poster unavailable'));
        reader.readAsDataURL(blob);
      });
    } catch { if (signal.aborted) throw new Error('Poster cancelled'); }
  }
  return extractVideoPoster(src, signal);
}

function extractVideoPoster(src: string, signal: AbortSignal): Promise<string> {
  const cached = posters.get(src);
  if (cached) { posters.delete(src); posters.set(src, cached); return Promise.resolve(cached); }
  return new Promise((resolve, reject) => {
    let cancel = () => {
      const index = queue.indexOf(start);
      if (index >= 0) queue.splice(index, 1);
      signal.removeEventListener('abort', onAbort);
      reject(new Error('Poster cancelled'));
    };
    const onAbort = () => cancel();
    const start = () => {
      active++;
      const video = document.createElement('video');
      let finished = false;
      const finish = (poster?: string) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
        video.onloadeddata = null; video.onerror = null;
        video.pause(); video.removeAttribute('src'); video.load();
        active--;
        if (poster) {
          posters.set(src, poster);
          while (posters.size > 24) posters.delete(posters.keys().next().value!);
          resolve(poster);
        } else reject(new Error('Poster unavailable'));
        drain();
      };
      cancel = () => finish();
      const timer = setTimeout(() => finish(), 8_000);
      video.muted = true; video.playsInline = true; video.crossOrigin = 'anonymous'; video.preload = 'auto';
      video.onloadeddata = () => {
        try {
          if (!video.videoWidth || !video.videoHeight) { finish(); return; }
          const canvas = document.createElement('canvas');
          const scale = Math.min(1, 480 / Math.max(video.videoWidth, video.videoHeight));
          canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
          canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
          const context = canvas.getContext('2d');
          if (!context) { finish(); return; }
          context.drawImage(video, 0, 0, canvas.width, canvas.height);
          finish(canvas.toDataURL('image/jpeg', .75));
        } catch { finish(); }
      };
      video.onerror = () => finish();
      video.src = src;
    };
    if (signal.aborted) { reject(new Error('Poster cancelled')); return; }
    signal.addEventListener('abort', onAbort, { once: true });
    queue.push(start); drain();
  });
}
