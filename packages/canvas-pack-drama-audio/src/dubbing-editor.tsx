import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CardRenderProps } from '@bezier/canvas-card-sdk';
import { demoMediaUrl, demoProjectOf, synthesizeDemoLines } from './demo-adapter';
import { readDramaAudioData } from './edl';
import { buildPlaybackPlan } from './playback-plan';
import type { DramaAudioSegment } from './types';

interface RewriteLine {
  id: string;
  text: string;
  videoStartMs: number | null;
  videoEndMs: number | null;
}

const styles: Record<string, React.CSSProperties> = {
  root: { display: 'flex', flexDirection: 'column', gap: 12, padding: 12, fontSize: 12, color: 'var(--text-primary, #202124)', background: 'var(--bg-app, #fff)' },
  row: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  panel: { display: 'flex', flexDirection: 'column', gap: 8, padding: 10, border: '1px solid var(--border-default, #ddd)', borderRadius: 8 },
  input: { width: 90, padding: 4, border: '1px solid var(--border-default, #ddd)', borderRadius: 4, color: 'inherit', background: 'var(--bg-app, #fff)' },
  button: { padding: '5px 9px', border: '1px solid var(--border-default, #ddd)', borderRadius: 5, background: 'var(--bg-app, #fff)', color: 'inherit', cursor: 'pointer' },
  hint: { color: 'var(--text-secondary, #666)', lineHeight: 1.6 },
  warning: { color: '#b45309', lineHeight: 1.6 },
  error: { color: '#cf2e2e', lineHeight: 1.6, fontWeight: 600 },
  track: { position: 'relative', height: 46, overflow: 'hidden', borderRadius: 5, background: 'var(--bg-secondary, #f3f4f6)' },
  block: { position: 'absolute', top: 5, height: 36, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', padding: '2px 4px', borderRadius: 4, border: '1px solid #7c5cff', color: 'inherit', background: 'rgba(124,92,255,.15)', cursor: 'pointer' },
};

function finiteMs(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function readLines(value: unknown): RewriteLine[] {
  if (!Array.isArray(value)) return [];
  return value.filter((line): line is RewriteLine => !!line && typeof line === 'object'
    && typeof line.id === 'string' && typeof line.text === 'string');
}

function validWindow(start: unknown, end: unknown): boolean {
  return finiteMs(start) && finiteMs(end) && end > start;
}

function excessMs(segment: DramaAudioSegment): number {
  if (!validWindow(segment.videoStartMs, segment.videoEndMs)
    || !validWindow(segment.startMs, segment.endMs) || !finiteMs(segment.gapMs)) return 0;
  return Math.max(0, segment.endMs - segment.startMs - Math.max(0, segment.videoEndMs! - segment.videoStartMs! - segment.gapMs));
}

function NumberField({ label, value, max, onChange }: {
  label: string;
  value: number | null;
  max?: number;
  onChange: (value: number | null) => void;
}) {
  return <label style={styles.row}>{label}<input style={styles.input} type="number" min={0} max={max} step={max === 2 ? 0.05 : 1}
    value={finiteMs(value) ? value : ''} onChange={event => {
      if (!event.target.value) { onChange(null); return; }
      const next = Number(event.target.value);
      if (finiteMs(next) && (max === undefined || next <= max)) onChange(next);
    }} /></label>;
}

export function DubbingEditor({ node, onPatch }: CardRenderProps) {
  const data = useMemo(() => readDramaAudioData(node), [node.data]);
  const raw = node.data ?? {};
  const project = demoProjectOf(node);
  const lines = readLines(raw.rewriteLines);
  const confirmed = Array.isArray(raw.confirmedLineIds) ? raw.confirmedLineIds.filter((id): id is string => typeof id === 'string') : [];
  const generatedTexts = raw.generatedLineTexts && typeof raw.generatedLineTexts === 'object' ? raw.generatedLineTexts as Record<string, unknown> : {};
  const rows = [...lines, ...data.segments.filter(segment => !lines.some(line => line.id === segment.id)).map(segment => ({ id: segment.id, text: segment.label, videoStartMs: segment.videoStartMs, videoEndMs: segment.videoEndMs }))];
  const video = useRef<HTMLVideoElement>(null);
  const context = useRef<AudioContext | null>(null);
  const buffers = useRef(new Map<string, AudioBuffer>());
  const sources = useRef(new Set<{ source: AudioBufferSourceNode; gain: GainNode }>());
  const loadController = useRef<AbortController | null>(null);
  const generationController = useRef<AbortController | null>(null);
  const epoch = useRef(0);
  const loaded = useRef(false);
  const latest = useRef({ data, raw, project, onPatch });
  latest.current = { data, raw, project, onPatch };
  const [originalAudio, setOriginalAudio] = useState(false);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [loadStatus, setLoadStatus] = useState('尚未载入配音');
  const [generationStatus, setGenerationStatus] = useState('');
  const [error, setError] = useState('');
  const [currentMs, setCurrentMs] = useState(0);
  const [mediaDurationMs, setMediaDurationMs] = useState(0);
  const videoDurationMs = finiteMs(data.videoDurationMs) && data.videoDurationMs > 0 ? data.videoDurationMs : mediaDurationMs;
  let videoUrl: string | undefined;
  try { videoUrl = project && data.videoRef ? demoMediaUrl(project, data.videoRef) : undefined; }
  catch { videoUrl = undefined; }

  const stop = useCallback(() => {
    epoch.current += 1;
    for (const item of sources.current) {
      item.source.onended = null;
      try { item.source.stop(); } catch {}
      item.source.disconnect();
      item.gain.disconnect();
    }
    sources.current.clear();
  }, []);

  const schedule = useCallback(() => {
    stop();
    const element = video.current;
    const audioContext = context.current;
    if (!loaded.current || !element || element.paused || element.ended || element.seeking
      || element.readyState < 3 || !audioContext || audioContext.state !== 'running') return;
    const rate = element.playbackRate;
    if (!Number.isFinite(rate) || rate <= 0) return;
    const at = audioContext.currentTime;
    try {
      for (const item of buildPlaybackPlan(latest.current.data, element.currentTime * 1000)) {
        const buffer = buffers.current.get(item.audioRef);
        if (!buffer) throw new Error(`配音未载入：${item.audioRef}，请重新载入试听`);
        const offset = item.offsetMs / 1000;
        const duration = Math.min(item.durationMs / 1000, buffer.duration - offset);
        if (duration <= 0) continue;
        const source = audioContext.createBufferSource();
        const gain = audioContext.createGain();
        const active = { source, gain };
        sources.current.add(active);
        source.buffer = buffer;
        source.playbackRate.setValueAtTime(rate, at);
        gain.gain.setValueAtTime(item.gain, at);
        source.connect(gain);
        gain.connect(audioContext.destination);
        source.onended = () => {
          source.disconnect();
          gain.disconnect();
          sources.current.delete(active);
        };
        const when = at + item.delayMs / 1000 / rate;
        source.start(when, offset, duration);
        source.stop(when + duration / rate);
      }
    } catch (reason) {
      stop();
      setError(reason instanceof Error ? reason.message : '配音排程失败');
    }
  }, [stop]);

  const resumeAndSchedule = useCallback(() => {
    const audioContext = context.current;
    if (!audioContext || !loaded.current) return;
    const token = epoch.current;
    void audioContext.resume().then(() => {
      if (epoch.current === token) schedule();
    }).catch(reason => setError(reason instanceof Error ? reason.message : 'WebAudio 无法启用'));
  }, [schedule]);

  useEffect(() => {
    const element = video.current;
    if (!element) return;
    const update = () => setCurrentMs(element.currentTime * 1000);
    const seeking = () => { stop(); update(); };
    const metadata = () => {
      setMediaDurationMs(Number.isFinite(element.duration) ? element.duration * 1000 : 0);
      update();
    };
    const listeners: [string, () => void][] = [
      ['play', resumeAndSchedule], ['playing', resumeAndSchedule], ['pause', stop], ['ended', stop],
      ['seeking', seeking], ['seeked', resumeAndSchedule], ['ratechange', schedule], ['waiting', stop],
      ['timeupdate', update], ['loadedmetadata', metadata], ['durationchange', metadata],
    ];
    for (const [name, listener] of listeners) element.addEventListener(name, listener);
    return () => { for (const [name, listener] of listeners) element.removeEventListener(name, listener); stop(); };
  }, [videoUrl, resumeAndSchedule, schedule, stop]);

  useEffect(() => {
    if (video.current) { video.current.volume = originalAudio ? 1 : 0; video.current.muted = !originalAudio; }
  }, [originalAudio, videoUrl]);

  const decisionKey = JSON.stringify({ segments: data.segments, audioRef: data.audioRef, masterGain: data.masterGain });
  useEffect(() => { schedule(); }, [decisionKey, schedule]);

  useEffect(() => {
    stop();
    loadController.current?.abort();
    generationController.current?.abort();
    loaded.current = false;
    buffers.current.clear();
    setLoadStatus('尚未载入配音');
    setLoading(false);
    setGenerating(false);
    setCurrentMs(0);
    setMediaDurationMs(0);
  }, [project, node.id, videoUrl, stop]);

  useEffect(() => () => {
    stop();
    loadController.current?.abort();
    generationController.current?.abort();
    const audioContext = context.current;
    context.current = null;
    if (audioContext) void audioContext.close().catch(() => {});
  }, [stop]);

  function patch(changes: Record<string, unknown>) {
    const current = latest.current;
    current.onPatch({ data: { ...current.raw, stage: 'edit', ...changes } });
  }

  function editLine(id: string, text: string) {
    const current = latest.current;
    const rewriteLines = readLines(current.raw.rewriteLines).map(line => line.id === id ? { ...line, text } : line);
    const confirmedLineIds = Array.isArray(current.raw.confirmedLineIds) ? current.raw.confirmedLineIds.filter(value => value !== id) : [];
    patch({ rewriteLines, script: rewriteLines.map(line => line.text).join('\n'),
      segments: current.data.segments.map(segment => segment.id === id ? { ...segment, label: text } : segment), confirmedLineIds });
  }

  function editSegment(id: string, changes: Partial<DramaAudioSegment>) {
    const current = latest.current;
    const timing = 'videoStartMs' in changes || 'videoEndMs' in changes;
    const extra: Record<string, unknown> = timing ? {
      rewriteLines: readLines(current.raw.rewriteLines).map(line => line.id === id ? { ...line,
        ...('videoStartMs' in changes ? { videoStartMs: changes.videoStartMs } : {}),
        ...('videoEndMs' in changes ? { videoEndMs: changes.videoEndMs } : {}) } : line),
      confirmedLineIds: Array.isArray(current.raw.confirmedLineIds) ? current.raw.confirmedLineIds.filter(value => value !== id) : [],
    } : {};
    patch({ ...extra, segments: current.data.segments.map(segment => segment.id === id ? { ...segment, ...changes } : segment) });
  }

  async function loadAudio() {
    if (!project || loading) return;
    stop();
    loaded.current = false;
    loadController.current?.abort();
    const controller = new AbortController();
    loadController.current = controller;
    setLoading(true);
    setError('');
    setLoadStatus('正在载入各句真实音频…');
    try {
      if (typeof AudioContext === 'undefined') throw new Error('此浏览器不支持 WebAudio，试听不可用');
      const audioContext = context.current ?? new AudioContext();
      context.current = audioContext;
      await audioContext.resume();
      const refs = [...new Set(latest.current.data.segments.map(segment => segment.audioRefOverride ?? latest.current.data.audioRef).filter((ref): ref is string => ref !== null))];
      if (!refs.length) throw new Error('尚无逐句配音，请先生成');
      await Promise.all(refs.map(async ref => {
        if (buffers.current.has(ref)) return;
        const response = await fetch(demoMediaUrl(project, ref), { signal: controller.signal, redirect: 'error' });
        if (!response.ok) throw new Error(`音频读取失败 HTTP ${response.status}：${ref}`);
        const buffer = await audioContext.decodeAudioData(await response.arrayBuffer());
        if (controller.signal.aborted) return;
        buffers.current.set(ref, buffer);
      }));
      if (controller.signal.aborted) return;
      loaded.current = true;
      setLoadStatus(`已载入 ${refs.length} 个音频源；按视频时钟试听，不自动拉伸`);
      schedule();
    } catch (reason) {
      if (!controller.signal.aborted) {
        controller.abort();
        stop();
        setLoadStatus('配音载入失败');
        setError(reason instanceof Error ? reason.message : '配音载入失败');
      }
    } finally {
      if (loadController.current === controller) { loadController.current = null; setLoading(false); }
    }
  }

  async function generate() {
    if (!project || generating) return;
    const controller = new AbortController();
    generationController.current = controller;
    setGenerating(true);
    setError('');
    setGenerationStatus('正在提交逐句配音…');
    stop();
    loaded.current = false;
    setLoadStatus('生成后请重新载入配音试听');
    try {
      await synthesizeDemoLines(project, node.id, controller.signal, message => {
        if (!controller.signal.aborted) setGenerationStatus(message);
      });
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '逐句生成失败；不自动重试');
    } finally {
      if (generationController.current === controller) { generationController.current = null; setGenerating(false); }
    }
  }

  function seek(ms: number | null) {
    if (!video.current || !finiteMs(ms)) return;
    stop();
    video.current.currentTime = Math.min(ms, videoDurationMs || ms) / 1000;
    setCurrentMs(video.current.currentTime * 1000);
  }

  function blockStyle(start: number | null, end: number | null): React.CSSProperties | null {
    if (!validWindow(start, end) || videoDurationMs <= 0 || start! >= videoDurationMs) return null;
    return { ...styles.block, left: `${start! / videoDurationMs * 100}%`, width: `${(Math.min(end!, videoDurationMs) - start!) / videoDurationMs * 100}%` };
  }

  return <section className="nodrag nopan" style={styles.root} onPointerDown={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
    <strong>逐句配音编辑</strong>
    <div style={styles.hint}>视频是唯一主时钟。自动建议尚待逐句确认；静音不压缩视频，停顿保留在视频区间尾部。</div>
    {!project && <div style={styles.warning}>本地 demo 项目不可用；不会回退或模拟生成成功。</div>}
    {videoUrl ? <video ref={video} src={videoUrl} controls muted={!originalAudio} preload="metadata" style={{ width: '100%', maxHeight: 260, background: '#000', borderRadius: 6 }}
      onError={() => { stop(); setError('视频读取失败，无法同步试听'); }} /> : <div style={styles.warning}>未绑定有效视频工程文件</div>}
    <div style={styles.row}>
      <label><input type="checkbox" checked={originalAudio} onChange={event => setOriginalAudio(event.target.checked)} />播放视频原声（默认关闭）</label>
      <NumberField label="总音量 0..2" value={data.masterGain} max={2} onChange={value => { if (value !== null) patch({ masterGain: value }); }} />
      <span>{Math.round(currentMs)} / {Math.round(videoDurationMs)} ms</span>
    </div>
    <div style={styles.row}>
      <button style={styles.button} disabled={!project || !rows.length || generating || loading} onClick={() => void generate()}>逐句生成配音</button>
      {generating && <button style={styles.button} onClick={() => { generationController.current?.abort(); setGenerationStatus('已请求停止；已有音频保留，未完成结果不自动重试'); }}>停止生成</button>}
      <button style={styles.button} disabled={!project || !videoUrl || loading || generating} onClick={() => void loadAudio()}>载入配音试听</button>
    </div>
    <div role="status" style={styles.hint}>{loadStatus}{generationStatus && <div>{generationStatus}</div>}</div>
    {error && <div role="alert" style={styles.error}>{error}</div>}
    <div style={styles.panel}>
      <div style={styles.row}><strong>统一视频时间轴</strong><span style={styles.hint}>0 — {Math.round(videoDurationMs)} ms；上下轨共用比例，点击台词定位</span></div>
      <div>视频画面</div>
      <div style={styles.track}>{data.captions.map(caption => {
        const style = blockStyle(caption.startMs, caption.endMs);
        return style && <button key={caption.id} style={style} title={caption.text} onClick={() => seek(caption.startMs)}>{caption.text}</button>;
      })}<div style={{ position: 'absolute', left: `${videoDurationMs > 0 ? Math.min(100, currentMs / videoDurationMs * 100) : 0}%`, top: 0, bottom: 0, width: 2, background: '#dc2626', pointerEvents: 'none' }} /></div>
      <div>逐句配音（空白区不播放）</div>
      <div style={styles.track}>{rows.map(line => {
        const segment = data.segments.find(item => item.id === line.id);
        const start = segment ? segment.videoStartMs : line.videoStartMs;
        const end = segment ? segment.videoEndMs : line.videoEndMs;
        const style = blockStyle(start, end);
        return style && <button key={line.id} style={{ ...style, borderColor: segment && excessMs(segment) > 0 ? '#cf2e2e' : '#0c87fa', background: segment?.muted ? '#ddd' : 'rgba(12,135,250,.15)' }}
          title={`${line.text}；${confirmed.includes(line.id) ? '已人工确认' : '自动建议尚待确认'}`} onClick={() => seek(start)}>{line.text}{segment?.muted ? '（静音）' : ''}</button>;
      })}<div style={{ position: 'absolute', left: `${videoDurationMs > 0 ? Math.min(100, currentMs / videoDurationMs * 100) : 0}%`, top: 0, bottom: 0, width: 2, background: '#dc2626', pointerEvents: 'none' }} /></div>
    </div>
    {rows.map((line, index) => {
      const segment = data.segments.find(item => item.id === line.id);
      const start = segment ? segment.videoStartMs : line.videoStartMs;
      const end = segment ? segment.videoEndMs : line.videoEndMs;
      const over = segment ? excessMs(segment) : 0;
      const stale = !!segment && generatedTexts[line.id] !== line.text;
      const buffer = segment ? buffers.current.get(segment.audioRefOverride ?? data.audioRef ?? '') : undefined;
      return <div key={line.id} style={styles.panel}>
        <div style={styles.row}><strong>第 {index + 1} 句 · {line.id}</strong><span style={styles.hint}>{confirmed.includes(line.id) ? '已人工确认视频区间' : '自动建议尚待确认'}</span>
          <button style={styles.button} disabled={!validWindow(start, end)} onClick={() => seek(start)}>定位视频</button>
          <button style={styles.button} disabled={!validWindow(start, end) || confirmed.includes(line.id)} onClick={() => {
            const ids = latest.current.raw.confirmedLineIds;
            patch({ confirmedLineIds: [...new Set([...(Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : []), line.id])] });
          }}>确认本句区间</button>
        </div>
        <label>台词标签<textarea value={line.text} style={{ ...styles.input, display: 'block', width: '100%', boxSizing: 'border-box', minHeight: 52 }}
          onChange={event => editLine(line.id, event.target.value)} /></label>
        {stale && <div style={styles.warning}>台词与生成记录不一致，配音已过期或来源未确认；改稿只改变文字，旧音频未变化，请重新生成。</div>}
        {!segment && <div style={styles.hint}>本句尚未生成真实音频。</div>}
        <div style={styles.row}>
          <NumberField label="视频 startMs" value={start} onChange={value => editSegment(line.id, { videoStartMs: value })} />
          <NumberField label="视频 endMs" value={end} onChange={value => editSegment(line.id, { videoEndMs: value })} />
        </div>
        {segment && <>
          <div style={styles.row}>
            <NumberField label="源截取 startMs" value={segment.startMs} onChange={value => { if (value !== null) editSegment(line.id, { startMs: value }); }} />
            <NumberField label="源截取 endMs" value={segment.endMs} onChange={value => { if (value !== null) editSegment(line.id, { endMs: value }); }} />
            <NumberField label="段后 gapMs" value={segment.gapMs} onChange={value => { if (value !== null) editSegment(line.id, { gapMs: value }); }} />
            <NumberField label="gain 0..2" value={segment.gain} max={2} onChange={value => { if (value !== null) editSegment(line.id, { gain: value }); }} />
            <label><input type="checkbox" checked={segment.muted} onChange={event => editSegment(line.id, { muted: event.target.checked })} />muted（保留视频时钟）</label>
          </div>
          <div style={{ ...styles.hint, overflowWrap: 'anywhere' }}>音频源：{segment.audioRefOverride ?? data.audioRef ?? '未绑定'}</div>
          {!validWindow(start, end) && <div style={styles.warning}>视频区间未对齐或非法，本句不播放。</div>}
          {!validWindow(segment.startMs, segment.endMs) && <div style={styles.error}>源截取区间非法，本句不播放。</div>}
          {over > 0 && <div style={styles.error}>时长超限 {Math.ceil(over)} ms：试听会截断超出视频允许区间的音频，不自动拉伸，未宣称对齐。</div>}
          {finiteMs(end) && videoDurationMs > 0 && end > videoDurationMs && <div style={styles.error}>视频区间超过视频总时长，请调整。</div>}
          {buffer && segment.endMs > buffer.duration * 1000 + 1 && <div style={styles.error}>源截取超过真实音频时长 {Math.round(buffer.duration * 1000)} ms；试听仅播放实际存在的音频。</div>}
        </>}
      </div>;
    })}
  </section>;
}
