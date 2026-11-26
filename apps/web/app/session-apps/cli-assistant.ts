import type { AssistantAgent } from '@bezier/canvas-pack-drama-audio';

export interface SceneCard {
  id: string;
  kind: string;
  title?: string;
  x: number;
  y: number;
  data?: Record<string, unknown>;
}

export interface SceneSnapshot { cards: SceneCard[] }

/** 给 CLI 的画布现场：只送 id/类型/标题/坐标、字符串型 data（截断）与分段 id 列表。
 * 分段 id 本身不是隐私内容（不含台词原文），但没有它 Agent 无法引用真实 segmentId，
 * 只能瞎猜，导致写 speed/mute/trim/gap 这类必须指定 segmentId 的动作时出错。 */
export function snapshotScene(cards: { id: string; kind: string; title?: string; x: number; y: number; data?: Record<string, unknown> }[]): SceneSnapshot {
  return {
    cards: cards.map(card => {
      const segments = Array.isArray(card.data?.segments)
        ? (card.data!.segments as unknown[]).map((segment, index) => {
            const row = segment as Record<string, unknown>;
            return typeof row.id === 'string' ? row.id : `#${index}`;
          })
        : [];
      return {
        id: card.id,
        kind: card.kind,
        title: card.title,
        x: card.x,
        y: card.y,
        data: {
          ...(card.data
            ? Object.fromEntries(Object.entries(card.data)
              .filter(([, value]) => typeof value === 'string')
              .map(([key, value]) => [key, String(value).slice(0, 200)]))
            : {}),
          ...(segments.length ? { segmentIds: segments.join(',') } : {}),
        },
      };
    }),
  };
}

export function createCliAssistant(projectId: () => string, cardId: () => string, scene?: () => SceneSnapshot): AssistantAgent {
  return {
    async status() {
      const response = await fetch('/api/session-apps/agent-assist', { method: 'GET' });
      if (!response.ok) return { available: false, reason: 'CHECK_FAILED' };
      const body = await response.json() as { ok: boolean; available?: boolean; reason?: string };
      return { available: body.available ?? false, reason: body.reason };
    },
    async ask(prompt: string, context?: { lines?: { id: string; text: string }[] }) {
      const response = await fetch('/api/session-apps/agent-assist', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectId: projectId(), cardId: cardId(), prompt, lines: context?.lines, scene: scene?.() }),
      });
      const body = await response.json() as { ok: boolean; text?: string; error?: { code?: string; message?: string } };
      if (!body.ok || typeof body.text !== 'string') {
        const code = body.error?.code ?? `HTTP_${response.status}`;
        const message = body.error?.message ?? '请求失败';
        if (response.status === 503) throw Object.assign(new Error(`本机未检测到已登录的 myflicker CLI，请先在终端安装并登录。`), { code });
        if (response.status === 429) throw Object.assign(new Error(`本机 Agent 正忙，请稍后重试；不会自动重试。`), { code });
        if (response.status === 504) throw Object.assign(new Error(`本机 Agent 执行超时，请稍后重试；不会自动重试。`), { code });
        throw Object.assign(new Error(message), { code });
      }
      return { text: body.text };
    },
  };
}
