import React from 'react';
import { projectFetchWithContext } from './api-base';
import { useCanvasFlush, useCanvasState, useCanvasRequestContext } from './canvas-compat';
import { cr } from '../locales/canvas-remainder';

type Submission = Record<string, any> & { clientRequestId: string; canvasDelivery: { nodeId: string; kind: 'image' | 'video'; basePath: string; baseVersion: string; fileUrl: string } };
const pending = new Map<string, Promise<Response>>();

/** The outbox stores the exact authorized request; retries never invent an ID. */
export function useCanvasMediaSubmission() {
  const context = useCanvasRequestContext();
  const flush = useCanvasFlush();
  const [outbox, setOutbox] = useCanvasState<Record<string, Submission>>('workbenchMediaSubmissions', {});
  const [nodes] = useCanvasState<Array<{ id: string }>>('workbenchBasicNodes', []);
  const [images, setImages] = useCanvasState<Array<Record<string, any> & { id: string }>>('workbenchImages', []);
  const current = React.useRef({ nodes, images });
  current.current = { nodes, images };
  const remove = (id: string) => setOutbox(entries => {
    if (!entries[id]) return entries;
    const next = { ...entries }; delete next[id]; return next;
  });
  const send = async (body: Submission): Promise<Response> => {
    const key = `${context.projectId}:${body.clientRequestId}`;
    let request = pending.get(key);
    if (!request) {
      request = projectFetchWithContext(context, '/media/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      }).then(async response => {
        // Consume a clone so a truncated/lost response remains recoverable.
        const payload = await response.clone().json();
        const rejected = response.status >= 400 && response.status < 500 && response.status !== 429;
        if (rejected && body.canvasDelivery.kind === 'image') {
          const taskId = `canvas-${body.clientRequestId}`;
          setImages(items => items.map(item => {
            if (item.id === body.canvasDelivery.nodeId && item.taskId === taskId && !item.mediaDelivery) return {
              ...item, status: item.path ? item.status : 'failed', cutoutTaskId: undefined,
              error: typeof payload.error === 'string' ? payload.error : payload.error?.message || cr().taskNotAccepted,
            };
            return item.id !== body.canvasDelivery.nodeId && item.cutoutTaskId === taskId ? { ...item, cutoutTaskId: undefined } : item;
          }));
        }
        if ((response.ok && payload.taskId) || rejected) remove(body.clientRequestId);
        return response;
      }).finally(() => pending.delete(key));
      pending.set(key, request);
    }
    return (await request).clone();
  };
  React.useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const recover = async () => {
      for (const body of Object.values(outbox)) {
        if (disposed) return;
        const targets = body.canvasDelivery.kind === 'video' ? current.current.nodes : current.current.images;
        if (!targets.some(node => node.id === body.canvasDelivery.nodeId)) { remove(body.clientRequestId); continue; }
        try { await send(body); } catch { /* Exact request remains in the durable outbox. */ }
      }
      if (!disposed && Object.keys(outbox).length) timer = setTimeout(recover, 3000);
    };
    // The initiating call flushes first; recovery also waits for pending edits.
    void flush().then(() => { if (!disposed) void recover(); }).catch(() => {});
    return () => { disposed = true; clearTimeout(timer); };
  }, [outbox, context.projectId]);

  return async (body: Submission) => {
    setOutbox(entries => ({ ...entries, [body.clientRequestId]: body }));
    await flush();
    return send(body);
  };
}
