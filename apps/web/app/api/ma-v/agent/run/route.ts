import { startAgentRun } from '@/src/server/agent-runs';
import { maAgentConfigured } from '@/src/server/ma-client';

/** 用户语言输入 → Agent run（真实 Agent 按 SOP 配置；未配置显式 503，不假成功）。 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ ok: false, error: { code: 'INVALID_BODY', message: '请求体必须是 JSON' } }, { status: 400 }); }
  const prompt = typeof (body as { prompt?: unknown })?.prompt === 'string' ? (body as { prompt: string }).prompt.trim() : '';
  if (!prompt || prompt.length > 20_000) return Response.json({ ok: false, error: { code: 'INVALID_PROMPT', message: 'prompt 必须为 1–20000 字符' } }, { status: 400 });
  if (!maAgentConfigured()) {
    return Response.json({ ok: false, error: { code: 'AGENT_UNAVAILABLE', message: '未配置 MANAGED_AGENT_* 环境变量（按接入 SOP 填入 apps/web/.env.local 并重启）；本地指令脚本仍可用' } }, { status: 503 });
  }
  return Response.json({ ok: true, runId: startAgentRun(prompt) });
}
