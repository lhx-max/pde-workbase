import { getCanvasHostContext } from './api-base';

type CanvasPersistence = {
  read: () => Record<string, unknown>;
  mutationVersion: () => number;
  flush: (keys?: readonly string[]) => Promise<void>;
};
const providers = new Map<string, { port: CanvasPersistence; lifetime: AbortController }>();

/** Internal registration belongs to a hydrated canonical persistence provider, never a UI snapshot. */
export function registerCanvasPersistence(projectId: string, port: CanvasPersistence): () => void {
  providers.get(projectId)?.lifetime.abort();
  const entry = { port, lifetime: new AbortController() };
  providers.set(projectId, entry);
  return () => {
    entry.lifetime.abort();
    if (providers.get(projectId) === entry) providers.delete(projectId);
  };
}

function currentProvider(projectId: string) {
  const entry = providers.get(projectId);
  if (!entry || entry.lifetime.signal.aborted) throw new Error('Canvas persistence is unavailable');
  if (getCanvasHostContext().projectId !== projectId) throw new Error('Canvas project changed');
  return entry;
}

async function flushCurrent(projectId: string, keys?: readonly string[], check?: (state: Record<string, unknown>) => void) {
  const entry = currentProvider(projectId);
  const assertCurrent = () => {
    if (currentProvider(projectId) !== entry) throw new Error('Canvas persistence instance changed');
    check?.(entry.port.read());
  };
  const signal = entry.lifetime.signal;
  let onAbort!: () => void;
  const destroyed = new Promise<never>((_, reject) => {
    onAbort = () => reject(new Error('Canvas persistence is unavailable'));
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    // A binding can be queued behind an older in-flight save. Capture the real
    // mutation version, await the canonical queue, and include late local edits.
    for (;;) {
      assertCurrent();
      const version = entry.port.mutationVersion();
      await Promise.race([entry.port.flush(keys), destroyed]);
      assertCurrent();
      if (entry.port.mutationVersion() === version) return;
    }
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}

/** Flush before a host reads the server's canonical revision; this does not invent a revision. */
export function flushCanvasForProject(projectId: string): Promise<void> {
  return flushCurrent(projectId);
}

/** Wait until the still-current running generation binding has passed canonical persistence. */
export function awaitCanvasGenerationBinding(projectId: string, nodeId: string, requestId: string): Promise<void> {
  return flushCurrent(projectId, ['workbenchBasicNodes'], state => {
    const nodes = state.workbenchBasicNodes;
    const node = Array.isArray(nodes) ? nodes.find(value => value && value.id === nodeId) : undefined;
    if (!requestId || !nodeId || node?.generation?.requestId !== requestId || node.generation.status !== 'running') {
      throw new Error('Canvas generation binding is stale or cancelled');
    }
  });
}
