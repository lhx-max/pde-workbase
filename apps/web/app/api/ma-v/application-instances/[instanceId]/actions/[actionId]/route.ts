import { maProviderActionRequestSchema } from '@bezier/contracts';
import { randomUUID } from 'node:crypto';

/** Session Apps 本地联调动作转发（结构源自 design-ai-client-integration 的
 * daemon BFF：浏览器 → 本路由 → Manifest 声明的本地 Provider）。
 * 本仓没有应用目录服务；本地 demo 将 applicationInstanceId 直接映射为
 * providerInstanceId（单实例联调简化，生产目录映射未接入时显式报不可用）。
 * Provider 不可达时返回 PROVIDER_UNAVAILABLE，不冒充成功。 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const providerBase = () => {
  const base = process.env.SESSION_APP_PROVIDER_BASE_URL ?? 'http://127.0.0.1:4310';
  const url = new URL(base);
  if (url.username || url.password || url.search || url.hash || !['http:', 'https:'].includes(url.protocol)) {
    throw new Error('PROVIDER_BASE_INVALID');
  }
  return base.replace(/\/$/u, '');
};

export async function POST(request: Request, context: { params: Promise<{ instanceId: string; actionId: string }> }) {
  const { instanceId, actionId } = await context.params;
  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ ok: false, error: { code: 'INVALID_BODY', message: '请求体必须是 JSON' } }, { status: 400 }); }
  const parsed = maProviderActionRequestSchema.safeParse({
    applicationInstanceId: instanceId, sessionId: (body as { sessionId?: unknown })?.sessionId,
    actionId, expectedRevision: (body as { expectedRevision?: unknown })?.expectedRevision,
    input: (body as { input?: unknown })?.input ?? {},
  });
  if (!parsed.success) return Response.json({ ok: false, error: { code: 'INVALID_ACTION', message: '动作请求不符合契约' } }, { status: 400 });
  const idempotencyKey = randomUUID();
  let providerResponse: Response;
  try {
    providerResponse = await fetch(`${providerBase()}/open-platform/v1/instances/${encodeURIComponent(instanceId)}/actions/${encodeURIComponent(actionId)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': idempotencyKey },
      body: JSON.stringify({
        protocolVersion: '1.0', providerInstanceId: instanceId, actionId,
        input: parsed.data.input, idempotencyKey,
        ...(parsed.data.expectedRevision !== undefined ? { expectedRevision: parsed.data.expectedRevision } : {}),
      }),
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return Response.json({ ok: false, error: { code: 'PROVIDER_UNAVAILABLE', message: '本机便签服务未启动或不可达（127.0.0.1:4310），请先启动 examples/notes-app/provider.ts' } }, { status: 502 });
  }
  const payload = await providerResponse.json().catch(() => null) as { error?: { message?: string; code?: string }; summary?: string; revision?: number; data?: unknown } | null;
  if (!providerResponse.ok) {
    return Response.json({ ok: false, error: { code: payload?.error?.code ?? `PROVIDER_HTTP_${providerResponse.status}`, message: payload?.error?.message ?? `Provider HTTP ${providerResponse.status}` } }, { status: providerResponse.status === 404 ? 404 : 502 });
  }
  return Response.json({ ok: true, requestId: randomUUID(), result: { summary: payload?.summary ?? '', revision: payload?.revision ?? 0, data: payload?.data ?? {} } });
}
