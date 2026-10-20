/** Immutable content snapshots only; never capture task state or canvas geometry. */
export type CanvasResultSnapshot = Record<string, unknown>;

export function withCanvasResultHistory<T extends object, P extends object>(
  node: T,
  patch: P,
  keys: readonly string[],
): T & P & { resultHistory: CanvasResultSnapshot[] } {
  const before = node as Record<string, unknown>;
  const after = { ...node, ...patch } as Record<string, unknown>;
  const history = Array.isArray(before.resultHistory) ? [...before.resultHistory] as CanvasResultSnapshot[] : [];
  for (const source of [before, after]) {
    const snapshot = Object.fromEntries(keys.filter(key => source[key] !== undefined).map(key => [key, source[key]]));
    if (!Object.values(snapshot).some(value => value !== '' && value !== null)) continue;
    if (!history.some(value => JSON.stringify(value) === JSON.stringify(snapshot))) history.push(snapshot);
  }
  return { ...node, ...patch, resultHistory: history };
}
