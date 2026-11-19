'use client';

import { useEffect, useRef, useState } from 'react';
import { DEFAULT_REWRITE_PROMPT, validateRewriteRequest } from '../rewrite';
import { adoptRewriteDraft, availableRewriteDraft, currentRewriteInput, sameRewriteInput } from '../rewrite-draft';
import { download } from './director-media';
import { requireMedia, type MediaLookup } from './media';
import { sampleVideoFrames } from './sample-frames';
import styles from './workbench.module.css';

type Data = Record<string, unknown>;

export function RewritePanel({ data, read, patch, mediaUrl, disabled, ask }: {
  data: Data;
  read: () => Data;
  patch: (changes: Data) => boolean;
  mediaUrl: MediaLookup;
  disabled: boolean;
  ask: (message: string, label?: string) => Promise<boolean>;
}) {
  const [message, setMessage] = useState('');
  const [preparing, setPreparing] = useState(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const prompt = typeof data.rewritePrompt === 'string' ? data.rewritePrompt : DEFAULT_REWRITE_PROMPT;
  const draft = availableRewriteDraft(data);
  const canSample = typeof data.videoRef === 'string' && !!mediaUrl(data.videoRef);

  async function prepare() {
    if (controller.current) return;
    const job = new AbortController();
    controller.current = job;
    setPreparing(true);
    setMessage('正在采样视频帧…');
    try {
      const input = currentRewriteInput(read());
      const frames = await sampleVideoFrames(requireMedia(mediaUrl, input.videoRef), input.videoDurationMs, job.signal);
      const request = validateRewriteRequest({ ...input, frames });
      if (!sameRewriteInput(input, currentRewriteInput(read()))) throw new Error('原稿、改写要求或视频已变化，请重新采样。');
      job.signal.throwIfAborted();
      download(new Blob([JSON.stringify(request)], { type: 'application/json' }), '短剧改写请求.json');
      setMessage('已下载请求。可通过画布 Agent 或 CLI 提交 card.drama.audio.rewrite 动作。');
    } catch (error) {
      if (!job.signal.aborted) setMessage(error instanceof Error ? error.message : '采样失败。');
    } finally {
      controller.current = null;
      setPreparing(false);
    }
  }

  async function adopt() {
    if (!await ask('采用改写会替换当前台词并清空关联配音。原媒体仍可重新选用。', '采用改写')) return;
    try {
      if (patch(adoptRewriteDraft(read()))) setMessage('已采用改写台词，请逐句核对区间。');
    } catch (error) { setMessage(error instanceof Error ? error.message : '改写未应用。'); }
  }

  return <details className={styles.rewritePanel}>
    <summary>画面采样与改写</summary>
    <label>改写要求<textarea key={prompt} defaultValue={prompt} rows={4} maxLength={20_000} disabled={disabled || preparing}
      onBlur={event => { const value = event.currentTarget.value.trim(); if (value && value !== prompt) patch({ rewritePrompt: value }); }} /></label>
    <button type="button" className={styles.toolBtn} disabled={!canSample || disabled || preparing} onClick={() => void prepare()}>
      {preparing ? '采样中…' : '下载改写请求'}
    </button>
    {draft && <>
      <ol className={styles.rewritePreview}>{draft.map(line => <li key={line.id}>{line.text}</li>)}</ol>
      <button type="button" className={styles.toolBtn} disabled={disabled || preparing} onClick={() => void adopt()}>采用改写台词</button>
    </>}
    {data.rewriteDraft != null && !draft && <p>改写建议已过期，请重新准备请求。</p>}
    {message && <p role="status">{message}</p>}
  </details>;
}
