import { myflickerAvailable, askMyflicker } from '@/src/server/myflicker-cli';
import { applyCanvasActions, parseCanvasActions, renderReceiptLines } from '@/src/server/canvas-actions';
import { snapshotScene, type SceneSnapshot } from '@/app/session-apps/cli-assistant';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function validId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\u0000-\u001f]/u.test(value);
}

export async function GET() {
  try {
    const { available, reason } = await myflickerAvailable();
    return Response.json({ ok: true, available, reason });
  } catch {
    return Response.json({ ok: true, available: false, reason: 'CLI_CHECK_FAILED' }, { status: 200 });
  }
}

export async function POST(request: Request) {
  let body: unknown;
  try { body = await request.json(); } catch {
    return Response.json({ ok: false, error: { code: 'INVALID_BODY', message: '请求体必须是 JSON' } }, { status: 400 });
  }
  const obj = body as Record<string, unknown>;
  const projectId = obj.projectId;
  const cardId = obj.cardId;
  const prompt = typeof obj.prompt === 'string' ? obj.prompt.trim() : '';
  const lines = Array.isArray(obj.lines) ? obj.lines : undefined;
  const sceneRaw = obj.scene;

  if (!validId(projectId) || !validId(cardId)) {
    return Response.json({ ok: false, error: { code: 'INVALID_ID', message: 'projectId 或 cardId 不合法' } }, { status: 400 });
  }
  if (!prompt || prompt.length > 2000) {
    return Response.json({ ok: false, error: { code: 'INVALID_PROMPT', message: 'prompt 必须为 1–2000 字符' } }, { status: 400 });
  }

  let normalizedLines: { id: string; text: string }[] | undefined;
  if (lines) {
    try {
      normalizedLines = lines.map((item: unknown) => {
        const row = item as Record<string, unknown>;
        if (typeof row.id !== 'string' || typeof row.text !== 'string') throw new Error('line 格式不合法');
        return { id: row.id, text: row.text };
      });
    } catch {
      return Response.json({ ok: false, error: { code: 'INVALID_LINES', message: 'lines 格式不合法' } }, { status: 400 });
    }
  }

  let scene: SceneSnapshot | undefined;
  if (sceneRaw !== undefined) {
    if (!sceneRaw || typeof sceneRaw !== 'object' || Array.isArray(sceneRaw)) {
      return Response.json({ ok: false, error: { code: 'INVALID_SCENE', message: 'scene 必须是对象' } }, { status: 400 });
    }
    const rawCards = (sceneRaw as { cards?: unknown }).cards;
    if (!Array.isArray(rawCards) || rawCards.length > 50) {
      return Response.json({ ok: false, error: { code: 'INVALID_SCENE', message: 'scene.cards 必须是不超过 50 张卡的数组' } }, { status: 400 });
    }
    try {
      scene = snapshotScene(rawCards.map((item: unknown) => {
        const card = item as Record<string, unknown>;
        if (!validId(card.id)) throw new Error('card id 不合法');
        if (!validId(card.kind)) throw new Error('card kind 不合法');
        const data = card.data && typeof card.data === 'object' && !Array.isArray(card.data) ? card.data as Record<string, unknown> : undefined;
        return {
          id: card.id,
          kind: card.kind,
          title: typeof card.title === 'string' ? card.title.slice(0, 200) : undefined,
          x: typeof card.x === 'number' ? Math.round(card.x) : 0,
          y: typeof card.y === 'number' ? Math.round(card.y) : 0,
          data,
        };
      }));
    } catch (reason) {
      return Response.json({ ok: false, error: { code: 'INVALID_SCENE', message: reason instanceof Error ? reason.message : 'scene 格式不合法' } }, { status: 400 });
    }
    if (new TextEncoder().encode(JSON.stringify(scene)).byteLength > 64_000) {
      return Response.json({ ok: false, error: { code: 'INVALID_SCENE', message: 'scene 超过 64 KB 限制' } }, { status: 400 });
    }
  }

  const result = await askMyflicker({ prompt, projectId: projectId as string, cardId: cardId as string, lines: normalizedLines, scene });

  if (!result.ok) {
    const statusMap: Record<string, number> = {
      CLI_NOT_FOUND: 503,
      CLI_BUSY_TIMEOUT: 429,
      CLI_TIMEOUT: 504,
      CLI_NONZERO_EXIT: 502,
      CLI_OUTPUT_INVALID: 502,
      CLI_PROMPT_INVALID: 400,
      CLI_CWD_INVALID: 400,
    };
    return Response.json({ ok: false, error: { code: result.code, message: result.reason } }, { status: statusMap[result.code] ?? 500 });
  }

  // 受控动作执行：CLI 只提议（```canvas-actions 块），服务端校验后代写并附回执。
  const actions = parseCanvasActions(result.text);
  const { receipts, invalid, conflict } = await applyCanvasActions(projectId as string, actions);
  return Response.json({ ok: true, text: result.text + renderReceiptLines(receipts, invalid), ...(conflict ? { conflict: true } : {}) });
}
