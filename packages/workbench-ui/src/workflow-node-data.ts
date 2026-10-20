/** Position, measurement and selection changes do not invalidate card content. */
export function workflowNodeDataSnapshot<T>(
  previous: ReadonlyArray<{ id: string; data: T }>,
  nodes: ReadonlyArray<{ id: string; data: T }>,
): ReadonlyArray<{ id: string; data: T }> {
  return previous.length === nodes.length && previous.every((node, index) =>
    node.id === nodes[index].id && node.data === nodes[index].data)
    ? previous
    : nodes.map(({ id, data }) => ({ id, data }));
}
