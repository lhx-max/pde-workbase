'use client';
import { useEffect, useRef, useState } from 'react';
import styles from './workbench.module.css';

export function SplitClipDialog({ text, atMs, error, onCancel, onSplit }: { text: string; atMs: number; error?: string; onCancel: () => void; onSplit: (boundary: number) => boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const chars = Array.from(text);
  const [boundary, setBoundary] = useState(Math.max(1, Math.floor(chars.length / 2)));
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} className={styles.splitDialog} onCancel={event => { event.preventDefault(); onCancel(); }}>
    <h2>在 {(atMs / 1000).toFixed(2)} 秒分割配音</h2>
    <p>声音会在播放头处切开。拖动下方分句位置，为两段声音分配台词，分割后请试听核对。</p>
    <label>台词分句位置<input type="range" min={1} max={Math.max(1, chars.length - 1)} value={boundary} onChange={event => setBoundary(Number(event.target.value))} /></label>
    <div className={styles.splitPreview}><div><span>前半句</span><p>{chars.slice(0, boundary).join('')}</p></div><div><span>后半句</span><p>{chars.slice(boundary).join('')}</p></div></div>
    {error && <p role="alert" className={styles.operationError}>{error}</p>}
    <div className={styles.actionRow}><button className={styles.toolBtn} onClick={onCancel}>取消</button><button className={`${styles.toolBtn} ${styles.toolBtnPrimary}`} disabled={!chars.slice(0, boundary).join('').trim() || !chars.slice(boundary).join('').trim()} onClick={() => onSplit(boundary)}>分割并保留原音频</button></div>
  </dialog>;
}
