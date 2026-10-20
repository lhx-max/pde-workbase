const WAVEFORM_SAMPLE_COUNT = 1_200;
const VIDEO_FRAME_COUNT = 12;
const CACHE_LIMIT = 64;
const VIDEO_FRAME_WIDTH = 112;
const VIDEO_FRAME_HEIGHT = 64;
const MAX_AUDIO_DECODE_BYTES = 96 * 1024 * 1024;

export type ClipMediaVisual = {
  dataUrl: string;
  duration?: number;
};

type CacheEntry = Promise<ClipMediaVisual | null>;

const visualCache = new Map<string, CacheEntry>();
const videoQueue: Array<() => void> = [];
let activeVideoJobs = 0;

function touchCache(key: string, entry: CacheEntry) {
  visualCache.delete(key);
  visualCache.set(key, entry);
  while (visualCache.size > CACHE_LIMIT) {
    const oldest = visualCache.keys().next().value as string | undefined;
    if (!oldest) break;
    visualCache.delete(oldest);
  }
}

function runVideoJob<T>(job: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const run = () => {
      activeVideoJobs += 1;
      void job().then(resolve, reject).finally(() => {
        activeVideoJobs -= 1;
        videoQueue.shift()?.();
      });
    };
    if (activeVideoJobs < 2) run();
    else videoQueue.push(run);
  });
}

export function downsampleWaveform(
  channel: Float32Array,
  sampleCount = WAVEFORM_SAMPLE_COUNT,
): Float32Array {
  const count = Math.max(1, Math.floor(sampleCount));
  const peaks = new Float32Array(count);
  if (channel.length === 0) return peaks;
  const blockSize = Math.max(1, Math.ceil(channel.length / count));
  let maximum = 0;
  for (let index = 0; index < count; index += 1) {
    const start = index * blockSize;
    const end = Math.min(channel.length, start + blockSize);
    let peak = 0;
    for (let cursor = start; cursor < end; cursor += 1) {
      peak = Math.max(peak, Math.abs(channel[cursor] || 0));
    }
    peaks[index] = peak;
    maximum = Math.max(maximum, peak);
  }
  if (maximum > 0) {
    for (let index = 0; index < peaks.length; index += 1) {
      peaks[index] = peaks[index]! / maximum;
    }
  }
  return peaks;
}

export function mediaSourceWindow(
  sourceIn: number,
  duration: number,
  sourceDuration?: number,
  playbackRate = 1,
): { leftPercent: number; widthPercent: number } {
  const visibleDuration = Math.max(0.001, duration * playbackRate);
  const total = Math.max(visibleDuration, sourceDuration || visibleDuration);
  return {
    leftPercent: -(Math.max(0, sourceIn) / visibleDuration) * 100,
    widthPercent: (total / visibleDuration) * 100,
  };
}

function canvasDataUrl(canvas: HTMLCanvasElement, type: string, quality?: number): string | null {
  try {
    return canvas.toDataURL(type, quality);
  } catch {
    return null;
  }
}

function waveformDataUrl(peaks: Float32Array): string | null {
  const canvas = document.createElement('canvas');
  canvas.width = WAVEFORM_SAMPLE_COUNT;
  canvas.height = 56;
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.fillStyle = 'rgba(20, 28, 38, 0.72)';
  const middle = canvas.height / 2;
  for (let index = 0; index < peaks.length; index += 3) {
    const height = Math.max(1, peaks[index]! * (middle - 3));
    context.fillRect(index, middle - height, 2, height * 2);
  }
  return canvasDataUrl(canvas, 'image/png');
}

async function decodeWaveform(url: string): Promise<ClipMediaVisual | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > MAX_AUDIO_DECODE_BYTES) return null;
    const AudioContextCtor = window.AudioContext;
    if (!AudioContextCtor) return null;
    const context = new AudioContextCtor();
    try {
      const buffer = await context.decodeAudioData(await response.arrayBuffer());
      const dataUrl = waveformDataUrl(downsampleWaveform(buffer.getChannelData(0)));
      return dataUrl ? { dataUrl, duration: buffer.duration } : null;
    } finally {
      void context.close();
    }
  } catch {
    return null;
  }
}

function waitForVideoEvent(video: HTMLVideoElement, eventName: 'loadedmetadata' | 'seeked') {
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      window.clearTimeout(timer);
      video.removeEventListener(eventName, onSuccess);
      video.removeEventListener('error', onError);
    };
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error(`video ${eventName} timeout`));
    }, 8_000);
    const onSuccess = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error(`video ${eventName} failed`));
    };
    video.addEventListener(eventName, onSuccess);
    video.addEventListener('error', onError);
  });
}

function drawVideoCover(
  context: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  x: number,
) {
  const sourceRatio = video.videoWidth / video.videoHeight;
  const targetRatio = VIDEO_FRAME_WIDTH / VIDEO_FRAME_HEIGHT;
  let sx = 0;
  let sy = 0;
  let sw = video.videoWidth;
  let sh = video.videoHeight;
  if (sourceRatio > targetRatio) {
    sw = video.videoHeight * targetRatio;
    sx = (video.videoWidth - sw) / 2;
  } else {
    sh = video.videoWidth / targetRatio;
    sy = (video.videoHeight - sh) / 2;
  }
  context.drawImage(video, sx, sy, sw, sh, x, 0, VIDEO_FRAME_WIDTH, VIDEO_FRAME_HEIGHT);
}

async function decodeVideoStrip(url: string): Promise<ClipMediaVisual | null> {
  return runVideoJob(async () => {
    const video = document.createElement('video');
    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;
    video.src = url;
    try {
      await waitForVideoEvent(video, 'loadedmetadata');
      const duration = Number.isFinite(video.duration) ? video.duration : 0;
      if (!duration || !video.videoWidth || !video.videoHeight) return null;
      const canvas = document.createElement('canvas');
      canvas.width = VIDEO_FRAME_WIDTH * VIDEO_FRAME_COUNT;
      canvas.height = VIDEO_FRAME_HEIGHT;
      const context = canvas.getContext('2d');
      if (!context) return null;
      for (let index = 0; index < VIDEO_FRAME_COUNT; index += 1) {
        video.currentTime = Math.min(
          Math.max(0, duration - 0.04),
          ((index + 0.5) / VIDEO_FRAME_COUNT) * duration,
        );
        await waitForVideoEvent(video, 'seeked');
        drawVideoCover(context, video, index * VIDEO_FRAME_WIDTH);
      }
      const dataUrl = canvasDataUrl(canvas, 'image/jpeg', 0.72);
      return dataUrl ? { dataUrl, duration } : null;
    } catch {
      return null;
    } finally {
      video.removeAttribute('src');
      video.load();
    }
  });
}

export function getClipMediaVisual(
  url: string,
  kind: 'video' | 'audio',
): Promise<ClipMediaVisual | null> {
  const key = `${kind}:${url}`;
  const cached = visualCache.get(key);
  if (cached) {
    touchCache(key, cached);
    return cached;
  }
  const entry = kind === 'audio' ? decodeWaveform(url) : decodeVideoStrip(url);
  touchCache(key, entry);
  return entry;
}
