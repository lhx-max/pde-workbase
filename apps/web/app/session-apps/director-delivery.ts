import { demoMediaUrl } from './demo-adapter';
import { encodeWav, exportSubtitles, linesOf, renderMix } from './director-media';
import { directorOf } from './director-edits';
import type { EditData, ListenMode, TimeRange } from './director-edits';

async function readResponse(project: string, ref: string, signal: AbortSignal) {
  const response = await fetch(demoMediaUrl(project, ref), { signal, redirect: 'error' });
  if (!response.ok) throw new Error(`读取工程素材失败 HTTP ${response.status}`);
  return response.blob();
}

export async function exportHandoff(data: EditData, project: string, duration: number, mode: ListenMode, signal: AbortSignal) {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  const media = Object.create(null) as Record<string, string>;
  if (typeof data.videoRef === 'string') {
    const path = '主视频/' + data.videoRef.split('/').at(-1);
    zip.file(path, await readResponse(project, data.videoRef, signal));
    media[data.videoRef] = path;
  }
  const refs = new Set<string>();
  const segments: { audioRefOverride?: unknown }[] = Array.isArray(data.segments) ? data.segments : [];
  for (const segment of segments) {
    const ref = segment.audioRefOverride ?? data.audioRef;
    if (typeof ref === 'string' && ref) refs.add(ref);
  }
  const hasVoice = refs.size > 0;
  for (const note of directorOf(data).notes ?? []) for (const ref of note.audioRefs) refs.add(ref);
  for (const [index, ref] of [...refs].entries()) {
    if (media[ref]) continue;
    const path = `配音源/${index + 1}-${ref.split('/').at(-1)}`;
    zip.file(path, await readResponse(project, ref, signal));
    media[ref] = path;
  }
  if (linesOf(data).length) zip.file('台词.srt', await exportSubtitles(data, duration).arrayBuffer());
  const range = { startMs: 0, endMs: duration };
  if (hasVoice) {
    const voice = await renderMix(data, project, range, 'voice', signal);
    zip.file('配音轨.wav', await encodeWav(voice).arrayBuffer());
  }
  if (typeof data.directorBackgroundRef === 'string' && data.directorBackgroundRef) {
    const ref = data.directorBackgroundRef;
    if (!media[ref]) {
      const path = '背景音乐/' + ref.split('/').at(-1);
      zip.file(path, await readResponse(project, ref, signal));
      media[ref] = path;
    }
    const background = await renderMix(data, project, range, 'background', signal);
    zip.file('背景音乐轨.wav', await encodeWav(background).arrayBuffer());
  }
  if ((mode === 'original' || mode === 'mix') && data.videoRef) {
    const original = await renderMix(data, project, range, 'original', signal);
    zip.file('原声轨.wav', await encodeWav(original).arrayBuffer());
  }
  if (mode === 'mix') {
    const mix = await renderMix(data, project, range, mode, signal);
    zip.file('混音.wav', await encodeWav(mix).arrayBuffer());
  }
  zip.file('工程清单.json', JSON.stringify({ version: 1, project, durationMs: duration, listenMode: mode, media, data }, null, 2));
  signal.throwIfAborted();
  const blob = await zip.generateAsync({ type: 'blob' }, () => signal.throwIfAborted());
  signal.throwIfAborted();
  return blob;
}

function waitFor(video: HTMLVideoElement, event: 'loadeddata' | 'seeked', signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      video.removeEventListener(event, done);
      video.removeEventListener('error', fail);
      signal.removeEventListener('abort', abort);
    };
    const done = () => { cleanup(); resolve(); };
    const fail = () => { cleanup(); reject(new Error('导出时无法读取视频画面。')); };
    const abort = () => { cleanup(); reject(signal.reason); };
    signal.throwIfAborted();
    video.addEventListener(event, done, { once: true });
    video.addEventListener('error', fail, { once: true });
    signal.addEventListener('abort', abort, { once: true });
  });
}

function drawCaption(ctx: CanvasRenderingContext2D, text: string, width: number, height: number) {
  const size = Math.max(14, Math.round(width * 0.038));
  ctx.font = `600 ${size}px sans-serif`;
  ctx.textAlign = 'center';
  const lines: string[] = [];
  let line = '';
  for (const char of text.replace(/\s+/gu, ' ')) {
    if (line && ctx.measureText(line + char).width > width * 0.86) {
      lines.push(line);
      line = '';
    }
    line += char;
  }
  if (line) lines.push(line);
  ctx.lineWidth = Math.max(2, size * 0.15);
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#151723';
  ctx.fillStyle = '#fff';
  const lineHeight = size * 1.27;
  lines.forEach((row, index) => {
    const y = height * .92 - (lines.length - index - 1) * lineHeight;
    ctx.strokeText(row, width / 2, y);
    ctx.fillText(row, width / 2, y);
  });
}

export async function exportVideo(
  data: EditData, source: string, project: string, range: TimeRange, mode: ListenMode,
  captions: boolean, signal: AbortSignal, onProgress: (percent: number) => void,
) {
  const format = typeof MediaRecorder === 'undefined' ? undefined
    : ['video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4;codecs=avc1.420028,mp4a.40.2'].find(type => MediaRecorder.isTypeSupported(type));
  if (!source || !format) {
    throw new Error('此浏览器无法导出 MP4。可以使用剪辑交接包继续交付。');
  }
  const audio = new AudioContext();
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  let stream: MediaStream | undefined;
  let frame = 0;
  let lastPercent = -1;
  let recorder: MediaRecorder | undefined;
  try {
    await audio.resume();
    const ready = waitFor(video, 'loadeddata', signal);
    video.src = source;
    await ready;
    const safeRange = { ...range, endMs: Math.min(range.endMs, Math.round(video.duration * 1000)) };
    if (safeRange.startMs) {
      const seeked = waitFor(video, 'seeked', signal);
      video.currentTime = safeRange.startMs / 1000;
      await seeked;
    }
    const mix = await renderMix(data, project, safeRange, mode, signal);
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, 1080 / Math.min(video.videoWidth, video.videoHeight), 1920 / Math.max(video.videoWidth, video.videoHeight));
    canvas.width = Math.max(2, Math.floor(video.videoWidth * scale / 2) * 2);
    canvas.height = Math.max(2, Math.floor(video.videoHeight * scale / 2) * 2);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('浏览器无法创建视频导出画布。');
    const lines = captions ? linesOf(data) : [];
    function draw() {
      ctx!.drawImage(video, 0, 0, canvas.width, canvas.height);
      const row = lines.find(line => line.videoStartMs <= video.currentTime * 1000 && line.videoEndMs > video.currentTime * 1000);
      if (row) drawCaption(ctx!, row.text, canvas.width, canvas.height);
    }
    draw();
    const destination = audio.createMediaStreamDestination();
    const track = audio.createBufferSource();
    track.buffer = mix;
    track.connect(destination);
    stream = canvas.captureStream(30);
    for (const audioTrack of destination.stream.getAudioTracks()) stream.addTrack(audioTrack);
    const active = new MediaRecorder(stream, { mimeType: format, videoBitsPerSecond: 5_000_000, audioBitsPerSecond: 160_000 });
    recorder = active;
    const chunks: Blob[] = [];
    return await new Promise<Blob>((resolve, reject) => {
      function cleanup() {
        signal.removeEventListener('abort', abort);
        video.removeEventListener('error', fail);
        cancelAnimationFrame(frame);
      }
      function finish() {
        video.pause();
        if (active.state !== 'inactive') active.stop();
      }
      function fail() { cleanup(); finish(); reject(new Error('录制 MP4 失败。')); }
      function abort() { cleanup(); finish(); reject(signal.reason); }
      function tick() {
        draw();
        const elapsed = Math.max(0, video.currentTime * 1000 - safeRange.startMs);
        const percent = Math.min(100, Math.floor(elapsed / (safeRange.endMs - safeRange.startMs) * 100));
        if (percent !== lastPercent) { lastPercent = percent; onProgress(percent); }
        if (video.ended || video.currentTime * 1000 >= safeRange.endMs) finish();
        else frame = requestAnimationFrame(tick);
      }
      signal.throwIfAborted();
      signal.addEventListener('abort', abort, { once: true });
      video.addEventListener('error', fail, { once: true });
      active.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      active.onerror = fail;
      active.onstop = () => {
        cleanup();
        if (chunks.length) resolve(new Blob(chunks, { type: 'video/mp4' }));
        else reject(new Error('浏览器未生成 MP4 数据。'));
      };
      void video.play().then(() => {
        if (signal.aborted) return;
        active.start(1000);
        track.start();
        tick();
      }).catch(fail);
    });
  } finally {
    cancelAnimationFrame(frame);
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    stream?.getTracks().forEach(track => track.stop());
    video.pause();
    video.removeAttribute('src');
    video.load();
    await audio.close();
  }
}
