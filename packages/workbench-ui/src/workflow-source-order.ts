/** Card identity follows creation order, independently of edges or canvas position. */
export function workflowSourceOrder(nodes: ReadonlyArray<{ id: string; data: { kind: string; cardNumber?: number } }>, _edges: Array<{ source: string; target: string }>): Map<string, number> {
  const result = new Map<string, number>();
  const used = new Set<number>();
  for (const node of nodes) {
    const number = node.data.cardNumber;
    if (number && Number.isSafeInteger(number) && number > 0 && !used.has(number)) { result.set(node.id, number); used.add(number); }
  }
  let next = Math.max(0, ...used) + 1;
  for (const node of nodes) if (!result.has(node.id)) { result.set(node.id, next++); }
  return result;
}
