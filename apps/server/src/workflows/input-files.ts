import type { JsonValue } from '@bezier/contracts';
/** References are selected from the engine's verified input snapshot, never
 * inferred from arbitrary prose or taken from unrelated project files. */
export function workflowInputPaths(value: JsonValue): string[] {
  const paths = new Set<string>();
  const add = (value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    const file = value as Record<string, unknown>;
    if (typeof file.path === 'string' && typeof file.sha256 === 'string') paths.add(file.path);
  };
  const walk = (value: JsonValue): void => {
    if (Array.isArray(value)) { value.forEach(walk); return; }
    if (value && typeof value === 'object') {
      if (value.kind === 'project-file') add(value);
      else Object.values(value).forEach(walk);
      return;
    }
    if (typeof value !== 'string') return;
    for (const match of value.matchAll(/<workflow-artifacts>([\s\S]*?)<\/workflow-artifacts>/g)) {
      const receipt: unknown = JSON.parse(match[1]!);
      if (receipt && typeof receipt === 'object' && 'artifacts' in receipt && Array.isArray(receipt.artifacts)) receipt.artifacts.forEach(add);
    }
  };
  walk(value);
  return [...paths];
}
