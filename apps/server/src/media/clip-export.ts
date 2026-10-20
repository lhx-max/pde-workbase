import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { ClipEditorExportOptions, ClipEditorTimeline, ClipEditorTimelineClip } from '@bezier/contracts';
import { clipCompositionDuration, compareClipPaintOrder } from '@bezier/contracts';

const OUTPUT_WIDTH = 1280;
const OUTPUT_HEIGHT = 720;
const OUTPUT_FPS = 30;
const MAX_EXPORT_SECONDS = 60 * 60;

function bounded(value: unknown, min: number, max: number, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error(`invalid ${label}`);
  return value;
}

export function validateClipEditorTimeline(value: unknown): ClipEditorTimeline {
  const timeline = value as Partial<ClipEditorTimeline> | null;
  if (!timeline || timeline.version !== 1 || !Array.isArray(timeline.clips)) throw new Error('timeline.version=1 and clips[] are required');
  if (timeline.clips.length === 0) throw new Error('timeline has no clips');
  if (timeline.clips.length > 200) throw new Error('timeline exceeds the 200 clip limit');
  const clips = timeline.clips.map((candidate, index) => {
    const clip = candidate as Partial<ClipEditorTimelineClip>;
    if (!['image', 'video', 'audio'].includes(String(clip.kind))) throw new Error(`clip ${index + 1} has an invalid kind`);
    if (typeof clip.path !== 'string' || !clip.path.trim()) throw new Error(`clip ${index + 1} has no project path`);
    for (const [name, number] of [['start', clip.start], ['sourceIn', clip.sourceIn], ['duration', clip.duration]] as const) {
      if (typeof number !== 'number' || !Number.isFinite(number) || number < 0) throw new Error(`clip ${index + 1} has an invalid ${name}`);
    }
    if (clip.duration! < 0.25) throw new Error(`clip ${index + 1} is shorter than 0.25 seconds`);
    if (clip.volume !== undefined && (!Number.isFinite(clip.volume) || clip.volume < 0 || clip.volume > 1)) throw new Error(`clip ${index + 1} has an invalid volume`);
    if (clip.playbackRate !== undefined) bounded(clip.playbackRate, 0.5, 2, 'playbackRate');
    if (clip.fit !== undefined && !['contain', 'cover'].includes(clip.fit)) throw new Error(`clip ${index + 1} has an invalid fit`);
    if (clip.track !== undefined && (!Number.isInteger(clip.track) || clip.track < 0 || clip.track > 7)) throw new Error(`clip ${index + 1} has an invalid track`);
    for (const key of ['fadeIn', 'fadeOut'] as const) if (clip[key] !== undefined) bounded(clip[key], 0, 3600, key);
    if (clip.sourceDuration !== undefined) {
      bounded(clip.sourceDuration, 0, 86400, 'sourceDuration');
      if (clip.kind !== 'image' && clip.sourceIn! >= clip.sourceDuration) throw new Error('clip starts outside source duration');
      if (clip.kind !== 'image' && !clip.loop && clip.sourceIn! + clip.duration! * (clip.playbackRate || 1) > clip.sourceDuration + 0.01) throw new Error('clip exceeds source duration');
    }
    const visual = clip.visual;
    if (visual) {
      for (const key of ['x', 'y'] as const) if (visual[key] !== undefined) bounded(visual[key], -100, 100, key);
      for (const key of ['width', 'height'] as const) if (visual[key] !== undefined) bounded(visual[key], 1, 200, key);
      if (visual.rotation !== undefined) bounded(visual.rotation, -180, 180, 'rotation');
      if (visual.opacity !== undefined) bounded(visual.opacity, 0, 1, 'opacity');
      if (visual.animation !== undefined && !['none', 'fade', 'slide'].includes(visual.animation)) throw new Error('invalid animation');
      if (visual.animationDuration !== undefined) bounded(visual.animationDuration, 0.05, 10, 'animationDuration');
      if (visual.adjustments) {
        bounded(visual.adjustments.brightness ?? 0, -100, 100, 'brightness');
        bounded(visual.adjustments.contrast ?? 100, 0, 200, 'contrast');
        bounded(visual.adjustments.saturation ?? 100, 0, 200, 'saturation');
        bounded(visual.adjustments.blur ?? 0, 0, 20, 'blur');
      }
      if (visual.crop) {
        for (const key of ['top', 'right', 'bottom', 'left'] as const) bounded(visual.crop[key], 0, 45, `crop.${key}`);
      }
    }
    return {
      id: String(clip.id || `clip-${index + 1}`),
      kind: clip.kind as ClipEditorTimelineClip['kind'],
      name: String(clip.name || path.basename(clip.path)),
      path: clip.path,
      mimeType: String(clip.mimeType || 'application/octet-stream'),
      start: clip.start!,
      sourceIn: clip.sourceIn!,
      duration: clip.duration!,
      volume: clip.volume ?? 1,
      muted: clip.muted === true,
      fit: clip.fit || 'contain',
      track: clip.track || 0,
      ...(visual ? { visual } : {}),
      ...(clip.fadeIn !== undefined ? { fadeIn: clip.fadeIn } : {}),
      ...(clip.fadeOut !== undefined ? { fadeOut: clip.fadeOut } : {}),
      ...(clip.playbackRate !== undefined ? { playbackRate: clip.playbackRate } : {}),
      ...(clip.loop === true ? { loop: true } : {}),
      ...(typeof clip.sourceDuration === 'number' ? { sourceDuration: clip.sourceDuration } : {}),
    };
  });
  if (timeline.markers !== undefined && (!Array.isArray(timeline.markers) || timeline.markers.length > 500)) throw new Error('invalid markers');
  const markers = (timeline.markers || []).map((marker, index) => {
    if (!marker || typeof marker.id !== 'string' || !marker.id || typeof marker.label !== 'string' || marker.label.length > 80) throw new Error(`invalid marker ${index + 1}`);
    bounded(marker.time, 0, 3600, 'marker time');
    return marker;
  });
  if (new Set(markers.map(marker => marker.id)).size !== markers.length) throw new Error('marker ids must be unique');
  if (timeline.trackStates !== undefined && (!Array.isArray(timeline.trackStates) || timeline.trackStates.length > 16)) throw new Error('invalid track states');
  const trackStates = (timeline.trackStates || []).map(track => {
    if (!track || !['visual', 'audio'].includes(track.kind) || !Number.isInteger(track.index) || track.index < 0 || track.index > 7) throw new Error('invalid track state');
    return { kind: track.kind, index: track.index, locked: track.locked === true, muted: track.muted === true, solo: track.solo === true };
  });
  if (new Set(trackStates.map(track => `${track.kind}:${track.index}`)).size !== trackStates.length) throw new Error('track states must be unique');
  const duration = clipCompositionDuration({ clips });
  if (duration > MAX_EXPORT_SECONDS) throw new Error('timeline exceeds the 60 minute export limit');
  if (new Set(clips.map(clip => clip.id)).size !== clips.length) throw new Error('clip ids must be unique');
  const width = timeline.width ?? OUTPUT_WIDTH;
  const height = timeline.height ?? OUTPUT_HEIGHT;
  if (![width, height].every(size => Number.isInteger(size) && size >= 64 && size <= 3840 && size % 2 === 0)) throw new Error('output dimensions must be even integers from 64 to 3840');
  return { version: 1, clips, markers, trackStates, width, height, playhead: typeof timeline.playhead === 'number' ? timeline.playhead : 0 };
}

function enabledTrack(timeline: ClipEditorTimeline, clip: ClipEditorTimelineClip): boolean {
  const kind = clip.kind === 'audio' ? 'audio' : 'visual';
  const states = (timeline.trackStates || []).filter(track => track.kind === kind);
  const state = states.find(track => track.index === (clip.track || 0));
  const hasSolo = states.some(track => track.solo);
  return !state?.muted && (!hasSolo || Boolean(state?.solo));
}

export function buildClipEditorFfmpegArgs(
  timeline: ClipEditorTimeline,
  sources: ReadonlyMap<string, string>,
  outputPath: string,
  videoAudioPaths: ReadonlySet<string> = new Set(),
  options: ClipEditorExportOptions = { format: 'mp4', quality: 'standard', fps: 30 },
): string[] {
  const width = timeline.width || OUTPUT_WIDTH;
  const height = timeline.height || OUTPUT_HEIGHT;
  const duration = clipCompositionDuration(timeline);
  const fps = options.fps || OUTPUT_FPS;
  const args = ['-y', '-filter_complex_threads', '1', '-f', 'lavfi', '-i', `color=c=black:s=${width}x${height}:r=${fps}:d=${duration.toFixed(3)}`];
  const inputIndices = new Map<string, number>();
  timeline.clips.forEach((clip, index) => {
    const source = sources.get(clip.path);
    if (!source) throw new Error(`project media not found: ${clip.path}`);
    if (clip.kind === 'image') args.push('-loop', '1', '-t', clip.duration.toFixed(3), '-i', source);
    else {
      if (clip.loop) args.push('-stream_loop', '-1');
      args.push('-ss', clip.sourceIn.toFixed(3), '-t', (clip.duration * (clip.playbackRate || 1)).toFixed(3), '-i', source);
    }
    inputIndices.set(clip.id, index + 1);
  });
  const filters: string[] = ['[0:v]null[vbase]'];
  let videoBase = 'vbase';
  timeline.clips.filter(clip => clip.kind !== 'audio' && enabledTrack(timeline, clip)).sort(compareClipPaintOrder).forEach((clip, index) => {
    const input = inputIndices.get(clip.id)!;
    const v = clip.visual || {};
    const w = Math.max(2, Math.round(width*(v.width ?? 100)/100/2)*2);
    const h = Math.max(2, Math.round(height*(v.height ?? 100)/100/2)*2);
    const fit = clip.fit === 'cover' ? `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}`
      : `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=black`;
    const rate = clip.kind === 'video' ? clip.playbackRate || 1 : 1;
    const adjustments = v.adjustments;
    const effects: string[] = [fit];
    if (adjustments && (adjustments.brightness || (adjustments.contrast ?? 100) !== 100 || (adjustments.saturation ?? 100) !== 100)) {
      effects.push(`eq=brightness=${((adjustments.brightness || 0) / 100).toFixed(3)}:contrast=${((adjustments.contrast ?? 100) / 100).toFixed(3)}:saturation=${((adjustments.saturation ?? 100) / 100).toFixed(3)}`);
    }
    if (adjustments?.blur) effects.push(`gblur=sigma=${adjustments.blur.toFixed(2)}`);
    effects.push('format=rgba', 'setsar=1', `setpts=(PTS-STARTPTS)/${rate.toFixed(3)}`);
    if (v.crop) {
      const c = v.crop;
      const left = Math.floor(w*c.left/100); const top = Math.floor(h*c.top/100);
      effects.push(`crop=${Math.max(1,Math.floor(w*(1-(c.left+c.right)/100)))}:${Math.max(1,Math.floor(h*(1-(c.top+c.bottom)/100)))}:${left}:${top}`, `pad=${w}:${h}:${left}:${top}:color=black@0`);
    }
    if (v.rotation) effects.push(`rotate=${v.rotation}*PI/180:ow=rotw(${v.rotation}*PI/180):oh=roth(${v.rotation}*PI/180):c=none`);
    if (v.opacity !== undefined) effects.push(`colorchannelmixer=aa=${v.opacity}`);
    const anim = Math.min(clip.duration/2, v.animationDuration ?? 0.5);
    if (v.animation && v.animation !== 'none') effects.push(`fade=t=in:st=0:d=${anim}:alpha=1`, `fade=t=out:st=${clip.duration-anim}:d=${anim}:alpha=1`);
    effects.push(`setpts=PTS+${clip.start.toFixed(3)}/TB`);
    const slide = v.animation === 'slide' ? `+${width*0.1}*(1-min(1,max(0,(t-${clip.start})/${anim})))-${width*0.1}*(1-min(1,max(0,(${clip.start+clip.duration}-t)/${anim})))` : '';
    filters.push(`[${input}:v]${effects.join(',')}[v${index}]`);
    filters.push(`[${videoBase}][v${index}]overlay=x='${width*(v.x ?? 0)/100}+(${w}-overlay_w)/2${slide}':y='${height*(v.y ?? 0)/100}+(${h}-overlay_h)/2':eof_action=pass:enable='gte(t,${clip.start.toFixed(3)})*lt(t,${(clip.start + clip.duration).toFixed(3)})'[ov${index}]`);
    videoBase = `ov${index}`;
  });
  const audio = timeline.clips.filter(clip => enabledTrack(timeline, clip) && !clip.muted && (clip.volume ?? 1) > 0 && (clip.kind === 'audio' || (clip.kind === 'video' && videoAudioPaths.has(clip.path))));
  audio.forEach((clip, index) => {
    const input = inputIndices.get(clip.id)!;
    const delay = Math.round(clip.start * 1_000);
    const fades = `${clip.fadeIn ? `,afade=t=in:st=0:d=${Math.min(clip.duration,clip.fadeIn)}` : ''}${clip.fadeOut ? `,afade=t=out:st=${Math.max(0,clip.duration-clip.fadeOut)}:d=${Math.min(clip.duration,clip.fadeOut)}` : ''}`;
    filters.push(`[${input}:a]atempo=${(clip.playbackRate || 1).toFixed(3)},atrim=0:${clip.duration.toFixed(3)},asetpts=PTS-STARTPTS,volume=${(clip.volume ?? 1).toFixed(3)}${fades},adelay=${delay}|${delay}[a${index}]`);
  });
  if (audio.length) {
    filters.push(`${audio.map((_, index) => `[a${index}]`).join('')}amix=inputs=${audio.length}:duration=longest:normalize=0,apad=whole_dur=${duration.toFixed(3)}[aout]`);
  }

  args.push('-filter_complex', filters.join(';'), '-map', `[${videoBase}]`);
  if (audio.length) args.push('-map', '[aout]', '-c:a', 'aac', '-b:a', '192k');
  const quality = options.quality === 'draft' ? { preset: 'ultrafast', crf: '28' }
    : options.quality === 'high' ? { preset: 'medium', crf: '17' }
      : { preset: 'veryfast', crf: '20' };
  args.push('-t', duration.toFixed(3), '-r', String(fps), '-c:v', 'libx264', '-threads', '2', '-preset', quality.preset, '-crf', quality.crf, '-pix_fmt', 'yuv420p', '-movflags', '+faststart', outputPath);
  return args;
}

function run(command: string, args: readonly string[], runtime: { signal?: AbortSignal; duration?: number; onProgress?: (progress: number) => void } = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    if (runtime.signal?.aborted) return reject(new Error('导出已取消'));
    const child = spawn(command, ['-progress', 'pipe:2', '-nostats', ...args], { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      runtime.signal?.removeEventListener('abort', abort);
      error ? reject(error) : resolve();
    };
    const abort = () => { child.kill('SIGTERM'); finish(new Error('导出已取消')); };
    runtime.signal?.addEventListener('abort', abort, { once: true });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', chunk => {
      stderr = `${stderr}${chunk}`.slice(-12_000);
      const matches = String(chunk).matchAll(/out_time_(?:us|ms)=(\d+)/g);
      for (const match of matches) {
        if (runtime.duration) runtime.onProgress?.(Math.max(0, Math.min(0.99, Number(match[1]) / 1_000_000 / runtime.duration)));
      }
    });
    child.once('error', error => finish(new Error((error as NodeJS.ErrnoException).code === 'ENOENT'
      ? '未找到 FFmpeg。请安装 FFmpeg，或设置 BEZIER_FFMPEG_PATH。'
      : `FFmpeg 启动失败：${error.message}`)));
    child.once('close', code => code === 0 ? finish() : finish(new Error(runtime.signal?.aborted ? '导出已取消' : `FFmpeg 导出失败（退出码 ${code}）：${stderr.trim().split('\n').at(-1) || 'unknown error'}`)));
  });
}

export async function renderClipEditorTimeline(args: {
  timeline: ClipEditorTimeline;
  sources: ReadonlyMap<string, string>;
  ffmpegPath?: string;
  /** HTTP service always injects its data-root temporary directory. */
  runtimeDir?: string;
  options?: ClipEditorExportOptions;
  signal?: AbortSignal;
  onProgress?: (progress: number) => void;
}): Promise<Buffer> {
  const temporaryRoot = args.runtimeDir ? path.join(args.runtimeDir, 'clip-export-temp') : os.tmpdir();
  await mkdir(temporaryRoot, {recursive:true});
  const directory = await mkdtemp(path.join(temporaryRoot, 'canvas-clip-export-'));
  const output = path.join(directory, 'output.mp4');
  try {
    const ffmpeg = args.ffmpegPath || process.env.BEZIER_FFMPEG_PATH || 'ffmpeg';
    const probe = path.basename(ffmpeg).replace(/^ffmpeg/, 'ffprobe');
    const ffprobe = ffmpeg.includes(path.sep) ? path.join(path.dirname(ffmpeg), probe) : probe;
    const videoAudioPaths = new Set<string>();
    for (const clip of args.timeline.clips.filter(clip => clip.kind === 'video' && !clip.muted)) {
      if (videoAudioPaths.has(clip.path)) continue;
      const hasAudio = await new Promise<boolean>((resolve, reject) => {
        const child = spawn(ffprobe, ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=index', '-of', 'csv=p=0', args.sources.get(clip.path)!], { stdio: ['ignore', 'pipe', 'pipe'] });
        let output = '';
        child.stdout.on('data', chunk => { output += String(chunk); });
        child.once('error', error => reject(new Error(`无法读取视频声音：${error.message}`)));
        child.once('close', code => code === 0 ? resolve(Boolean(output.trim())) : reject(new Error(`无法读取视频素材：${clip.name}`)));
      });
      if (hasAudio) videoAudioPaths.add(clip.path);
    }
    const options = args.options || { format: 'mp4', quality: 'standard', fps: 30 };
    const duration = clipCompositionDuration(args.timeline);
    await run(ffmpeg, buildClipEditorFfmpegArgs(args.timeline, args.sources, output, videoAudioPaths, options), { ...(args.signal ? { signal: args.signal } : {}), duration, onProgress: progress => { args.onProgress?.(progress * (options.format === 'mp4' ? 1 : 0.9)); } });
    if (options.format === 'mp4') {
      args.onProgress?.(1);
      return await readFile(output);
    }
    const still = path.join(directory, `output.${options.format}`);
    const capture = Math.max(0, Math.min(duration - 0.001, options.stillTime ?? args.timeline.playhead ?? 0));
    await run(ffmpeg, ['-y', '-ss', capture.toFixed(3), '-i', output, '-frames:v', '1', ...(options.format === 'webp' ? ['-quality', options.quality === 'high' ? '95' : options.quality === 'draft' ? '70' : '85'] : []), still], args.signal ? { signal: args.signal } : {});
    args.onProgress?.(1);
    return await readFile(still);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
