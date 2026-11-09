export const canonical = (value: unknown): string => JSON.stringify(value, (_key, item) =>
  item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
export const equal = (a: unknown, b: unknown): boolean => canonical(a) === canonical(b);
const sameJson = equal;
const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const recordId = (v: unknown): string | null => isRecord(v) && typeof v.id === 'string' ? v.id : null;

export function mergeCanvasValue(base: unknown, local: unknown, remote: unknown): unknown {
  if (sameJson(base, local)) return remote;

  if (Array.isArray(base) && Array.isArray(local) && Array.isArray(remote)) {
    const identified = [...base, ...local, ...remote].every(item => recordId(item) !== null);
    if (!identified) return local;

    const baseById = new Map(base.map(item => [recordId(item)!, item]));
    const localById = new Map(local.map(item => [recordId(item)!, item]));
    const remoteById = new Map(remote.map(item => [recordId(item)!, item]));
    const mergedById = new Map(remoteById);

    for (const [id, baseItem] of baseById) {
      if (!localById.has(id)) {
        mergedById.delete(id);
        continue;
      }
      const localItem = localById.get(id);
      if (sameJson(baseItem, localItem)) continue;
      mergedById.set(id, mergeCanvasValue(baseItem, localItem, remoteById.get(id)));
    }
    for (const [id, localItem] of localById) {
      if (baseById.has(id)) continue;
      mergedById.set(id, localItem);
    }

    return [
      ...local.flatMap(item => {
        const id = recordId(item)!;
        return mergedById.has(id) ? [mergedById.get(id)] : [];
      }),
      ...remote.flatMap(item => {
        const id = recordId(item)!;
        return localById.has(id) || baseById.has(id) ? [] : [mergedById.get(id)];
      }),
    ];
  }

  if (isRecord(base) && isRecord(local) && isRecord(remote)) {
    const merged: Record<string, unknown> = { ...remote };
    for (const key of Object.keys(base)) {
      if (!Object.prototype.hasOwnProperty.call(local, key)) delete merged[key];
    }
    for (const [key, localValue] of Object.entries(local)) {
      if (!Object.prototype.hasOwnProperty.call(base, key)) {
        merged[key] = localValue;
        continue;
      }
      merged[key] = mergeCanvasValue(base[key], localValue, remote[key]);
    }
    return merged;
  }

  return local;
}
