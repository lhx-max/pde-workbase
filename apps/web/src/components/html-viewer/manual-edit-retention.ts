// Original FileWorkspace.tsx 265–280, 1590–1633 (Bezier/Loom 319e5eee; Apache-2.0).

/** A failed or throwing save must veto navigation/close, never erase a draft. */
export async function settleManualEditExit(exit: () => Promise<boolean>): Promise<boolean> {
  try {
    return await exit();
  } catch {
    return false;
  }
}

export async function settleManualEditFiles(
  fileNames: Iterable<string>,
  settle: (fileName: string) => Promise<boolean>,
): Promise<boolean> {
  const results = await Promise.all([...new Set(fileNames)].map(fileName => settle(fileName)));
  return results.every(Boolean);
}

/**
 * Original shell map contract, isolated for independent embedding and testing.
 * One instance belongs to one workspace. React hosts keep it in a ref and mirror
 * retention changes into state for rendering/LRU; this object does not navigate.
 */
export function createManualEditRetention() {
  const retained = new Set<string>();
  const handlers = new Map<string, () => Promise<boolean>>();
  const inFlight = new Map<string, Promise<boolean>>();
  const settle = (fileName: string): Promise<boolean> => {
    const exit = handlers.get(fileName);
    if (!exit) return inFlight.get(fileName) ?? Promise.resolve(true);
    const existing = inFlight.get(fileName);
    if (existing) return existing;
    const pending = settleManualEditExit(exit).finally(() => {
      if (inFlight.get(fileName) === pending) inFlight.delete(fileName);
    });
    inFlight.set(fileName, pending);
    return pending;
  };
  return {
    onRetainActivityChange(fileName: string, retain: boolean) {
      if (retain) retained.add(fileName);
      else retained.delete(fileName);
    },
    onManualEditExitHandlerChange(fileName: string, handler: (() => Promise<boolean>) | null) {
      if (handler) handlers.set(fileName, handler);
      else handlers.delete(fileName);
    },
    isProtected(fileName: string) {
      return retained.has(fileName) || handlers.has(fileName) || inFlight.has(fileName);
    },
    protectedFiles() {
      return new Set([...retained, ...handlers.keys(), ...inFlight.keys()]);
    },
    settle,
    settleAll() {
      return settleManualEditFiles(new Set([...retained, ...handlers.keys(), ...inFlight.keys()]), settle);
    },
  };
}
