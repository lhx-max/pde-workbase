import { demoProjectOf, demoMediaUrl, callDemoAction, synthesizeDemoScript } from './demo-adapter';
import React from 'react';
import type { CardRenderProps } from '@bezier/canvas-card-sdk';
import { alignShiftMs, readDramaAudioData, renderExportManifest, timelineOf, totalDurationMs, trimWindow } from './edl';
import { GAP_MS_MAX } from './schema';
import type { DramaAudioData, DramaAudioSegment } from './types';
import { VoicePicker } from './voice-picker';

/** 短剧配音编辑卡 v2：视频 + 配音双轨时间轴。
 * 上轨 = 视频画面区间（按 videoDurationMs 投影），下轨 = 台词配音段。
 * 支持点击选段、拖拽段边缘改配音区间（pointerup 提交 onPatch）、
 * 段级换配音源、段级视频对齐区间与偏差提示、改台词文本。
 * 只画卡身内容区；修改唯一入口 onPatch；样式内联 + 主题变量 fallback。 */

const styles = {
  root: { display: 'flex', flexDirection: 'column' as const, gap: 8, padding: '10px 12px', fontSize: 12, color: 'var(--text-primary, #1a1a1a)' },
  hint: { color: 'var(--text-tertiary, #8a8a8a)', lineHeight: 1.6 },
  row: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' as const },
  label: { color: 'var(--text-secondary, #5c5c5c)', fontSize: 11 },
  value: { color: 'var(--text-strong, #000)', fontVariantNumeric: 'tabular-nums' },
  button: {
    padding: '2px 8px', fontSize: 11, cursor: 'pointer', border: '1px solid var(--border-default, #d9d9d9)',
    borderRadius: 4, background: 'var(--bg-app, #fff)', color: 'var(--text-primary, #1a1a1a)',
  },
  buttonPrimary: {
    padding: '2px 10px', fontSize: 11, cursor: 'pointer', border: 'none', borderRadius: 4,
    background: 'var(--accent, #0c87fa)', color: 'var(--text-inverse, #fff)',
  },
  buttonWarn: {
    padding: '2px 8px', fontSize: 11, cursor: 'pointer', border: 'none', borderRadius: 4,
    background: 'var(--accent-soft, rgba(12,135,250,0.15))', color: 'var(--text-primary, #1a1a1a)',
  },
  input: {
    padding: '3px 6px', fontSize: 11, border: '1px solid var(--border-default, #d9d9d9)', borderRadius: 4,
    background: 'var(--bg-app, #fff)', color: 'var(--text-primary, #1a1a1a)', minWidth: 54, width: 64,
  },
  select: {
    padding: '3px 6px', fontSize: 11, border: '1px solid var(--border-default, #d9d9d9)', borderRadius: 4,
    background: 'var(--bg-app, #fff)', color: 'var(--text-primary, #1a1a1a)',
  },
  textarea: {
    width: '100%', minHeight: 56, padding: '6px 8px', fontSize: 11, lineHeight: 1.5,
    border: '1px solid var(--border-default, #d9d9d9)', borderRadius: 4, resize: 'vertical' as const,
    background: 'var(--bg-app, #fff)', color: 'var(--text-primary, #1a1a1a)',
  },
  panel: { border: '1px solid var(--border-subtle, #eee)', borderRadius: 6, padding: 8, display: 'flex', flexDirection: 'column' as const, gap: 6 },
  // 区域色编码（半透明 tint，深浅色主题均可读）：
  // 紫 = 视频画面 / 画面解析（captions）；蓝 = 台词段与配音编辑；
  // 橙 = 配音文档（生成产物）；青 = 段级换源。
  panelVideo: { border: '1px solid rgba(124,92,255,0.28)', borderLeft: '3px solid #7c5cff', borderRadius: 6, padding: 8, display: 'flex', flexDirection: 'column' as const, gap: 6, background: 'rgba(124,92,255,0.07)' },
  panelAudio: { border: '1px solid rgba(12,135,250,0.24)', borderLeft: '3px solid var(--accent, #0c87fa)', borderRadius: 6, padding: 8, display: 'flex', flexDirection: 'column' as const, gap: 6, background: 'rgba(12,135,250,0.05)' },
  panelDoc: { border: '1px solid rgba(232,146,34,0.30)', borderLeft: '3px solid #d48806', borderRadius: 6, padding: 8, display: 'flex', flexDirection: 'column' as const, gap: 6, background: 'rgba(232,146,34,0.06)' },
  badge: { fontSize: 10, padding: '1px 6px', borderRadius: 999, whiteSpace: 'nowrap' as const },
  badgeVideo: { fontSize: 10, padding: '1px 6px', borderRadius: 999, whiteSpace: 'nowrap' as const, background: 'rgba(124,92,255,0.15)', color: '#7c5cff' },
  badgeAudio: { fontSize: 10, padding: '1px 6px', borderRadius: 999, whiteSpace: 'nowrap' as const, background: 'rgba(12,135,250,0.12)', color: 'var(--accent, #0c87fa)' },
  badgeDoc: { fontSize: 10, padding: '1px 6px', borderRadius: 999, whiteSpace: 'nowrap' as const, background: 'rgba(232,146,34,0.14)', color: '#b87505' },
  badgeSource: { fontSize: 10, padding: '1px 6px', borderRadius: 999, whiteSpace: 'nowrap' as const, background: 'rgba(19,170,156,0.14)', color: '#0f8a7d' },
  labelVideo: { color: '#7c5cff', fontSize: 11 },
  labelDoc: { color: '#b87505', fontSize: 11 },
  labelSource: { color: '#0f8a7d', fontSize: 11 },
  shiftOk: { color: 'var(--text-tertiary, #8a8a8a)', fontSize: 11 },
  shiftWarn: { color: '#d48806', fontSize: 11, fontWeight: 600 },
  shiftBad: { color: '#cf2e2e', fontSize: 11, fontWeight: 600 },
  footer: { color: 'var(--text-quaternary, #aaa)', fontSize: 10 },
};

const TRACK_HEIGHT = 56;
const EDGE_GRAB_PX = 7;

function nextSegmentId(data: DramaAudioData): string {
  let max = -1;
  for (const segment of data.segments) {
    const match = /^seg-(\d+)$/.exec(segment.id);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `seg-${max + 1}`;
}

function formatMs(ms: number): string {
  if (ms >= 60_000) return `${Math.floor(ms / 60_000)}m${Math.round((ms % 60_000) / 1000)}s`;
  if (ms >= 1_000) return `${(ms / 1_000).toFixed(1)}s`;
  return `${Math.round(ms)}ms`;
}

interface DragState {
  segmentId: string;
  edge: 'start' | 'end';
  startMs: number;
  endMs: number;
}

function TimelineCanvas({ data, selectedId, onSelect, onSpanCommit }: {
  data: DramaAudioData;
  selectedId: string | null;
  onSelect: (segmentId: string) => void;
  onSpanCommit: (segmentId: string, span: { startMs: number; endMs: number }) => void;
}) {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const dragRef = React.useRef<DragState | null>(null);
  const [dragSpan, setDragSpan] = React.useState<{ segmentId: string; startMs: number; endMs: number } | null>(null);
  const hasVideo = data.videoRef !== null && data.videoDurationMs > 0;
  const timeline = React.useMemo(() => timelineOf(data), [data]);
  const trim = trimWindow(data);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    const cssWidth = parent ? Math.max(160, parent.clientWidth) : 320;
    const dpr = window.devicePixelRatio || 1;
    const cssHeight = hasVideo ? TRACK_HEIGHT * 2 + 14 : TRACK_HEIGHT;
    canvas.width = Math.max(1, Math.round(cssWidth * dpr));
    canvas.height = Math.round(cssHeight * dpr);
    canvas.style.width = '100%';
    canvas.style.height = `${cssHeight}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, cssWidth, cssHeight);

    const computed = getComputedStyle(canvas);
    const accent = computed.getPropertyValue('--accent').trim() || '#0c87fa';
    const soft = computed.getPropertyValue('--accent-soft').trim() || 'rgba(12,135,250,0.15)';
    const border = computed.getPropertyValue('--border-default').trim() || '#d9d9d9';
    const track = computed.getPropertyValue('--bg-panel').trim() || computed.getPropertyValue('--bg-surface').trim() || '#f5f5f5';
    const tertiary = computed.getPropertyValue('--text-tertiary').trim() || '#8a8a8a';
    const videoTint = 'rgba(124,92,255,0.10)';
    const videoFill = 'rgba(124,92,255,0.22)';
    const videoBorder = 'rgba(124,92,255,0.45)';
    const mutedTint = 'rgba(128,128,128,0.35)';
    const dim = 'rgba(0,0,0,0.55)';
    const warn = '#d48806';

    const audioTop = hasVideo ? TRACK_HEIGHT + 14 : 8;
    const audioBottom = audioTop + TRACK_HEIGHT - 16;

    ctx.fillStyle = track;
    ctx.fillRect(0, 0, cssWidth, cssHeight);

    const drawTicks = (y: number, durationMs: number) => {
      ctx.fillStyle = tertiary;
      ctx.font = '9px sans-serif';
      for (let index = 0; index <= 4; index += 1) {
        const ratio = index / 4;
        ctx.fillText(formatMs(ratio * durationMs), Math.min(cssWidth - 34, Math.max(2, ratio * cssWidth)), y);
      }
    };

    if (hasVideo) {
      const videoTop = 8;
      const videoBottom = videoTop + TRACK_HEIGHT - 16;
      ctx.fillStyle = videoTint;
      ctx.fillRect(0, videoTop, cssWidth, videoBottom - videoTop);
      for (const segment of timeline) {
        if (segment.videoStartMs === null || segment.videoEndMs === null) continue;
        const x0 = (segment.videoStartMs / data.videoDurationMs) * cssWidth;
        const x1 = (segment.videoEndMs / data.videoDurationMs) * cssWidth;
        ctx.fillStyle = videoFill;
        ctx.fillRect(x0, videoTop, Math.max(1, x1 - x0), videoBottom - videoTop);
        ctx.strokeStyle = segment.id === selectedId ? '#7c5cff' : videoBorder;
        ctx.lineWidth = segment.id === selectedId ? 2 : 1;
        ctx.strokeRect(x0, videoTop, Math.max(1, x1 - x0), videoBottom - videoTop);
      }
      ctx.fillStyle = tertiary;
      ctx.font = '9px sans-serif';
      ctx.fillStyle = '#7c5cff';
      ctx.fillText('视频画面', 2, videoTop - 1);
      drawTicks(cssHeight - 1, data.videoDurationMs);
      // 对齐映射线：视频块中点 → 对应配音块中点（虚线，视觉化映射关系）
      ctx.setLineDash([3, 3]);
      ctx.lineWidth = 1;
      for (const segment of timeline) {
        if (segment.videoStartMs === null || segment.videoEndMs === null) continue;
        const fromX = ((segment.videoStartMs + segment.videoEndMs) / 2) / data.videoDurationMs * cssWidth;
        const toX = ((segment.sourceStartMs + segment.sourceEndMs) / 2) / data.durationMs * cssWidth;
        ctx.strokeStyle = segment.id === selectedId ? 'rgba(124,92,255,0.9)' : 'rgba(124,92,255,0.45)';
        ctx.beginPath();
        ctx.moveTo(fromX, videoBottom);
        ctx.lineTo(toX, audioTop);
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }

    const windowFrom = (trim.startMs / data.durationMs) * cssWidth;
    const windowTo = (trim.endMs / data.durationMs) * cssWidth;
    ctx.fillStyle = dim;
    if (windowFrom > 0) ctx.fillRect(0, audioTop, windowFrom, audioBottom - audioTop);
    if (windowTo < cssWidth) ctx.fillRect(windowTo, audioTop, cssWidth - windowTo, audioBottom - audioTop);

    for (const segment of timeline) {
      const dragging = dragSpan !== null && dragSpan.segmentId === segment.id;
      const startMs = dragging ? dragSpan.startMs : segment.sourceStartMs;
      const endMs = dragging ? dragSpan.endMs : segment.sourceEndMs;
      const x0 = Math.max(0, (startMs / data.durationMs) * cssWidth);
      const x1 = Math.min(cssWidth, (endMs / data.durationMs) * cssWidth);
      ctx.fillStyle = segment.muted ? mutedTint : soft;
      ctx.fillRect(x0, audioTop, Math.max(1, x1 - x0), audioBottom - audioTop);
      if (segment.id === selectedId) {
        ctx.strokeStyle = accent;
        ctx.lineWidth = 2;
        ctx.strokeRect(x0 - 1, audioTop - 1, Math.max(2, x1 - x0 + 2), audioBottom - audioTop + 2);
        const shift = alignShiftMs(segment);
        if (shift !== null && Math.abs(shift) > 250) {
          ctx.fillStyle = warn;
          ctx.font = '9px sans-serif';
          ctx.fillText(shift > 0 ? `台词长${formatMs(shift)}` : `画面长${formatMs(-shift)}`, Math.min(cssWidth - 76, Math.max(2, x0)), audioTop - 1);
        }
      } else {
        ctx.strokeStyle = border;
        ctx.lineWidth = 1;
        ctx.strokeRect(x0, audioTop, Math.max(1, x1 - x0), audioBottom - audioTop);
      }
      if (dragging) {
        ctx.fillStyle = accent;
        ctx.fillRect(x0 - 2, audioTop, 4, audioBottom - audioTop);
        ctx.fillRect(x1 - 2, audioTop, 4, audioBottom - audioTop);
      }
    }

    ctx.fillStyle = tertiary;
    ctx.font = '9px sans-serif';
    ctx.fillStyle = accent;
    ctx.fillText('配音台词', 2, audioTop - 1);
    if (!hasVideo) drawTicks(cssHeight - 1, data.durationMs);
  }, [data, timeline, trim.startMs, trim.endMs, selectedId, dragSpan, hasVideo]);

  const pxToMs = (clientX: number, durationMs: number, canvas: HTMLCanvasElement): number => {
    const rect = canvas.getBoundingClientRect();
    return Math.max(0, Math.min(durationMs, ((clientX - rect.left) / rect.width) * durationMs));
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const audioMs = pxToMs(event.clientX, data.durationMs, canvas);
    const segment = data.segments.find(item => audioMs >= item.startMs && audioMs < item.endMs) ?? null;
    if (!segment) return;
    const rect = canvas.getBoundingClientRect();
    const px = event.clientX - rect.left;
    const startX = (segment.startMs / data.durationMs) * rect.width;
    const endX = (segment.endMs / data.durationMs) * rect.width;
    const edge = Math.abs(px - startX) <= EDGE_GRAB_PX ? 'start' : Math.abs(px - endX) <= EDGE_GRAB_PX ? 'end' : null;
    onSelect(segment.id);
    if (!edge) return;
    dragRef.current = { segmentId: segment.id, edge, startMs: segment.startMs, endMs: segment.endMs };
    setDragSpan({ segmentId: segment.id, startMs: segment.startMs, endMs: segment.endMs });
    canvas.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const drag = dragRef.current;
    const span = dragSpan;
    if (!canvas || !drag || !span) return;
    const ms = pxToMs(event.clientX, data.durationMs, canvas);
    const next = { ...span };
    if (drag.edge === 'start') next.startMs = Math.max(0, Math.min(next.endMs - 1, ms));
    else next.endMs = Math.min(data.durationMs, Math.max(next.startMs + 1, ms));
    if (next.startMs !== span.startMs || next.endMs !== span.endMs) setDragSpan(next);
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const drag = dragRef.current;
    const span = dragSpan;
    dragRef.current = null;
    if (canvas && canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    if (!drag || !span) return;
    if (span.startMs !== drag.startMs || span.endMs !== drag.endMs) onSpanCommit(drag.segmentId, { startMs: span.startMs, endMs: span.endMs });
    setDragSpan(null);
  };

  return <canvas ref={canvasRef} className="nodrag"
    style={{ borderRadius: 6, cursor: dragSpan ? 'ew-resize' : 'pointer', display: 'block', touchAction: 'none' }}
    onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp}
    aria-label="双轨时间轴（视频/配音）" />;
}

function numberInput(value: number | null, placeholder: string, max: number, onCommit: (value: number | null) => void) {
  return (
    <input
      className="nodrag" style={styles.input} type="number" min={0} max={max}
      value={value ?? ''} placeholder={placeholder}
      onChange={event => {
        const raw = event.target.value;
        if (raw === '') { onCommit(null); return; }
        const parsed = Number(raw);
        if (Number.isFinite(parsed) && parsed >= 0 && parsed <= max) onCommit(parsed);
      }}
    />
  );
}

export interface DramaAudioUploadAdapter {
  upload(file: File, signal?: AbortSignal): Promise<{ relativePath: string }>;
}

export function MediaPreview({ data, onSelect, sourceVideoUrl, sourceAudioUrl, onVideoDuration }: { data: DramaAudioData; onSelect: (id: string) => void; sourceVideoUrl?: string | undefined; sourceAudioUrl?: string | undefined; onVideoDuration?: (durationMs: number) => void }) {
  const [videoFile, setVideoFile] = React.useState<File | null>(null);
  const [audioFile, setAudioFile] = React.useState<File | null>(null);
  const [videoUrl, setVideoUrl] = React.useState<string | null>(null);
  const [audioUrl, setAudioUrl] = React.useState<string | null>(null);
  const [timeMs, setTimeMs] = React.useState(0);
  const [error, setError] = React.useState<string | null>(null);
  const videoRef = React.useRef<HTMLVideoElement>(null);

  React.useEffect(() => {
    if (!videoFile) { setVideoUrl(null); return; }
    const url = URL.createObjectURL(videoFile);
    setVideoUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [videoFile]);
  React.useEffect(() => {
    if (!audioFile) { setAudioUrl(null); return; }
    const url = URL.createObjectURL(audioFile);
    setAudioUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [audioFile]);

  const previewVideoUrl = videoUrl ?? sourceVideoUrl;
  const active = data.segments.find(segment => {
    const start = segment.videoStartMs ?? segment.startMs;
    const end = segment.videoEndMs ?? segment.endMs;
    return timeMs >= start && timeMs < end;
  });

  return (
    <section style={styles.panelVideo} aria-label="本地视听预览">
      <strong>视频输入与视听预览</strong>
      <label style={styles.labelVideo}>选择本地视频
        <input className="nodrag nopan" type="file" accept="video/*" onChange={event => {
          setError(null);
          setVideoFile(event.target.files?.[0] ?? null);
        }} />
      </label>
      {previewVideoUrl && <video ref={videoRef} className="nodrag nopan" src={previewVideoUrl} controls playsInline
        style={{ width: '100%', maxHeight: 260, background: 'var(--bg-panel)', borderRadius: 6 }}
        onLoadedMetadata={event => {
          const ms = Math.round(event.currentTarget.duration * 1000);
          if (!videoFile && sourceVideoUrl && Number.isFinite(ms) && ms > 0 && ms !== data.videoDurationMs) onVideoDuration?.(ms);
        }}
        onError={() => setError('视频无法解码，请选择浏览器支持的真实视频文件。')}
        onTimeUpdate={event => setTimeMs(Math.round(event.currentTarget.currentTime * 1000))} />}
      <div aria-live="polite">{formatMs(timeMs)} · {active?.label ?? '当前时间无配音稿'}</div>
      {previewVideoUrl && <div style={styles.row}>{data.segments.map(segment => (
        <button key={segment.id} className="nodrag nopan" style={styles.button} onClick={() => {
          const ms = segment.videoStartMs ?? segment.startMs;
          if (videoRef.current) videoRef.current.currentTime = ms / 1000;
          setTimeMs(ms);
          onSelect(segment.id);
        }}>{formatMs(segment.videoStartMs ?? segment.startMs)} 定位 {segment.label.slice(0, 12)}</button>
      ))}</div>}
      <label style={styles.labelSource}>选择音频试听
        <input className="nodrag nopan" type="file" accept="audio/*" onChange={event => setAudioFile(event.target.files?.[0] ?? null)} />
      </label>
      {(audioUrl ?? sourceAudioUrl) && <audio className="nodrag nopan" src={audioUrl ?? sourceAudioUrl} controls style={{ width: '100%' }}
        onError={() => setError('音频无法解码，请更换文件。')} />}
      {error && <div role="alert">{error}</div>}
      <div style={styles.hint}>{sourceVideoUrl ? '当前预览为绑定的工程视频。' : '手选文件仅为临时本地预览，未保存。'} 音频为独立试听，尚未混入视频；没有镜头时间戳时不宣称已对齐。</div>
    </section>
  );
}

export function AudioCard({ node, onPatch, onOpenFile }: CardRenderProps) {
  const data = readDramaAudioData(node as Record<string, unknown>);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [scriptDraft, setScriptDraft] = React.useState<string | null>(null);
  const [labelDraft, setLabelDraft] = React.useState<string | null>(null);
  const [overrideDraft, setOverrideDraft] = React.useState<string | null>(null);
  const [callStatus, setCallStatus] = React.useState<string | null>(null);
  const [calling, setCalling] = React.useState(false);
  const demoProjectId = demoProjectOf(node);
  const sourceVideoUrl = demoProjectId && data.videoRef ? demoMediaUrl(demoProjectId, data.videoRef) : undefined;
  const sourceAudioUrl = demoProjectId && data.audioRef ? demoMediaUrl(demoProjectId, data.audioRef) : undefined;
  const ttsController = React.useRef<AbortController | null>(null);
  React.useEffect(() => () => ttsController.current?.abort(), []);
  const generateAudio = async () => {
    if (!demoProjectId || calling || !data.script) return;
    const controller = new AbortController();
    ttsController.current = controller;
    setCalling(true);
    setCallStatus('VoxCPM 正在生成全稿配音，首次调用需要加载模型；请勿重复提交。');
    try {
      await synthesizeDemoScript(demoProjectId, node.id, data.script, controller.signal);
      setCallStatus('真实配音已上传并绑定；可试听，镜头对齐尚未完成。');
    } catch (error) { setCallStatus(error instanceof Error ? error.message : 'TTS 失败'); }
    finally { setCalling(false); ttsController.current = null; }
  };
  const runAction = async (verb: 'analyze' | 'compose') => {
    if (!demoProjectId || calling) return;
    setCalling(true);
    setCallStatus(null);
    try {
      await callDemoAction(demoProjectId, node.id, verb, verb === 'compose' ? { script: data.script } : {});
      setCallStatus('调用完成，等待画布读回；稿件未自动覆盖。');
    } catch (error) {
      setCallStatus(error instanceof Error ? error.message : '调用失败');
    } finally { setCalling(false); }
  };

  const selected = data.segments.find(segment => segment.id === selectedId) ?? null;
  const commitData = (next: DramaAudioData) => onPatch({ data: { ...node.data, ...next } as Record<string, unknown> });

  if (data.audioRef === null) {
    return (
      <div style={styles.root}>
        <MediaPreview data={data} onSelect={setSelectedId} sourceVideoUrl={sourceVideoUrl} sourceAudioUrl={sourceAudioUrl} onVideoDuration={videoDurationMs => commitData({ ...data, videoDurationMs })} />
        <div style={styles.hint}>未生成配音音源；可先编辑稿件、解析视频和生成文案。文字没有时间戳，尚未与镜头对齐。</div>
        {data.videoRef && onOpenFile && <button className="nodrag nopan" style={styles.button} onClick={() => onOpenFile(data.videoRef!)}>打开绑定视频</button>}
        <label style={styles.panelDoc}>配音稿（本卡为编辑入口）
          <textarea className="nodrag nopan" style={styles.textarea} value={scriptDraft ?? data.script ?? ''}
            onChange={event => setScriptDraft(event.target.value)}
            onBlur={() => { if (scriptDraft !== null) { commitData({ ...data, script: scriptDraft || null }); setScriptDraft(null); } }} />
        </label>
        {demoProjectId && <div style={styles.row}>
          <button className="nodrag nopan" style={styles.buttonPrimary} disabled={calling || scriptDraft !== null || !data.script} onClick={() => void generateAudio()}>VoxCPM 生成配音音频</button>
          <button className="nodrag nopan" style={styles.button} disabled={calling || data.videoDurationMs <= 0} onClick={() => void runAction('analyze')}>解析绑定视频</button>
          <button className="nodrag nopan" style={styles.button} disabled={calling || scriptDraft !== null} onClick={() => void runAction('compose')}>生成配音文档</button>
        </div>}
        {demoProjectId && <div className="nodrag nopan"><VoicePicker value={data.voiceInstruction} styles={styles as unknown as Record<string, React.CSSProperties>} onChange={next => commitData({ ...data, voiceInstruction: next })} /></div>}
        {calling && <button className="nodrag nopan" style={styles.button} onClick={() => ttsController.current?.abort()}>停止等待（不自动重跑）</button>}
        {callStatus && <div role="status">{callStatus}</div>}
        {data.captions.map(caption => <div key={caption.id} style={styles.panelVideo}>{formatMs(caption.startMs)}–{formatMs(caption.endMs)} · {caption.text}</div>)}
        {data.dubbingDoc && <div style={styles.panelDoc}>
          <div>生成文档 · {data.dubbingProvider ?? '未知来源'}</div>
          <pre style={{ whiteSpace: 'pre-wrap' }}>{data.dubbingDoc}</pre>
          <button className="nodrag nopan" style={styles.button} onClick={() => commitData({ ...data, script: data.dubbingDoc })}>确认应用为稿件</button>
        </div>}
      </div>
    );
  }

  const patchSegment = (segmentId: string, patch: Partial<DramaAudioSegment>) => {
    commitData({ ...data, segments: data.segments.map(item => (item.id === segmentId ? { ...item, ...patch } : item)) });
  };

  const appendSegment = () => {
    const lastEnd = data.segments.reduce((max, segment) => Math.max(max, segment.endMs), 0);
    const start = Math.min(lastEnd, Math.max(0, data.durationMs - 1));
    const end = Math.min(data.durationMs, start + 2_000);
    const segment: DramaAudioSegment = { id: nextSegmentId(data), label: `台词 ${data.segments.length + 1}`, startMs: start, endMs: Math.max(start + 1, end), gapMs: 0, gain: 1, muted: false, videoStartMs: null, videoEndMs: null, audioRefOverride: null };
    commitData({ ...data, segments: [...data.segments, segment] });
    setSelectedId(segment.id);
  };

  const selectedTimeline = selected ? timelineOf(data).find(item => item.id === selected.id) ?? null : null;
  const shift = selectedTimeline ? alignShiftMs(selectedTimeline) : null;
  const shiftStyle = shift === null ? styles.shiftOk : Math.abs(shift) > 500 ? styles.shiftBad : Math.abs(shift) > 250 ? styles.shiftWarn : styles.shiftOk;

  return (
    <div style={styles.root}>
      <MediaPreview data={data} onSelect={setSelectedId} sourceVideoUrl={sourceVideoUrl} sourceAudioUrl={sourceAudioUrl} onVideoDuration={videoDurationMs => commitData({ ...data, videoDurationMs })} />
      {demoProjectId && <div style={styles.row}>
        <button className="nodrag nopan" style={styles.buttonPrimary} disabled={calling || scriptDraft !== null || !data.script} onClick={() => void generateAudio()}>按当前稿件重新生成配音</button>
        {callStatus && <div role="status">{callStatus}</div>}
      </div>}
      {demoProjectId && <div className="nodrag nopan"><VoicePicker value={data.voiceInstruction} styles={styles as unknown as Record<string, React.CSSProperties>} onChange={next => commitData({ ...data, voiceInstruction: next })} /></div>}
      <div style={styles.row}>
        <span style={styles.label}>配音源</span>
        <span className="nodrag" style={{ ...styles.value, maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{data.audioRef}</span>
        <span style={styles.labelVideo}>视频源</span>
        <span className="nodrag" style={{ ...styles.value, maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{data.videoRef ?? '未绑定（单轨）'}</span>
        <span style={styles.label}>有效时长</span><span style={styles.value}>{formatMs(totalDurationMs(data))}</span>
        <span style={styles.label}>总音量</span><span style={styles.value}>{data.masterGain.toFixed(1)}x</span>
      </div>
      <div style={styles.row}>
        <span style={styles.badgeAudio}>段 {data.segments.length}</span>
        <span style={styles.badgeSource}>已换源 {data.segments.filter(item => item.audioRefOverride !== null).length}</span>
        <span style={styles.badgeVideo}>已对齐 {data.segments.filter(item => item.videoStartMs !== null).length}</span>
        <span style={styles.badgeDoc}>静音 {data.segments.filter(item => item.muted).length}</span>
        {data.captions.length > 0 && <span style={styles.badgeVideo}>画面段 {data.captions.length}</span>}
      </div>

      <TimelineCanvas data={data} selectedId={selectedId} onSelect={setSelectedId}
        onSpanCommit={(segmentId, span) => patchSegment(segmentId, span)} />

      <div style={styles.hint}>点选段 · 拖段块左右边缘改配音区间{data.videoRef === null ? '' : ' · 上轨为视频画面区间'}</div>

      {selected ? (
        <div style={styles.panelAudio}>
          <div style={styles.row}>
            <span style={styles.label}>台词</span>
            <input
              className="nodrag" style={{ ...styles.input, flex: 1, minWidth: 120 }} value={labelDraft ?? selected.label}
              onChange={event => setLabelDraft(event.target.value)}
              onBlur={() => { const text = labelDraft ?? selected.label; if (text !== selected.label && text) patchSegment(selected.id, { label: text }); setLabelDraft(null); }}
              onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }}
            />
          </div>
          <div style={styles.row}>
            <span style={styles.label}>配音区间</span>
            {numberInput(selected.startMs, '起ms', data.durationMs, value => { if (value !== null && value < selected.endMs) patchSegment(selected.id, { startMs: value }); })}
            <span style={styles.label}>→</span>
            {numberInput(selected.endMs, '止ms', data.durationMs, value => { if (value !== null && value > selected.startMs) patchSegment(selected.id, { endMs: value }); })}
            <span style={styles.label}>停顿</span>
            <button className="nodrag" style={styles.button} onClick={() => patchSegment(selected.id, { gapMs: Math.max(0, selected.gapMs - 100) })}>−</button>
            <span style={styles.value}>{selected.gapMs}ms</span>
            <button className="nodrag" style={styles.button} onClick={() => patchSegment(selected.id, { gapMs: Math.min(GAP_MS_MAX, selected.gapMs + 100) })}>＋</button>
            <span style={styles.label}>音量</span>
            <button className="nodrag" style={styles.button} onClick={() => patchSegment(selected.id, { gain: Math.max(0, Math.round((selected.gain - 0.1) * 10) / 10) })}>−</button>
            <span style={styles.value}>{selected.gain.toFixed(1)}x</span>
            <button className="nodrag" style={styles.button} onClick={() => patchSegment(selected.id, { gain: Math.min(2, Math.round((selected.gain + 0.1) * 10) / 10) })}>＋</button>
            <button className="nodrag" style={selected.muted ? styles.buttonPrimary : styles.button} onClick={() => patchSegment(selected.id, { muted: !selected.muted })}>{selected.muted ? '已静音' : '静音'}</button>
            <button className="nodrag" style={styles.button} onClick={() => { commitData({ ...data, segments: data.segments.filter(item => item.id !== selected.id) }); setSelectedId(null); }}>删段</button>
            <button className="nodrag" style={styles.button} onClick={() => {
              const mid = Math.floor((selected.startMs + selected.endMs) / 2);
              const front: DramaAudioSegment = { ...selected, id: nextSegmentId(data), label: `${selected.label}（前）`, endMs: mid };
              const back: DramaAudioSegment = { ...selected, id: nextSegmentId({ ...data, segments: [...data.segments, front] }), label: `${selected.label}（后）`, startMs: mid, videoStartMs: null, videoEndMs: null };
              const replaced = data.segments.flatMap(item => item.id === selected.id ? [front, back] : [item]);
              commitData({ ...data, segments: replaced });
              setSelectedId(front.id);
            }}>拆分</button>
            {(() => {
              const ordered = [...data.segments].sort((a, b) => a.startMs - b.startMs);
              const index = ordered.findIndex(item => item.id === selected.id);
              const nextSeg = index >= 0 && index + 1 < ordered.length ? ordered[index + 1] : null;
              if (!nextSeg) return null;
              return (
                <button className="nodrag" style={styles.button} onClick={() => {
                  const merged: DramaAudioSegment = {
                    ...selected, endMs: nextSeg.endMs, gapMs: nextSeg.gapMs,
                    label: `${selected.label}${nextSeg.label}`,
                    videoEndMs: nextSeg.videoEndMs ?? selected.videoEndMs,
                  };
                  const mergedList = data.segments.filter(item => item.id !== selected.id && item.id !== nextSeg.id).concat(merged);
                  commitData({ ...data, segments: mergedList });
                  setSelectedId(merged.id);
                }}>并下段</button>
              );
            })()}
          </div>
          <div style={styles.row}>
            <span style={styles.labelSource}>该段配音</span>
            <input
              className="nodrag" style={{ ...styles.input, flex: 1, minWidth: 120 }} placeholder="换 take：工程相对路径，留空用主源"
              value={overrideDraft ?? selected.audioRefOverride ?? ''}
              onChange={event => setOverrideDraft(event.target.value)}
              onBlur={() => {
                const text = (overrideDraft ?? '').trim();
                const next = text === '' ? null : text;
                if (next !== selected.audioRefOverride) patchSegment(selected.id, { audioRefOverride: next });
                setOverrideDraft(null);
              }}
            />
            {selected.audioRefOverride !== null && <button className="nodrag" style={styles.buttonWarn} onClick={() => patchSegment(selected.id, { audioRefOverride: null })}>恢复主源</button>}
            {selected.audioRefOverride !== null && <span style={styles.badgeSource}>已换源</span>}
          </div>
          <div style={styles.row}>
            <span style={styles.label}>视频对齐</span>
            {data.videoRef === null
              ? <span style={styles.hint}>未绑视频源（Agent 执行 card.drama.audio.video 绑定后可对齐）</span>
              : <>
                  {numberInput(selected.videoStartMs, '画面起ms', data.videoDurationMs, value => {
                    const end = selected.videoEndMs;
                    if (value === null) patchSegment(selected.id, { videoStartMs: null });
                    else if (end === null || value < end) patchSegment(selected.id, { videoStartMs: value });
                  })}
                  <span style={styles.label}>→</span>
                  {numberInput(selected.videoEndMs, '画面止ms', data.videoDurationMs, value => {
                    const start = selected.videoStartMs;
                    if (value === null) patchSegment(selected.id, { videoEndMs: null });
                    else if (start === null || value > start) patchSegment(selected.id, { videoEndMs: value });
                  })}
                  {(selected.videoStartMs !== null || selected.videoEndMs !== null) && <button className="nodrag" style={styles.buttonWarn} onClick={() => patchSegment(selected.id, { videoStartMs: null, videoEndMs: null })}>清除对齐</button>}
                  <span style={shiftStyle}>{shift === null ? '未对齐' : shift === 0 ? '已对齐' : shift > 0 ? `台词长 ${shift}ms` : `画面长 ${-shift}ms`}</span>
                </>}
          </div>
        </div>
      ) : (
        <div style={styles.hint}>点击时间轴选择台词分段；或先添加一段。</div>
      )}

      {data.captions.length > 0 ? (
        <div style={styles.panelVideo}>
          <div style={styles.row}>
            <span style={styles.labelVideo}>画面解析（dense captions）</span>
            <span style={styles.badgeVideo}>analyze · 来源 {data.captionProvider ?? '—'}</span>
          </div>
          {data.captions.map(caption => (
            <div key={caption.id} style={{ ...styles.row, alignItems: 'flex-start' }}>
              {caption.thumbnail !== null && (
                <img className="nodrag" src={caption.thumbnail} alt=""
                  style={{ width: 64, height: 40, objectFit: 'cover', borderRadius: 4, border: '1px solid var(--border-subtle, #eee)' }} />
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 120 }}>
                <span style={styles.value}>{formatMs(caption.startMs)}–{formatMs(caption.endMs)}</span>
                <span style={styles.hint}>{caption.text}</span>
              </div>
              <button className="nodrag" style={styles.button} onClick={() => {
                const start = Math.min(caption.startMs, Math.max(0, data.durationMs - 1));
                const end = Math.min(data.durationMs, Math.max(start + 1, caption.endMs));
                const segment: DramaAudioSegment = {
                  id: nextSegmentId(data), label: caption.text.slice(0, 80),
                  startMs: start, endMs: end, gapMs: 0, gain: 1, muted: false,
                  videoStartMs: caption.startMs, videoEndMs: caption.endMs, audioRefOverride: null,
                };
                commitData({ ...data, segments: [...data.segments, segment] });
                setSelectedId(segment.id);
              }}>转台词段</button>
            </div>
          ))}
        </div>
      ) : (
        <div style={styles.row}>
          <span style={styles.label}>生成</span>
          <span style={styles.badgeVideo}>analyze 画面解析</span>
          <span style={styles.badgeDoc}>compose 配音文档</span>
          <span style={styles.hint}>经 Agent / COI 通道执行；未配置 provider 时动作明确报错。</span>
        </div>
      )}

      {data.dubbingDoc !== null && (
        <div style={styles.panelDoc}>
          <div style={styles.row}>
            <span style={styles.labelDoc}>配音文档</span>
            <span style={styles.badgeDoc}>compose · 来源 {data.dubbingProvider ?? '—'}</span>
            {data.script !== data.dubbingDoc && (
              <button className="nodrag" style={styles.buttonWarn} onClick={() => commitData({ ...data, script: data.dubbingDoc })}>应用为台本</button>
            )}
          </div>
          <span className="nodrag" style={{ ...styles.hint, whiteSpace: 'pre-wrap' }}>
            {data.dubbingDoc.length > 300 ? `${data.dubbingDoc.slice(0, 300)}…` : data.dubbingDoc}
          </span>
        </div>
      )}

      <div style={styles.row}>
        <button className="nodrag" style={styles.button} onClick={appendSegment}>＋ 添加台词段</button>
        <span style={styles.label}>裁剪</span>
        {numberInput(data.trimStartMs, '起点ms', data.durationMs, value => commitData({ ...data, trimStartMs: value }))}
        {numberInput(data.trimEndMs, '终点ms', data.durationMs, value => commitData({ ...data, trimEndMs: value }))}
      </div>

      <div style={styles.row}>
        <span style={styles.label}>台本</span>
        {scriptDraft === null ? (
          <span className="nodrag" style={{ ...styles.hint, flex: 1, whiteSpace: 'pre-wrap', cursor: 'text' }} onClick={() => setScriptDraft(data.script ?? '')}>
            {data.script ? (data.script.length > 80 ? `${data.script.slice(0, 80)}…` : data.script) : '点击填写台本…'}
          </span>
        ) : (
          <textarea className="nodrag" style={styles.textarea} value={scriptDraft} autoFocus
            onChange={event => setScriptDraft(event.target.value)}
            onBlur={() => { const text = scriptDraft.trim() === '' ? null : scriptDraft; if (text !== data.script) commitData({ ...data, script: text }); setScriptDraft(null); }} />
        )}
      </div>

      <div style={styles.panel}>
        <div style={styles.row}>
          <span style={styles.label}>输出预览（EDL v3）</span>
          <button className="nodrag" style={styles.button} onClick={() => {
            const manifest = renderExportManifest(String(node.id), data);
            void navigator.clipboard?.writeText(manifest.json);
          }}>复制 JSON</button>
          {data.exportedPath && <span style={styles.badgeDoc}>服务端已导出 {data.exportedDigest?.slice(0, 8)}…</span>}
        </div>
        <pre className="nodrag" style={{ margin: 0, maxHeight: 96, overflow: 'auto', fontSize: 10, lineHeight: 1.4, color: 'var(--text-secondary, #5c5c5c)', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
          {renderExportManifest(String(node.id), data).json.slice(0, 600)}…
        </pre>
        <div style={styles.footer}>本地实时预览（纯函数渲染）；服务端正式导出走 Agent / COI 动作 card.drama.audio.export，产物为工程文件。</div>
      </div>
    </div>
  );
}

export default AudioCard;
