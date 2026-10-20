import type { CanvasCardOperation } from '@bezier/contracts';
import { CanvasStateError } from './errors.js';
import type { CanvasFileContent } from './persistence.js';

type Item = Record<string, unknown> & { id: string };

/** Server-side context handed to a card-pack op handler. */
export interface CardOpContext {
  projectId: string;
  /** Project-relative file port; lands in the active storage backend. */
  files: Pick<CanvasFileContent, 'read' | 'write'>;
}

/** Returns the data patch to merge into the card, or void for no change. */
export type CardOpHandler = (
  node: Item,
  params: Record<string, unknown>,
  ctx: CardOpContext,
) => Promise<{ data?: Record<string, unknown>; [field: string]: unknown } | void>
  | { data?: Record<string, unknown>; [field: string]: unknown } | void;

const handlers = new Map<string, CardOpHandler>();

/** Register a card-pack op under its full id: `card.<team>.<name>.<verb>`. */
export function registerCardOp(actionId: string, handler: CardOpHandler): void {
  if (!/^card\.[a-z0-9-]+\.[a-z0-9-]+\.[a-z0-9-]+$/.test(actionId)) {
    throw new Error(`Invalid card op id: ${actionId}`);
  }
  handlers.set(actionId, handler);
}

export function listCardOps(): string[] {
  return [...handlers.keys()];
}

/** Effects entry for applyCanvasOperations: resolves + invokes the registered handler. */
export function createCardEffect(ctx: Omit<CardOpContext, 'files'> & { files: CardOpContext['files'] }) {
  return async (op: CanvasCardOperation, node: Item): Promise<Item> => {
    const handler = handlers.get(op.type);
    if (!handler) throw new CanvasStateError(404, 'CANVAS_ACTION_NOT_FOUND', `No card pack registered action: ${op.type}`);
    // The op's card segment must match the target card's kind.
    const expectedKind = op.type.slice(0, op.type.lastIndexOf('.'));
    if (node.kind !== expectedKind) {
      throw new CanvasStateError(400, 'CANVAS_OPERATION_UNSUPPORTED', `Action ${op.type} requires card kind ${expectedKind}`);
    }
    const patch = await handler(node, op.params ?? {}, ctx);
    return patch ? { ...node, ...patch, data: { ...(node.data as Record<string, unknown> | undefined), ...(patch.data ?? {}) } } : node;
  };
}
