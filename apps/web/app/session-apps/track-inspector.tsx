'use client';
import type { EditData, ListenMode } from './director-edits';
import { listenLabel } from './director-edits';
import styles from './workbench.module.css';
export function TrackInspector({ track, data, disabled, mode, setMode, patch }: { track: Exclude<ListenMode, 'mix'>; data: EditData; disabled: boolean; mode: ListenMode; setMode: (mode: ListenMode) => void; patch: (changes: EditData) => boolean }) {
  const key = track === 'original' ? 'directorOriginalGain' : track === 'voice' ? 'masterGain' : 'directorBackgroundGain';
  const value = typeof data[key] === 'number' ? data[key] as number : 1;
  const db = value > 0 ? Math.max(-60, 20 * Math.log10(value)) : -60;
  return <div className={styles.trackInspector}>
    <span className={styles.eyebrow}>音轨属性</span><h2>{listenLabel[track]}</h2>
    <p>调整整条音轨的声音。局部调整可在时间轴框选，再使用选区音量。</p>
    <label>音轨音量 <strong>{value === 0 ? '静音' : `${db.toFixed(1)} dB`}</strong>
      <input type="range" aria-label={`${listenLabel[track]}音轨音量`} min={-60} max={track === 'original' ? 0 : 6} step={.5} value={db} disabled={disabled} onChange={event => patch({ [key]: Number(event.target.value) <= -60 ? 0 : Math.min(2, 10 ** (Number(event.target.value) / 20)) })} />
    </label>
    <div className={styles.actionRow}><button className={styles.toolBtn} aria-pressed={mode === track} onClick={() => setMode(mode === track ? 'mix' : track)}>独听此轨</button><button className={styles.toolBtn} disabled={disabled} onClick={() => patch({ [key]: 1 })}>恢复 0 dB</button></div>
    <p className={styles.panelHint}>0 dB 为原始音量；音轨音量会同时用于试听和导出。</p>
  </div>;
}
