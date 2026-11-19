'use client';

import type { MediaLookup } from './media';

import { useState } from 'react';
import type { RefObject } from 'react';
import { buildPlaybackPlan, gainRegionsOf, originalGainOf } from '../playback-plan';
import type { DubbingPlayback } from '../dubbing-editor';
import type { GainRegion } from '../playback-plan';
import type { RewriteLine as TimedDubbingLine } from '../rewrite';
import { directorOf, displayTime, intersecting, lineFingerprint, listenLabel, makeRange, overlaps, rangeOf, rewriteWindows, shiftFollowing } from './director-edits';
import type { EditData, ListenMode, TimeRange } from './director-edits';
import styles from './workbench.module.css';

const PANELS = [
  ['listen', '选区与试听'], ['timing', '间隔与标记'], ['mix', '音量'], ['review', '审阅'],
] as const;

type Props = {
  data: EditData;
  mediaUrl: MediaLookup;
  rows: TimedDubbingLine[];
  duration: number;
  time: () => number;
  selectedId: string | null;
  select: (id: string) => void;
  ranges: TimeRange[];
  setRanges: (ranges: TimeRange[]) => void;
  mode: ListenMode;
  setMode: (mode: ListenMode) => void;
  playback: RefObject<DubbingPlayback>;
  disabled: boolean;
  patch: (changes: EditData) => boolean;
  /** 视频正在播放：播放键显示为暂停。 */
  playing?: boolean;
};

export function DirectorTools({ data, mediaUrl, rows, duration, time, selectedId, select, ranges, setRanges, mode, setMode, playback, disabled, patch, playing = false }: Props) {
  const state = directorOf(data);
  const [panel, setPanel] = useState<typeof PANELS[number][0]>('listen');
  const [feedback, setFeedback] = useState('');
  const [markIn, setMarkIn] = useState<number | null>(null);
  const [padding, setPadding] = useState(0);
  const [label, setLabel] = useState('');
  const [markerId, setMarkerId] = useState('');
  const [gapDraft, setGapDraft] = useState<{ id: string; value: number } | null>(null);
  const [rangeStart, setRangeStart] = useState('');
  const [rangeEnd, setRangeEnd] = useState('');
  const [following, setFollowing] = useState(false);
  const [track, setTrack] = useState<GainRegion['track']>('voice');
  const [gain, setGain] = useState(0.5);
  const [fade, setFade] = useState(200);
  const [clipboard, setClipboard] = useState<Pick<GainRegion, 'track' | 'gain' | 'fadeMs'> | null>(null);
  const [note, setNote] = useState('');
  const [reviewKind, setReviewKind] = useState<'voice' | 'caption'>('voice');
  const line = rows.find(row => row.id === selectedId);
  const selectedWindow = line ? rangeOf(line) : null;
  const area = ranges.length ? ranges : selectedWindow ? [selectedWindow] : [];
  const locked = state.locks ?? [];
  const markers = state.markers ?? [];
  const notes = state.notes ?? [];
  const byTime = [...rows].sort((a, b) => a.videoStartMs - b.videoStartMs);
  const index = byTime.findIndex(row => row.id === line?.id);
  const preceding = index > 0 ? byTime[index - 1] : null;
  const currentGap = line && preceding ? line.videoStartMs - preceding.videoEndMs : 0;
  const affected = line && preceding ? byTime.slice(index, following ? undefined : index + 1) : [];
  const hasBackground = Boolean(data.directorBackgroundRef);
  const listening: ListenMode[] = hasBackground ? ['mix', 'original', 'voice', 'background'] : ['mix', 'original', 'voice'];
  const liveRegions = [...gainRegionsOf(data, 'voice'), ...gainRegionsOf(data, 'original'), ...gainRegionsOf(data, 'background')];
  const checked = (row: TimedDubbingLine) => state.review?.[`${reviewKind}/${row.id}`] === lineFingerprint(data, row, reviewKind);
  const activeReview = line ?? byTime.find(row => !checked(row)) ?? byTime[0];
  const gap = gapDraft?.id === line?.id ? gapDraft?.value ?? currentGap : currentGap;
  const clampedGap = Math.round(Math.max(0, Math.min(duration, gap)));
  const saveDirector = (changes: Partial<typeof state>) => patch({ directorEdit: { ...state, ...changes } });

  function run(operation: () => void) {
    try { setFeedback(''); operation(); }
    catch (error) { setFeedback(error instanceof Error ? error.message : '操作失败'); }
  }

  function play(items?: TimeRange[], loop = false, audition?: EditData) {
    const window = items?.map(range => ({
      startMs: Math.max(0, range.startMs - padding), endMs: Math.min(duration, range.endMs + padding),
    }));
    if (window && !window.length) return;
    void playback.current?.play(window, loop, audition as Parameters<DubbingPlayback['play']>[2]).catch(error => {
      setFeedback(error instanceof Error ? error.message : '无法播放');
    });
  }

  function windowForDraft(changes: EditData, ids: string[]) {
    const list = (Array.isArray(changes.rewriteLines) && changes.rewriteLines.length ? changes.rewriteLines
      : Array.isArray(changes.segments) ? changes.segments : []) as TimedDubbingLine[];
    const target = list.filter(row => ids.includes(row.id) && rangeOf(row));
    return target.length ? [{
      startMs: Math.min(...target.map(row => row.videoStartMs)),
      endMs: Math.max(...target.map(row => row.videoEndMs)),
    }] : [];
  }

  function saveArrangement(slot: 'A' | 'B') {
    const items = area.length ? intersecting(rows, area) : rows;
    if (!items.length) throw new Error('所选区间内没有台词。');
    const windows = Object.fromEntries(items.map(row => [row.id, rangeOf(row)!]));
    if (saveDirector({ arrangements: { ...state.arrangements, [slot]: { label: slot, windows } } })) {
      setFeedback(`已保存方案 ${slot}，包含 ${items.length} 句的时间区间。`);
    }
  }

  function applyArrangement(slot: 'A' | 'B', apply: boolean) {
    const arrangement = state.arrangements?.[slot];
    if (!arrangement) return;
    const changes = rewriteWindows(data, arrangement.windows, duration);
    if (apply) patch(changes);
    else play(windowForDraft(changes, Object.keys(arrangement.windows)), false, { ...data, ...changes });
  }

  function applyGain(preset: Pick<GainRegion, 'track' | 'gain' | 'fadeMs'>) {
    if (!area.length || !Number.isFinite(preset.gain) || !Number.isFinite(preset.fadeMs) || preset.fadeMs < 0) {
      throw new Error('请选中区间并填写有效的音量与渐变时长。');
    }
    const next = [...liveRegions];
    for (const range of area) {
      const same = next.findIndex(item => item.track === preset.track && overlaps(item, range));
      if (same >= 0 && (next[same]!.startMs !== range.startMs || next[same]!.endMs !== range.endMs
        || next.some((item, i) => i !== same && item.track === preset.track && overlaps(item, range)))) {
        throw new Error('同一音轨的音量区间需要分开。可先删除已有区间，或使用同一范围覆盖。');
      }
      const entry = { ...range, ...preset };
      if (same >= 0) next[same] = entry;
      else next.push(entry);
    }
    if (patch({ directorGainRegions: next })) setFeedback('选区音量已应用，播放与导出会使用该设置。');
  }

  function audioRefs(ranges: TimeRange[]) {
    return [...new Set(buildPlaybackPlan(data, 0).filter(item => ranges.some(range => overlaps(range, {
      startMs: item.delayMs, endMs: item.delayMs + item.durationMs,
    }))).map(item => item.audioRef))];
  }

  function nextReview(afterId?: string) {
    const start = byTime.findIndex(row => row.id === afterId);
    const queue = [...byTime.slice(start + 1), ...byTime.slice(0, Math.max(0, start))];
    const next = queue.find(row => !checked(row));
    if (next) { select(next.id); play([rangeOf(next)!]); }
    else setFeedback('当前类别没有待审阅的台词。');
  }

  return <section className={styles.director} aria-label="导演工具">
    <div className={styles.actionRow}>
      <button className={styles.toolBtnPrimary + ' ' + styles.toolBtn} disabled={!duration || (disabled && !playing)} aria-pressed={playing} onClick={() => {
        if (playing) { playback.current?.stop(); return; }
        if (time() >= duration - 1) playback.current?.seek(0);
        play();
      }}>{playing ? '暂停' : '播放'}</button>
      <button className={styles.toolBtn} disabled={!duration || disabled || !time()} onClick={() => {
        const end = Math.min(time(), duration);
        const replay = makeRange(end - 3000, end, duration);
        if (!replay) return;
        const row = intersecting(rows, [replay]).at(-1);
        if (row) select(row.id);
        play([replay]);
      }}>回听 3 秒</button>
      <span className={styles.controlGroup} role="group" aria-label="试听音轨">
        {listening.map(value =>
          <button key={value} className={styles.chip} aria-pressed={mode === value} onClick={() => setMode(value)}>{value === 'mix' ? '混合' : listenLabel[value]}</button>)}
      </span>
      <span className={styles.panelHint}>{ranges.length ? `已选 ${ranges.length} 段 · ${intersecting(rows, ranges).length} 句` : '在时间轴框选，或点选一句台词'}</span>
    </div>
    <details className={styles.advancedTools}>
    <summary>选区工具 · 音量、节奏与审阅</summary>
    <div className={styles.directorTabs} role="group" aria-label="编辑工具">
      {PANELS.map(([key, text]) => <button key={key} className={styles.tabButton} aria-pressed={panel === key} onClick={() => { setPanel(key); setFeedback(''); }}>{text}</button>)}
    </div>
    <div className={styles.directorBody}>
      {panel === 'listen' && <>
        <div className={styles.actionRow}>
          <button className={styles.toolBtn} disabled={!duration} onClick={() => setMarkIn(time())}>{markIn === null ? '标为起点' : `起点 ${displayTime(markIn)}`}</button>
          <button className={styles.toolBtn} disabled={markIn === null || !duration} onClick={() => run(() => {
            const range = makeRange(markIn!, time(), duration);
            if (!range) throw new Error('移动播放头后再标为终点。');
            setRanges([...ranges, range]);
            setMarkIn(null);
          })}>标为终点</button>
          <button className={styles.toolBtn} disabled={!selectedWindow} onClick={() => {
            if (selectedWindow && !ranges.some(range => range.startMs === selectedWindow.startMs && range.endMs === selectedWindow.endMs)) setRanges([...ranges, selectedWindow]);
          }}>加入当前句</button>
          <button className={styles.toolBtn} disabled={!ranges.length && markIn === null} onClick={() => { setRanges([]); setMarkIn(null); }}>清空选区</button>
          <button className={styles.toolBtn} disabled={!area.length || disabled} onClick={() => play(area)}>按顺序试听</button>
          <button className={styles.toolBtn} disabled={!area.length || disabled} onClick={() => play(area, true)}>循环试听</button>
          <label>带上下文 <select value={padding} onChange={event => setPadding(Number(event.target.value))}><option value={0}>关闭</option><option value={500}>前后 0.5 秒</option><option value={1000}>前后 1 秒</option></select></label>
        </div>
        <div className={styles.actionRow}>
        <details className={styles.preciseRange}>
          <summary>精确输入选区</summary>
          <div className={styles.actionRow}>
            <label>起点（秒）<input className={styles.numField} type="number" min={0} step=".001" max={duration / 1000} value={rangeStart} onChange={event => setRangeStart(event.target.value)} /></label>
            <label>终点（秒）<input className={styles.numField} type="number" min={0} step=".001" max={duration / 1000} value={rangeEnd} onChange={event => setRangeEnd(event.target.value)} /></label>
            <button className={styles.toolBtn} disabled={!duration || !rangeStart || !rangeEnd} onClick={() => run(() => {
              const start = Number(rangeStart) * 1000;
              const end = Number(rangeEnd) * 1000;
              const range = start >= 0 && start < end && end <= duration ? makeRange(start, end, duration) : null;
              if (!range) throw new Error('请输入视频时长内的起点和终点，起点需早于终点。');
              setRanges([...ranges, range]);
            })}>添加区间</button>
          </div>
        </details>
        {ranges.map((range, i) => <button key={i} className={styles.chip}
          title="移出试听序列" aria-label={`移除选区 ${i + 1}`} onClick={() => setRanges(ranges.filter((_, index) => index !== i))}>
          {displayTime(range.startMs)} – {displayTime(range.endMs)} ×
        </button>)}
          <button className={styles.toolBtn} disabled={!area.length || disabled} onClick={() => saveDirector({ locks: [...locked, ...area.filter(range => !locked.some(item => item.startMs === range.startMs && item.endMs === range.endMs))] })}>锁定选区</button>
          {locked.map((range, i) => <button key={i} className={styles.chip} disabled={disabled} onClick={() => saveDirector({ locks: locked.filter((_, index) => i !== index) })}>
            解锁 {displayTime(range.startMs)} – {displayTime(range.endMs)}
          </button>)}
        </div>
        <div className={styles.actionRow}>
          <span className={styles.panelHint}>时间方案</span>
          {(['A', 'B'] as const).map(slot => <span className={styles.controlGroup} role="group" aria-label={`时间方案 ${slot}`} key={slot}>
            <button className={styles.chip} disabled={!rows.length || disabled} onClick={() => run(() => saveArrangement(slot))}>存为 {slot}</button>
            <button className={styles.chip} disabled={!state.arrangements?.[slot] || disabled} onClick={() => run(() => applyArrangement(slot, false))}>试听 {slot}</button>
            <button className={styles.chip} disabled={!state.arrangements?.[slot] || disabled} onClick={() => run(() => applyArrangement(slot, true))}>采用 {slot}</button>
          </span>)}
        </div>
      </>}
      {panel === 'timing' && <>
        <div className={styles.actionRow}>
          <input aria-label="画面标记名称" placeholder="标记名称，如转场" maxLength={40} value={label} onChange={event => setLabel(event.target.value)} />
          <button className={styles.toolBtn} disabled={!duration || disabled} onClick={() => {
            const id = crypto.randomUUID();
            if (saveDirector({ markers: [...markers, { id, ms: Math.min(duration, Math.round(time())), label: label.trim() || '画面标记' }] })) {
              setLabel(''); setMarkerId(id);
            }
          }}>标记当前帧</button>
          {!!markers.length && <>
            <select aria-label="画面标记" value={markerId} onChange={event => setMarkerId(event.target.value)}>
              <option value="">选择标记</option>
              {markers.map(marker => <option key={marker.id} value={marker.id}>{marker.label} · {displayTime(marker.ms)}</option>)}
            </select>
            <button className={styles.chip} disabled={!markers.some(marker => marker.id === markerId)} onClick={() => {
              const marker = markers.find(item => item.id === markerId);
              if (marker) playback.current?.seek(marker.ms);
            }}>跳到标记</button>
            <button className={styles.chip} disabled={!line || !markers.some(marker => marker.id === markerId) || disabled} onClick={() => run(() => {
              const marker = markers.find(item => item.id === markerId);
              if (!marker || !line) return;
              patch(shiftFollowing(data, rows, line.id, marker.ms - line.videoStartMs, false, duration));
            })}>本句吸附到标记</button>
            <button className={styles.chip} disabled={!markers.some(marker => marker.id === markerId) || disabled} onClick={() => saveDirector({ markers: markers.filter(item => item.id !== markerId) })}>移除标记</button>
          </>}
        </div>
        {line && preceding ? <div key={line.id} className={styles.actionRow}>
          <label>句间停顿 <input type="range" aria-label="拖动句间停顿" min={0} max={Math.max(2000, currentGap, clampedGap)} step={10}
            value={clampedGap} onChange={event => setGapDraft({ id: line.id, value: Number(event.target.value) })} /></label>
          <label><input className={styles.numField} aria-label="句间停顿毫秒" type="number" min={0} max={duration} value={gap} onChange={event => setGapDraft({ id: line.id, value: Number(event.target.value) })} /> ms</label>
          <button className={styles.chip} onClick={() => setGapDraft(null)}>恢复当前 {currentGap} ms</button>
          <select aria-label="停顿影响范围" value={following ? 'following' : 'one'} onChange={event => setFollowing(event.target.value === 'following')}>
            <option value="one">只移动本句</option><option value="following">本句及后续 {byTime.length - index} 句</option>
          </select>
          <button className={styles.toolBtn} disabled={disabled} onClick={() => run(() => {
            const changes = shiftFollowing(data, rows, line.id, clampedGap - currentGap, following, duration);
            play(windowForDraft(changes, [preceding.id, ...affected.map(row => row.id)]), false, { ...data, ...changes });
          })}>试听移动</button>
          <button className={styles.toolBtn} disabled={disabled} onClick={() => run(() => patch(shiftFollowing(data, rows, line.id, clampedGap - currentGap, following, duration)))}>应用间隔</button>
        </div> : <span className={styles.panelHint}>选中第二句或后面的台词，即可调整它和上一句之间的停顿。</span>}
      </>}
      {panel === 'mix' && <>
        <div className={styles.actionRow}>
          <label>原声总音量 <input type="range" min={0} max={1} step={0.01} value={originalGainOf(data)} disabled={disabled}
            onChange={event => patch({ directorOriginalGain: Number(event.target.value) })} /></label>
          <label>配音总音量 <input type="range" min={0} max={2} step={0.01} value={Number(data.masterGain ?? 1)} disabled={disabled}
            onChange={event => patch({ masterGain: Number(event.target.value) })} /></label>
          {hasBackground && <>
            <label>背景音乐总音量 <input type="range" min={0} max={2} step={0.01} value={Number(data.directorBackgroundGain ?? 1)} disabled={disabled}
              onChange={event => patch({ directorBackgroundGain: Number(event.target.value) })} /></label>
            <button className={styles.chip} disabled={disabled} onClick={() => patch({
              directorBackgroundRef: null, directorBackgroundDurationMs: 0,
              directorGainRegions: liveRegions.filter(region => region.track !== 'background'),
            })}>从工程移除背景音乐</button>
          </>}
        </div>
        <div className={styles.actionRow}>
          <label>选区音轨 <select value={track} onChange={event => {
            const next = event.target.value as GainRegion['track']; setTrack(next); if (next === 'original') setGain(Math.min(1, gain));
          }}><option value="voice">配音</option><option value="original">原声</option>{hasBackground && <option value="background">背景音乐</option>}</select></label>
          <label>音量 <input className={styles.numField} type="number" min={0} max={track === 'original' ? 1 : 2} step={0.1} value={gain}
            onChange={event => setGain(Number(event.target.value))} /></label>
          <label>前后渐变 <input className={styles.numField} type="number" min={0} max={10_000} step={50} value={fade}
            onChange={event => setFade(Number(event.target.value))} /> ms</label>
          <button className={styles.toolBtn} disabled={!area.length || disabled || gain < 0 || gain > (track === 'original' ? 1 : 2)} onClick={() => run(() => applyGain({ track, gain, fadeMs: fade }))}>应用到选区</button>
          <button className={styles.chip} disabled={gain < 0 || gain > (track === 'original' ? 1 : 2) || fade < 0} onClick={() => setClipboard({ track, gain, fadeMs: fade })}>复制音量和渐变</button>
          <button className={styles.chip} disabled={!clipboard || !area.length || disabled} onClick={() => run(() => applyGain(clipboard!))}>粘贴到选区</button>
        </div>
        {!!liveRegions.length && <div className={styles.actionRow}>{liveRegions.map(region => <span key={`${region.track}-${region.startMs}`} className={styles.controlGroup}>
          <button className={styles.chip} onClick={() => { setRanges([region]); setTrack(region.track); setGain(region.gain); setFade(region.fadeMs); }}>
            {listenLabel[region.track]} · {displayTime(region.startMs)} – {displayTime(region.endMs)} · {Math.round(region.gain * 100)}%
          </button>
          <button className={styles.chip} disabled={disabled} aria-label={`移除 ${displayTime(region.startMs)} 的音量调整`}
            onClick={() => patch({ directorGainRegions: liveRegions.filter(item => item !== region) })}>×</button>
        </span>)}</div>}
      </>}
      {panel === 'review' && <>
        <div className={styles.actionRow}>
          <select aria-label="审阅类型" value={reviewKind} onChange={event => setReviewKind(event.target.value as typeof reviewKind)}>
            <option value="voice">核对配音</option><option value="caption">核对字幕</option>
          </select>
          <span role="status" className={styles.panelHint}>已核对 {rows.filter(checked).length}/{rows.length}</span>
          <button className={styles.toolBtn} disabled={!activeReview || disabled} onClick={() => {
            if (activeReview) { select(activeReview.id); play([rangeOf(activeReview)!]); }
          }}>试听当前</button>
          <button className={styles.toolBtn} disabled={!activeReview || disabled} onClick={() => {
            if (activeReview && saveDirector({ review: { ...state.review, [`${reviewKind}/${activeReview.id}`]: lineFingerprint(data, activeReview, reviewKind) } })) nextReview(activeReview.id);
          }}>通过并下一句</button>
          <button className={styles.chip} disabled={!activeReview || disabled} onClick={() => nextReview(activeReview?.id)}>跳过</button>
          {activeReview && <span className={styles.reviewText}>{activeReview.text}</span>}
        </div>
        <div className={styles.actionRow}>
          <input aria-label="审阅批注" placeholder="给选区或当前句留批注" maxLength={300} value={note} onChange={event => setNote(event.target.value)} />
          <button className={styles.toolBtn} disabled={!area.length || !note.trim() || disabled} onClick={() => {
            if (saveDirector({ notes: [...notes, ...area.map(range => ({
              id: crypto.randomUUID(), range, text: note.trim(), resolved: false, audioRefs: audioRefs([range]),
            }))] })) setNote('');
          }}>添加时间批注</button>
        </div>
        {notes.map(item => <div className={styles.actionRow} key={item.id}>
          <button className={styles.chip} onClick={() => { setRanges([item.range]); play([item.range]); }}>{displayTime(item.range.startMs)} – {displayTime(item.range.endMs)}</button>
          <span className={styles.reviewText}>{item.text}</span>
          {!!item.audioRefs.length && <details className={styles.referenceAudio}><summary>{item.audioRefs.length} 个参考音频</summary>
            {item.audioRefs.map((ref, index) => <audio key={ref} controls preload="none" aria-label={`参考音频 ${index + 1}`} src={mediaUrl(ref)} />)}
          </details>}
          <button className={styles.chip} disabled={disabled} onClick={() => saveDirector({ notes: notes.map(entry => entry.id === item.id ? {
            ...entry, audioRefs: [...new Set([...entry.audioRefs, ...audioRefs([item.range])])],
          } : entry) })}>附上当前配音</button>
          <button className={styles.chip} disabled={disabled} onClick={() => saveDirector({ notes: notes.map(entry => entry.id === item.id ? {
            ...entry, resolved: !entry.resolved,
          } : entry) })}>{item.resolved ? '重新打开' : '标为已处理'}</button>
        </div>)}
      </>}
      {feedback && <div className={styles.panelHint} role="status">{feedback}</div>}
    </div>
    </details>
  </section>;
}
