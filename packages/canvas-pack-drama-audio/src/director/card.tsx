'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CardRenderProps } from '@bezier/canvas-card-sdk';
import { useSessionMedia } from './media';
import { Workbench } from './workbench';
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
  const segments = node.data?.segments;
  const lineCount = Array.isArray(lines) ? lines.length : 0;
  const segmentCount = Array.isArray(segments) ? segments.length : 0;
  return <div className={`${styles.cardEntry} nodrag nopan nowheel`}>
    <p>{lineCount} 句台词 · {segmentCount} 个配音片段</p>
    <button type="button" ref={openButton} aria-haspopup="dialog" onClick={() => setOpened(true)}>打开短剧配音编辑器</button>
    {opened && createPortal(<dialog ref={modal} className={`${styles.cardDialog} nodrag nopan nowheel`}
      aria-label="短剧配音编辑器" onCancel={event => { event.preventDefault(); close(); }}
      onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()} onWheel={event => event.stopPropagation()}>
      <Workbench {...props} media={media} onClose={close} />
    </dialog>, document.body)}
  </div>;
}
