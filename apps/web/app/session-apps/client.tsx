'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { DramaWorkbench, assertMediaSize, assertProjectRelativePath, useSessionMedia } from '@bezier/canvas-pack-drama-audio';
import { createCliAssistant, snapshotScene } from './cli-assistant';
import styles from './workbench.module.css';

type CanvasNode = { id: string; kind: string; title?: string; x: number; y: number; data?: Record<string, unknown>; [key: string]: unknown };
type CanvasState = { revision: number; state: { workbenchBasicNodes: CanvasNode[] } };
const DEMO_PROJECT = 'drama-demo-5d85c5e8-5a1a-4ee6-be99-557ab015ec42';

const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);

async function readState(projectId: string): Promise<CanvasState> {
  const response = await fetch(`/api/apps/canvas/instances/${encodeURIComponent(projectId)}/state`);
  const body = await response.json() as { data?: CanvasState };
  if (!response.ok || !body.data || !Number.isInteger(body.data.revision) || !Array.isArray(body.data.state?.workbenchBasicNodes)) throw new Error('画布状态读取失败');
  return body.data;
}

export default function SessionAppsClient() {
  const [projectId] = useState(DEMO_PROJECT);
  const [cards, setCards] = useState<CanvasNode[]>([]);
  const [activeCardId, setActiveCardId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [welcomeShown, setWelcomeShown] = useState(false);
  const [welcomeHiding, setWelcomeHiding] = useState(false);
  const welcomeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const enterWorkbench = useCallback(() => {
    if (welcomeTimer.current) return;
    setWelcomeHiding(true);
    welcomeTimer.current = setTimeout(() => setWelcomeShown(true), 340);
  }, []);
  useEffect(() => () => { if (welcomeTimer.current) clearTimeout(welcomeTimer.current); }, []);
  const media = useSessionMedia();
  const projectRef = useRef(projectId);
  projectRef.current = projectId;
  /** 卡片有本地未确认的编辑在提交中时，轮询刷新不得用服务端的旧快照覆盖它，
   * 否则 useCardEdits 会把这次轮询误判为"外部修改"，丢弃刚导入的素材。 */
  const inflightCardIds = useRef<Set<string>>(new Set());

  const refresh = useCallback(async (id: string) => {
    const state = await readState(id);
    if (projectRef.current !== id) return;
    const available = state.state.workbenchBasicNodes.filter(item => item.kind === 'card.drama.audio');
    setCards(previous => available.map(next => {
      const existing = previous.find(item => item.id === next.id);
      if (!existing) return next;
      if (inflightCardIds.current.has(next.id)) return existing;
      // 轮询返回的是全新 JSON 对象；内容其实没变时复用旧引用，避免把编辑器里
      // 正在进行中的操作（导入对话框、异步探测时长等）误判成“内容已变化”而中止。
      return same(existing, next) ? existing : next;
    }));
    setActiveCardId(prev => available.some(item => item.id === prev) ? prev : (available[0]?.id ?? null));
    setError(available.length ? '' : '当前项目暂无短剧配音卡，请在画布中创建 card.drama.audio 卡片。');
  }, []);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const update = async () => {
      try { await refresh(projectId); }
      catch (reason) { if (active) setError(reason instanceof Error ? reason.message : '加载失败'); }
      if (active) timer = setTimeout(update, 1500);
    };
    void update();
    return () => { active = false; clearTimeout(timer); };
  }, [projectId, refresh]);

  const makeOnPatch = useCallback((cardId: string) => async (patch: { data?: Record<string, unknown>; [key: string]: unknown }) => {
    const id = projectRef.current;
    inflightCardIds.current.add(cardId);
    try {
      const state = await readState(id);
      const saved = state.state.workbenchBasicNodes.find(item => item.id === cardId);
      if (!saved) throw new Error('卡片已从画布移除');
      const updated = { ...saved, ...patch, data: { ...(saved.data ?? {}), ...(patch.data ?? {}) } };
      const response = await fetch(`/api/projects/${encodeURIComponent(id)}/canvas/state`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ expectedRevision: state.revision, changes: { workbenchBasicNodes: state.state.workbenchBasicNodes.map(item => item.id === cardId ? updated : item) } }),
      });
      if (!response.ok) throw new Error(`保存失败 HTTP ${response.status}；不自动重试`);
      // 用这次写入后的卡片内容直接更新本地状态，不必等下一轮轮询，避免短暂空窗被旧快照抢先覆盖。
      setCards(previous => previous.map(item => item.id === cardId ? updated : item));
    } finally {
      inflightCardIds.current.delete(cardId);
    }
  }, []);

  const boundMedia = (cardIdForMedia: string) => ({
    ...media,
    resolve: (ref: string) => {
      const sessionUrl = media.resolve(ref);
      if (sessionUrl) return sessionUrl;
      if (ref.startsWith('card-assets/drama-audio/session/')) return undefined;
      assertProjectRelativePath(ref, 'mediaRef');
      return `/api/projects/${encodeURIComponent(projectId)}/raw/${ref.split('/').map(encodeURIComponent).join('/')}`;
    },
    add: async (file: File) => {
      assertMediaSize(file);
      const form = new FormData();
      form.set('dir', file.type.startsWith('video/') ? 'inputs' : 'outputs/voice');
      form.append('files', file, file.name);
      let response: Response;
      try { response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/upload`, { method: 'POST', body: form }); }
      catch (reason) { throw new Error(`媒体上传失败：网络请求未完成（${reason instanceof Error ? reason.message : '未知错误'}）`); }
      let body: { files?: { name?: string }[] } | undefined;
      try { body = await response.json() as { files?: { name?: string }[] }; } catch { /* 下面用响应状态兜底报错 */ }
      // 本函数每次只上传一个文件，直接取返回数组里对应的第一项；
      // 按 originalName 字符串比对在真实浏览器里对中文/特殊字符文件名不可靠，曾导致明明上传成功也误报失败。
      const ref = body?.files?.[0]?.name;
      if (!response.ok || !ref) throw new Error(`媒体上传失败，未写入卡片（HTTP ${response.status}）`);
      assertProjectRelativePath(ref, 'mediaRef');
      return ref;
    },
    _forCard: cardIdForMedia,
  });

  return <>
    {!welcomeShown && <div className={`${styles.welcomeOverlay} ${welcomeHiding ? styles.welcomeOverlayHide : ''}`} role="dialog" aria-modal="true" aria-label="欢迎界面" tabIndex={0} onClick={enterWorkbench} onKeyDown={event => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); enterWorkbench(); }
    }}>
      <div className={`${styles.welcomeGlow} ${styles.welcomeGlowA}`} aria-hidden />
      <div className={`${styles.welcomeGlow} ${styles.welcomeGlowB}`} aria-hidden />
      <div className={`${styles.welcomeGlow} ${styles.welcomeGlowC}`} aria-hidden />
      <div className={styles.welcomeStars} aria-hidden />
      <div className={`${styles.welcomeRing} ${styles.welcomeRingA}`} aria-hidden />
      <div className={`${styles.welcomeRing} ${styles.welcomeRingB}`} aria-hidden />
      <div className={styles.welcomeGrid} aria-hidden />
      <div className={styles['ha-spectrum']} aria-hidden title="模拟音频节奏">
        {Array.from({ length: 96 }, (_, index) => <span key={index} className={styles['ha-spectrum-ray']} style={{ transform: `rotate(${index * 3.75}deg)` }}>
          <span className={styles['ha-spectrum-bar']} style={{ animationDelay: `${-(index * 0.137 % 2.4)}s`, animationDuration: `${1.1 + index % 7 * 0.17}s` }} />
        </span>)}
        <span className={styles['ha-radial-wave']} />
        <span className={styles['ha-radial-wave']} style={{ animationDelay: '-1s' }} />
        <span className={styles['ha-radial-wave']} style={{ animationDelay: '-2s' }} />
        <span className={styles['ha-hud-core']} />
      </div>
      <div className={styles.welcomeCard}>
        <p className={styles.welcomeBrand}>我是 DesignAI</p>
        <h2 className={styles.welcomeTitle}>欢迎导演</h2>
        <p className={styles.welcomeSub}>台词已就绪，随时开机</p>
        <p className={styles.welcomeTip}>任意点击即可开始</p>
      </div>
    </div>}
    <div hidden={!welcomeShown}>
      <div className={styles.sessionControls}>
        <a href={`/?projectId=${encodeURIComponent(projectId)}`}>打开画布</a>
        <span>新版短剧导演工作台</span>
        {cards.length > 1 && cards.map(card => (
          <button key={card.id} type="button" onClick={() => setActiveCardId(card.id)}
            style={{ fontWeight: card.id === activeCardId ? 'bold' : undefined }}>
            {card.title ?? card.id}
          </button>
        ))}
      </div>
      {error && <div className={styles.sessionError} role="alert">{error}</div>}
      {cards.length === 0 && !error && <div className={styles.sessionEmpty} role="status">正在加载新版短剧导演工作台…</div>}
      {cards.map(card => {
        const pid = projectId;
        const cid = card.id;
        return (
          <div key={cid} hidden={cid !== activeCardId}>
            <DramaWorkbench
              node={card}
              selected
              media={boundMedia(cid)}
              assistantAgent={createCliAssistant(() => pid, () => cid, () => snapshotScene(cards))}
              onPatch={makeOnPatch(cid)}
              onClose={() => {
                if (cards.length > 1) setActiveCardId(cards.find(item => item.id !== cid)?.id ?? null);
                else window.location.assign(`/?projectId=${encodeURIComponent(pid)}`);
              }}
            />
          </div>
        );
      })}
    </div>
  </>;
}
