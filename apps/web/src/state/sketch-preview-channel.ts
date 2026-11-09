/** Display-only sketch snapshots. Never use this cache as a write version or
 * identity authority. Callers include actor/workspace/project/path in the key. */
export function createSketchPreviewChannel(limit = 32) {
  const values = new Map<string, string>();
  const listeners = new Map<string, Set<() => void>>();
  const notify = (key: string) => {
    for (const listener of listeners.get(key) ?? []) listener();
  };
  const remove = (key: string) => {
    if (values.delete(key)) notify(key);
  };
  return {
    read: (key: string) => values.get(key),
    subscribe(key: string, listener: () => void) {
      let group = listeners.get(key);
      if (!group) {
        group = new Set();
        listeners.set(key, group);
      }
      group.add(listener);
      return () => {
        group.delete(listener);
        if (!group.size) listeners.delete(key);
      };
    },
    publish(key: string, content: string) {
      if (values.get(key) === content) return;
      values.delete(key);
      values.set(key, content);
      notify(key);
      while (values.size > Math.max(1, limit)) remove(values.keys().next().value!);
    },
    remove,
  };
}

export const sketchPreviewChannel = createSketchPreviewChannel();
export const sketchPreviewKey = (scope: string, projectId: string, path: string) => JSON.stringify([scope, projectId, path]);
