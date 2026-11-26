import type { AssistantAgent, AssistantStreamEvent } from '@bezier/canvas-pack-drama-audio';

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

/** 与服务端 SSE 错误码对应的用户文案；与旧 JSON 路径的 HTTP 状态映射保持一致。 */
const AGENT_ERROR_TEXT: Record<string, string> = {
  CLI_NOT_FOUND: '本机未检测到已登录的 myflicker CLI，请先在终端安装并登录。',
  CLI_BUSY_TIMEOUT: '本机 Agent 正忙，请稍后重试；不会自动重试。',
  CLI_TIMEOUT: '本机 Agent 执行超时，请稍后重试；不会自动重试。',
};

/** 消费 agent-assist 的 SSE 流：CLI 事件实时透传给 onEvent，done 事件落定最终文本或错误。 */
async function consumeAgentSse(response: Response, onEvent?: (event: AssistantStreamEvent) => void): Promise<{ text: string }> {
  const reader = response.body?.getReader();
  if (!reader) throw Object.assign(new Error('Agent 响应流不可用'), { code: 'STREAM_UNAVAILABLE' });
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (value) buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split('\n\n');
    buffer = frames.pop() ?? '';
    for (const frame of frames) {
      const dataLine = frame.split('\n').find(line => line.startsWith('data: '));
      if (!dataLine) continue;
      let payload: Record<string, unknown>;
      try { payload = JSON.parse(dataLine.slice(6)) as Record<string, unknown>; } catch { continue; }
      if (payload.type === 'status' || payload.type === 'thinking' || payload.type === 'text') {
        onEvent?.(payload as AssistantStreamEvent);
        continue;
      }
      if (payload.type === 'applying') {
        onEvent?.({ type: 'status', text: '正在执行画布动作…' });
        continue;
      }
      if (payload.type === 'done') {
        if (payload.ok === true && typeof payload.text === 'string') return { text: payload.text };
        const code = typeof payload.code === 'string' ? payload.code : 'AGENT_FAILED';
        const message = typeof payload.message === 'string' ? payload.message : '请求失败';
        throw Object.assign(new Error(AGENT_ERROR_TEXT[code] ?? message), { code });
      }
    }
    if (done) throw Object.assign(new Error('Agent 连接中断；不会自动重试。'), { code: 'STREAM_CLOSED' });
  }
}

export function createCliAssistant(projectId: () => string, cardId: () => string, scene?: () => SceneSnapshot): AssistantAgent {
  return {
    async status() {
      const response = await fetch('/api/session-apps/agent-assist', { method: 'GET' });
      if (!response.ok) return { available: false, reason: 'CHECK_FAILED' };
      const body = await response.json() as { ok: boolean; available?: boolean; reason?: string };
      return { available: body.available ?? false, reason: body.reason };
    },
    async ask(prompt: string, context?: { lines?: { id: string; text: string }[]; onEvent?: (event: AssistantStreamEvent) => void }) {
      // 有 onEvent 就走 SSE：服务端把 CLI 的思考/增量输出实时下发。流式下 CLI 空闲超时 + 5 分钟总上限，
      // 排队等待同宽 5 分钟且在 CLI 之前发生，加上动作回执（dub 等）的执行时间，客户端超时取 11 分钟兜底。
      const response = await fetch('/api/session-apps/agent-assist', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          projectId: projectId(), cardId: cardId(), prompt, lines: context?.lines, scene: scene?.(),
          stream: Boolean(context?.onEvent),
        }),
        signal: AbortSignal.timeout(660_000),
      });
      const contentType = response.headers.get('content-type') ?? '';
      if (contentType.includes('text/event-stream')) return consumeAgentSse(response, context?.onEvent);
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
