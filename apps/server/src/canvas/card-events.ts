/** Live card add/update/delete fanout for the manage-agent subscription.
 * The buffer only covers a short reconnect. Older cursors must re-read state. */
export interface CanvasCardChange {
  type: 'card.created' | 'card.updated' | 'card.deleted';
  instanceId: string;
  nodeId: string;
  kind: string;
  title: string;
  revision: number;
  cursor: string;
}

const MAX_BUFFER = 200;
const buffers = new Map<string, { events: CanvasCardChange[]; forgottenBefore: number }>();
const listeners = new Map<string, Set<(event: CanvasCardChange) => void>>();

function bucket(instanceId: string) {
  let found = buffers.get(instanceId);
  if (!found) buffers.set(instanceId, found = { events: [], forgottenBefore: 0 });
  return found;
}

export function publishCanvasCardChange(event: CanvasCardChange): void {
  const stored = bucket(event.instanceId);
  stored.events.push(event);
  while (stored.events.length > MAX_BUFFER) {
    const removed = stored.events.shift();
    if (removed) stored.forgottenBefore = removed.revision;
  }
  for (const listener of listeners.get(event.instanceId) ?? []) listener(event);
}

/** Events strictly after `after`. resync means the cursor fell out of the buffer. */
export function canvasCardChangesAfter(instanceId: string, after: number): { events: CanvasCardChange[]; resync: boolean } {
  const stored = buffers.get(instanceId);
  if (!stored) return { events: [], resync: false };
  if (after < stored.forgottenBefore) return { events: [], resync: true };
  return { events: stored.events.filter(event => event.revision > after), resync: false };
}

export function subscribeCanvasCardChanges(instanceId: string, listener: (event: CanvasCardChange) => void): () => void {
  let set = listeners.get(instanceId);
  if (!set) listeners.set(instanceId, set = new Set());
  set.add(listener);
  return () => {
    set!.delete(listener);
    if (set!.size === 0) listeners.delete(instanceId);
  };
}
