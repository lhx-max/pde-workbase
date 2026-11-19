'use client';

import { useEffect, useRef, useState } from 'react';
import type { CardRenderProps } from '@bezier/canvas-card-sdk';
import { useSessionMedia } from './media';
import { Workbench } from './workbench';
import { AudioLines } from './icons';
import { dubbingCounts } from '../dubbing';
import styles from './workbench.module.css';

export function DirectorCard(props: CardRenderProps) {
  const { node } = props;
  const [opened, setOpened] = useState(false);
  const modal = useRef<HTMLDialogElement>(null);
  const openButton = useRef<HTMLButtonElement>(null);
  const media = useSessionMedia();

  useEffect(() => {
    if (opened) modal.current?.showModal();
  }, [opened]);

  function close() {
    modal.current?.close();
    setOpened(false);
    openButton.current?.focus();
  }

  const lines = node.data?.rewriteLines;
  const lineCount = Array.isArray(lines) ? lines.length : 0;
  const counts = dubbingCounts(node.data ?? {});
  const progress = counts.total ? Math.round(counts.current / counts.total * 100) : 0;
  return <div className={`${styles.cardEntry} nodrag nopan nowheel`}>
    <div className={styles.cardTitle}><AudioLines size={16} />{typeof node.title === 'string' && node.title ? node.title : '短剧配音'}</div>
    {lineCount
      ? <><div className={styles.cardStats}><span>{lineCount} 句台词</span><span>配音 {counts.current}/{counts.total}</span><span>待确认 {Math.max(0, counts.total - counts.confirmed)}</span></div>
        <div className={styles.cardProgress} aria-hidden="true"><span style={{ width: `${progress}%` }} /></div></>
      : <div className={styles.cardStats}><span>还没有台词，打开后导入视频和台词</span></div>}
    <button type="button" ref={openButton} className={styles.cardOpen} aria-haspopup="dialog" onClick={() => setOpened(true)}>打开短剧配音编辑器</button>
    {/* Canvas shortcut handlers recognize overlays through the explicit role. */}
    {opened && <dialog ref={modal} role="dialog" className={`${styles.cardDialog} nodrag nopan nowheel`}
      aria-label="短剧配音编辑器" onCancel={event => {
        if (event.target !== event.currentTarget) return;
        event.preventDefault();
        close();
      }}
      onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()} onWheel={event => event.stopPropagation()}>
      <Workbench {...props} media={media} onClose={close} />
    </dialog>}
  </div>;
}
