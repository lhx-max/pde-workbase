import { randomUUID } from 'node:crypto';
import { consumeMaEventStream, createMaSession, postMaUserMessage, resolveMaClientConfig, type MaStreamEvent } from './ma-client';

/** Agent run 内存编排（参考 daemon /api/runs 的最小形态）：
 * POST run 立即返回 runId，后台执行 createSession → 先连 SSE 流 → POST 用户
 * 消息 → 事件写入缓存；浏览器端 SSE 路由按 Last-Event-ID 重放。globalThis
 * 挂载避免 dev 热重载丢态。 */

export interface AgentRunEvent {
  id: number;
  event: 'agent' | 'end' | 'error';
  data: { type: 'text_delta' | 'thinking_delta' | 'tool_status' | 'status' | 'diagnostic'; text?: string; status?: string; label?: string };
}

interface AgentRunRecord {
  runId: string;
  events: AgentRunEvent[];
  done: boolean;
  error?: string;
}

interface AgentRunStore { runs: Map<string, AgentRunRecord>; }

const globalStore = globalThis as typeof globalThis & { __sessionAppAgentRuns?: AgentRunStore };
const store: AgentRunStore = globalStore.__sessionAppAgentRuns ?? { runs: new Map() };
globalStore.__sessionAppAgentRuns = store;

function append(run: AgentRunRecord, event: AgentRunEvent['event'], data: AgentRunEvent['data']): void {
  run.events.push({ id: run.events.length + 1, event, data });
}

export function startAgentRun(prompt: string): string {
  const runId = `run_${randomUUID().replace(/-/gu, '')}`;
  const record: AgentRunRecord = { runId, events: [], done: false };
  store.runs.set(runId, record);
  void (async () => {
    try {
      const config = resolveMaClientConfig();
      const sessionId = await createMaSession(config, `session-apps ${new Date().toISOString()}`);
      append(record, 'agent', { type: 'status', status: 'session_created', label: sessionId });
      let connected = false;
      const onEvent = (event: MaStreamEvent) => {
        if (event.kind === 'thinking') append(record, 'agent', { type: 'thinking_delta', text: event.delta });
        else if (event.kind === 'text') append(record, 'agent', { type: 'text_delta', text: event.delta });
        else if (event.kind === 'status') { if (event.status === 'stream_connected') connected = true; append(record, 'agent', { type: 'status', status: event.status }); }
        else if (event.kind === 'tool') append(record, 'agent', { type: 'tool_status', label: typeof event.raw.type === 'string' ? event.raw.type : 'tool' });
        else if (event.kind === 'error') { append(record, 'agent', { type: 'diagnostic', text: 'MA 事件流错误' }); record.error = 'MA 事件流错误'; }
      };
      // 参考实现约束：先连上事件流，再 POST 用户消息，否则该轮可能无订阅者。
      const streamDone = consumeMaEventStream(config, sessionId, onEvent, { timeoutMs: 10 * 60 * 1000 });
      const deadline = Date.now() + 10_000;
      while (!connected && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100));
      if (!connected) throw new Error('MA 事件流未就绪，未发送用户消息');
      await postMaUserMessage(config, sessionId, prompt);
      const terminal = await streamDone;
      if (record.error) throw new Error(record.error);
      append(record, 'end', { type: 'status', status: 'finished', label: terminal ?? 'closed' });
    } catch (reason) {
      append(record, 'error', { type: 'diagnostic', text: reason instanceof Error ? reason.message : 'Agent 运行失败' });
    } finally {
      record.done = true;
    }
  })();
  return runId;
}

export function readAgentRun(runId: string, afterId: number): { events: AgentRunEvent[]; done: boolean } | null {
  const record = store.runs.get(runId);
  if (!record) return null;
  return { events: record.events.filter(event => event.id > afterId), done: record.done };
}
