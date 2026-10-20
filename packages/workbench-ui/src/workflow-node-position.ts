/** Coordinates from persisted graphs must be finite before entering React Flow. */
export function workflowNodePosition(value: unknown, index: number): { x: number; y: number } {
  const position = value && typeof value === 'object'
    ? value as { x?: unknown; y?: unknown }
    : {};
  return {
    x: typeof position.x === 'number' && Number.isFinite(position.x) ? position.x : 90 + index * 540,
    y: typeof position.y === 'number' && Number.isFinite(position.y) ? position.y : 260,
  };
}
