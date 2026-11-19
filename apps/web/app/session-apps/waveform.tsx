'use client';

import { useEffect, useMemo, useState } from 'react';
import { demoMediaUrl } from './demo-adapter';
import styles from './workbench.module.css';

export type WavePeaks = { durationMs: number; min: Float32Array; max: Float32Array };

/** Each bucket contains the real extrema of every channel, without normalization. */
export function extractPeaks(channels: Float32Array[], sampleRate: number, buckets = 4096): WavePeaks {
  const length = channels[0]?.length ?? 0;
  const count = Math.min(buckets, length);
  const min = new Float32Array(count), max = new Float32Array(count);
  for (let bucket = 0; bucket < count; bucket++) {
    const from = Math.floor(bucket * length / count), to = Math.floor((bucket + 1) * length / count);
    for (const channel of channels) for (let index = from; index < to; index++) {
      const value = channel[index] ?? 0;
      if (Number.isFinite(value)) { min[bucket] = Math.min(min[bucket]!, value); max[bucket] = Math.max(max[bucket]!, value); }
    }
  }
  return { durationMs: length / sampleRate * 1000, min, max };
}

export function waveformPath(peaks: WavePeaks, offsetMs: number, spanMs: number, playableMs: number, gain = 1, columns = 300) {
  if (!peaks.durationMs || !spanMs) return '';
  const steps: string[] = [];
  for (let x = 0; x < columns; x++) {
    const elapsed = x / columns * spanMs;
    const time = offsetMs + elapsed;
    if (elapsed >= playableMs || time < 0 || time >= peaks.durationMs) continue;
    const start = Math.floor(time / peaks.durationMs * peaks.min.length);
    const end = Math.min(peaks.min.length, Math.max(start + 1, Math.ceil((time + spanMs / columns) / peaks.durationMs * peaks.min.length)));
    let lo = 0, hi = 0;
    for (let i = start; i < end; i++) { lo = Math.min(lo, peaks.min[i]!); hi = Math.max(hi, peaks.max[i]!); }
    const top = 50 - Math.min(1, hi * gain) * 46, bottom = 50 - Math.max(-1, lo * gain) * 46;
    steps.push(`M${(x / columns * 1000).toFixed(1)},${top.toFixed(1)}V${bottom.toFixed(1)}`);
  }
  return steps.join('');
}

const cache = new Map<string, Promise<WavePeaks>>();
let queue = Promise.resolve();
function loadPeaks(url: string): Promise<WavePeaks> {
  const existing = cache.get(url);
  if (existing) return existing;
  // Decode one source at a time to avoid a burst of full PCM buffers for a large project.
  const request = queue.then(async () => {
    const response = await fetch(url, { signal: AbortSignal.timeout(45_000) });
    if (!response.ok) throw new Error(`音源读取失败（${response.status}）`);
    const context = new OfflineAudioContext(1, 1, 24_000);
    const buffer = await context.decodeAudioData(await response.arrayBuffer());
    return extractPeaks(Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i)), buffer.sampleRate);
  });
  queue = request.then(() => undefined, () => undefined);
  cache.set(url, request);
  if (cache.size > 32) cache.delete(cache.keys().next().value!);
  request.catch(() => { if (cache.get(url) === request) cache.delete(url); });
  return request;
}

export function Waveform({ project, audioRef, offsetMs = 0, spanMs, playableMs = spanMs, gain = 1 }: {
  project: string; audioRef?: string | null; offsetMs?: number; spanMs: number; playableMs?: number; gain?: number;
}) {
  const [state, setState] = useState<{ url: string; peaks?: WavePeaks; error?: string }>();
  const url = audioRef ? demoMediaUrl(project, audioRef) : '';
  useEffect(() => {
    let disposed = false;
    if (url) loadPeaks(url).then(peaks => { if (!disposed) setState({ url, peaks }); }, error => { if (!disposed) setState({ url, error: error instanceof Error ? error.message : '浏览器无法解码此音源' }); });
    return () => { disposed = true; };
  }, [url]);
  const peaks = state?.url === url ? state.peaks : undefined;
  const path = useMemo(() => peaks ? waveformPath(peaks, offsetMs, spanMs, playableMs, gain) : '', [peaks, offsetMs, spanMs, playableMs, gain]);
  if (!url) return <span className={styles.waveStatus}>待生成音频</span>;
  if (!peaks) return <span className={styles.waveStatus} title={state?.url === url ? state.error : undefined}>{state?.url === url && state.error ? '波形不可用' : '分析波形…'}</span>;
  return <svg className={styles.waveform} viewBox="0 0 1000 100" preserveAspectRatio="none" aria-label="真实音频波形" data-source-duration-ms={Math.round(peaks.durationMs)}>
    <path d={path} stroke="currentColor" strokeWidth="1.4" fill="none" vectorEffect="non-scaling-stroke" />
  </svg>;
}
