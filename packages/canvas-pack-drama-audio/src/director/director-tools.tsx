'use client';

import type { RefObject } from 'react';
import { useState } from 'react';
import type { DubbingPlayback } from '../dubbing-editor';
import type { RewriteLine as TimedDubbingLine } from '../rewrite';
import { intersecting, listenLabel, makeRange } from './director-edits';
import type { ListenMode, TimeRange } from './director-edits';
import styles from './workbench.module.css';

/** 2026-11-26 用户验收后移除「选区工具 · 音量与节奏」折叠面板（选区与试听 / 间隔与标记 / 音量）。
 * 保留播放控制与试听音轨切换；时间轴框选仍可直接用于导出选区 MP4，
 * 整轨音量调节在轨道检查器，句间停顿走时间轴编辑或卡片 Agent 动作通道。 */
type Props = {
  rows: TimedDubbingLine[];
  duration: number;
  time: () => number;
  select: (id: string) => void;
  ranges: TimeRange[];
  mode: ListenMode;
  setMode: (mode: ListenMode) => void;
  /** 是否存在背景音乐轨（决定试听音轨里能否切背景）。 */
  hasBackground: boolean;
  playback: RefObject<DubbingPlayback>;
  disabled: boolean;
  /** 视频正在播放：播放键显示为暂停。 */
  playing?: boolean;
};

export function DirectorTools({ rows, duration, time, select, ranges, mode, setMode, hasBackground, playback, disabled, playing = false }: Props) {
  const [feedback, setFeedback] = useState('');
  const listening: ListenMode[] = hasBackground ? ['mix', 'original', 'voice', 'background'] : ['mix', 'original', 'voice'];

  function play(items?: TimeRange[]) {
    void playback.current?.play(items?.map(range => ({ startMs: range.startMs, endMs: range.endMs }))).catch(error => {
      setFeedback(error instanceof Error ? error.message : '无法播放');
    });
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
      {feedback && <span className={styles.panelHint} role="status">{feedback}</span>}
    </div>
  </section>;
}
