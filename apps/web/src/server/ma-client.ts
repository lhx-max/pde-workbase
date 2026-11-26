import { randomUUID } from 'node:crypto';

/** Managed Agent 客户端（legacy 协议精简版，移植自 design-ai-client-integration
 * 的 apps/daemon/src/runtimes/ma-bridge/ma-client.ts：createSession / postUserMessage
 * / postInterrupt / SSE 事件流）。配置从服务端环境变量读取（MANAGED_AGENT_*，
 * 建议放 apps/web/.env.local，不进前端、不进仓）；任一缺失显式 AGENT_UNAVAILABLE。
 * 约束（源自参考实现）：不带 Origin/Referer（AccessProxy 会 403），redirect
 * manual（302 即 SSO 失效），先连事件流再 POST 消息（由 agent-runs 编排）。 */

export const MA_PROTOCOL_VERSION = '2026-04-01';

export interface MaClientConfig {
  baseUrl: string;
  agentId: string;
  tenantId: string;
  cookie: string;
  model?: string;
}

export function resolveMaClientConfig(env: NodeJS.ProcessEnv = process.env): MaClientConfig {
  const baseUrl = env.MANAGED_AGENT_BASE?.trim();
  const agentId = env.MANAGED_AGENT_ID?.trim();
  const tenantId = env.MANAGED_AGENT_TENANT?.trim();
  const cookie = env.MANAGED_AGENT_COOKIE?.trim();
  if (!baseUrl || !agentId || !tenantId || !cookie) {
    throw new Error('AGENT_UNAVAILABLE：未配置 MANAGED_AGENT_BASE / MANAGED_AGENT_ID / MANAGED_AGENT_TENANT / MANAGED_AGENT_COOKIE（按 docs 参考 SOP 填入 apps/web/.env.local 后重启）');
  }
  const url = new URL(baseUrl);
  if (url.username || url.password || url.search || url.hash || !['http:', 'https:'].includes(url.protocol)) {
    throw new Error('AGENT_UNAVAILABLE：MANAGED_AGENT_BASE 必须是不含凭据的 HTTP/HTTPS URL');
  }
  return { baseUrl: baseUrl.replace(/\/$/u, ''), agentId, tenantId, cookie, model: env.MANAGED_AGENT_MODEL?.trim() || undefined };
}

export function maAgentConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  try { resolveMaClientConfig(env); return true; } catch { return false; }
}

function unwrapResult(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error(`MA 响应非对象: ${String(body).slice(0, 200)}`);
  const envelope = body as Record<string, unknown>;
  if (typeof envelope.code === 'number' && envelope.code !== 0) throw new Error(`MA 业务错误 code=${envelope.code}: ${String(envelope.message ?? '').slice(0, 300)}`);
  const result = (envelope.result ?? envelope.data ?? envelope) as Record<string, unknown>;
  if (!result || typeof result !== 'object') throw new Error(`MA 响应缺 result: ${JSON.stringify(body).slice(0, 300)}`);
  return result;
}

function extractTexts(content: unknown): string {
  if (!Array.isArray(content)) return '';
  return content.map(part => {
    if (!part || typeof part !== 'object') return '';
    const text = (part as { text?: unknown }).text;
    return typeof text === 'string' ? text : '';
  }).join('');
}

function headers(config: MaClientConfig, extra: Record<string, string> = {}): Record<string, string> {
  return {
    accept: '*/*',
    'content-type': 'application/json',
    'x-managed-agents-version': MA_PROTOCOL_VERSION,
    'user-agent': 'canvas-session-apps/0.1',
    cookie: config.cookie,
    ...extra,
  };
}

function assertMaJsonResponse(action: string, response: Response, text: string): void {
  const trimmed = text.trim();
  if (/^<!DOCTYPE html/i.test(trimmed) || /^<html[\s>]/i.test(trimmed) || /<title>\s*Login\s*<\/title>/i.test(trimmed)) {
    throw new Error(`${action} 收到 SSO 登录页而非 MA JSON（Cookie 失效或 BASE 指向错误域）`);
  }
  if (response.status >= 300 && response.status < 400) {
    throw new Error(`${action} 被重定向（${response.status}）— SSO/AccessProxy 拒绝了转发的 Cookie`);
  }
}

async function maJson(config: MaClientConfig, path: string, init?: { method?: string; body?: unknown; accept?: string; signal?: AbortSignal }): Promise<Record<string, unknown>> {
  const response = await fetch(`${config.baseUrl}/v1/ma${path}`, {
    method: init?.method ?? 'GET',
    redirect: 'manual',
    headers: headers(config, init?.accept ? { accept: init.accept } : {}),
    ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    signal: init?.signal ?? AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  assertMaJsonResponse(`ma ${path}`, response, text);
  if (!response.ok) throw new Error(`ma ${path} HTTP ${response.status}: ${text.slice(0, 300)}`);
  try { return unwrapResult(JSON.parse(text)); }
  catch (error) { if (error instanceof SyntaxError) throw new Error(`ma ${path} 非合法 JSON: ${text.slice(0, 200)}`); throw error; }
}

export async function createMaSession(config: MaClientConfig, title: string): Promise<string> {
  const result = await maJson(config, '/sessions', {
    method: 'POST',
    body: { agent: config.agentId, title: title.slice(0, 120), metadata: { tenant_id: config.tenantId } },
  });
  if (typeof result.id !== 'string' || !result.id) throw new Error('MA 会话创建未返回 id');
  return result.id;
}

export async function postMaUserMessage(config: MaClientConfig, sessionId: string, prompt: string): Promise<string> {
  const eventId = `sevt_bridge_${randomUUID().replace(/-/gu, '')}`;
  const event: Record<string, unknown> = { id: eventId, type: 'user.message', content: [{ type: 'text', text: prompt }] };
  if (config.model) event.model = config.model;
  const response = await fetch(`${config.baseUrl}/v1/ma/sessions/${encodeURIComponent(sessionId)}/events`, {
    method: 'POST',
    redirect: 'manual',
    headers: headers(config),
    body: JSON.stringify({ events: [event] }),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  assertMaJsonResponse('postUserMessage', response, text);
  if (!response.ok) throw new Error(`postUserMessage HTTP ${response.status}: ${text.slice(0, 300)}`);
  return eventId;
}

export async function postMaInterrupt(config: MaClientConfig, sessionId: string): Promise<void> {
  const response = await fetch(`${config.baseUrl}/v1/ma/sessions/${encodeURIComponent(sessionId)}/events`, {
    method: 'POST',
    redirect: 'manual',
    headers: headers(config),
    body: JSON.stringify({ events: [{ id: `sevt_bridge_interrupt_${randomUUID().replace(/-/gu, '')}`, type: 'user.interrupt' }] }),
    signal: AbortSignal.timeout(4500),
  }).catch(() => null);
  if (response && !response.ok) await response.body?.cancel().catch(() => {});
}

export type MaStreamEvent =
  | { kind: 'thinking'; delta: string }
  | { kind: 'text'; delta: string }
  | { kind: 'status'; status: string }
  | { kind: 'tool'; raw: Record<string, unknown> }
  | { kind: 'error'; raw: Record<string, unknown> }
  | { kind: 'terminal'; reason: 'idled' | 'terminated' | 'stream_closed' };

/** 订阅 MA 会话事件流；onConnected 应在 POST 消息前等到。返回终态原因。 */
export async function consumeMaEventStream(config: MaClientConfig, sessionId: string,
  onEvent: (event: MaStreamEvent) => void, options: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<'idled' | 'terminated' | 'stream_closed' | 'error' | null> {
  const controller = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let terminal: 'idled' | 'terminated' | 'stream_closed' | 'error' | null = null;
  const stop = () => { controller.abort(); void reader?.cancel().catch(() => {}); };
  const onAbort = () => stop();
  options.signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(stop, options.timeoutMs ?? 10 * 60 * 1000);
  try {
    const response = await fetch(`${config.baseUrl}/v1/ma/sessions/${encodeURIComponent(sessionId)}/events/stream`, {
      redirect: 'manual',
      method: 'GET',
      signal: controller.signal,
      headers: headers(config, { accept: 'text/event-stream', 'content-type': '' }),
    });
    if (!response.ok || !response.body || !response.headers.get('content-type')?.toLowerCase().startsWith('text/event-stream')) {
      await response.body?.cancel().catch(() => {});
      throw new Error(`MA 事件流被拒绝（${response.status}）：检查 Cookie 与认证`);
    }
    reader = response.body.getReader();
    onEvent({ kind: 'status', status: 'stream_connected' });
    const decoder = new TextDecoder();
    let buf = '';
    const handleData = (data: string) => {
      let ev: Record<string, unknown>;
      try { ev = JSON.parse(data) as Record<string, unknown>; } catch { return; }
      const type = typeof ev.type === 'string' ? ev.type : '';
      if (type === 'error' || type === 'RUN_ERROR' || ev.error) { onEvent({ kind: 'error', raw: ev }); terminal = 'error'; return; }
      if (type === 'agent.thinking') onEvent({ kind: 'thinking', delta: extractTexts(ev.content) });
      else if (type === 'REASONING_MESSAGE_CONTENT' && typeof ev.delta === 'string') onEvent({ kind: 'thinking', delta: ev.delta });
      else if (type === 'agent.message') onEvent({ kind: 'text', delta: extractTexts(ev.content) });
      else if (type === 'TEXT_MESSAGE_START' && ev.role === 'assistant') onEvent({ kind: 'status', status: 'ma_response_start' });
      else if (type === 'TEXT_MESSAGE_CONTENT' && ev.role === 'assistant' && typeof ev.delta === 'string') onEvent({ kind: 'text', delta: ev.delta });
      else if (type === 'agent.tool_use' || type === 'agent.tool_result' || type.startsWith('TOOL_CALL_')) onEvent({ kind: 'tool', raw: ev });
      else if (type === 'RUN_STARTED') onEvent({ kind: 'status', status: 'session.status_run_started' });
      else if (type === 'RUN_FINISHED') { onEvent({ kind: 'status', status: 'session.status_idled' }); terminal = 'idled'; }
      else if (['session.status_run_started', 'session.status_idled', 'session.status_terminated'].includes(type)) {
        onEvent({ kind: 'status', status: type });
        if (type === 'session.status_idled') terminal = 'idled';
        if (type === 'session.status_terminated') terminal = 'terminated';
      }
    };
    while (terminal !== 'idled' && terminal !== 'terminated') {
      const { done, value } = await reader.read();
      if (done) { terminal = 'stream_closed'; break; }
      buf += decoder.decode(value, { stream: true });
      for (;;) {
        const boundary = /\r?\n\r?\n/.exec(buf);
        if (!boundary) break;
        const frame = buf.slice(0, boundary.index);
        buf = buf.slice(boundary.index + boundary[0].length);
        const data = frame.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).replace(/^ /u, '')).join('\n');
        handleData(data);
        if (terminal === 'idled' || terminal === 'terminated') break;
      }
    }
    return terminal;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onAbort);
    stop();
  }
}
