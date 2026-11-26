import { readAgentRun } from '@/src/server/agent-runs';

/** Agent run SSE（帧格式对齐参考 /api/runs/:id/events：id / event / data）。 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ runId: string }> }) {
  const { runId } = await context.params;
  const lastEventId = Number(request.headers.get('last-event-id') ?? '0');
  const afterId = Number.isSafeInteger(lastEventId) && lastEventId >= 0 ? lastEventId : 0;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const send = (id: number, event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      const deadline = Date.now() + 10 * 60 * 1000;
      let cursor = afterId;
      try {
        while (Date.now() < deadline) {
          const snapshot = readAgentRun(runId, cursor);
          if (!snapshot) { send(cursor, 'error', { type: 'diagnostic', text: 'run 不存在或已过期' }); controller.close(); return; }
          for (const event of snapshot.events) { send(event.id, event.event, event.data); cursor = event.id; }
          if (snapshot.done) { send(cursor + 1, 'end', { type: 'status', status: 'closed' }); controller.close(); return; }
          await new Promise(resolve => setTimeout(resolve, 300));
        }
        send(cursor + 1, 'end', { type: 'status', status: 'timeout' });
        controller.close();
      } catch {
        try { controller.close(); } catch { /* already closed */ }
      }
    },
  });
  return new Response(stream, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' } });
}
