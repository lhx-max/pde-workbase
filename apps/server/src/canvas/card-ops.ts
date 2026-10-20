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

const handlers = new Map<string, { handler: CardOpHandler; targetKind?: string | undefined }>();

/** Mounted-pack metadata — the in-memory truth mirrored into `card_packs`. */
export interface MountedCardPack {
  packId: string;
  team: string;
  name?: string | undefined;
  kinds: string[];
  ops: string[];
  /** kind → appId: which editor App owns deep editing for a kind. */
  editorApps?: Record<string, string> | undefined;
}

const packs = new Map<string, MountedCardPack>();

export function registerCardPack(pack: MountedCardPack): void {
  const existing = packs.get(pack.packId);
  packs.set(pack.packId, {
    ...pack,
    kinds: [...new Set([...(existing?.kinds ?? []), ...pack.kinds])],
    ops: [...new Set([...(existing?.ops ?? []), ...pack.ops])],
    editorApps: { ...(existing?.editorApps ?? {}), ...(pack.editorApps ?? {}) },
  });
}

export function listRegisteredPacks(): MountedCardPack[] {
  return [...packs.values()];
}

/** Every `card.<team>.<name>` kind any mounted pack provides. */
export function listRegisteredCardKinds(): string[] {
  return [...new Set([...packs.values()].flatMap(pack => pack.kinds.filter(kind => kind.startsWith('card.'))))];
}

export function isCardKindRegistered(kind: string): boolean {
  return [...packs.values()].some(pack => pack.kinds.includes(kind));
}

/** kind → appId across all mounted packs (pack-provided associations only;
 * core-kind associations live in the app route's platform map). */
export function listRegisteredCardApps(): Record<string, string> {
  return Object.assign({}, ...[...packs.values()].map(pack => pack.editorApps ?? {}));
}

/** Register a card-pack op under its full id: `card.<team>.<name>.<verb>`.
 * `targetKind` overrides the default "op prefix must equal card kind" check —
 * use it when an action intentionally targets a different kind (e.g. a core card). */
export function registerCardOp(actionId: string, handler: CardOpHandler, targetKind?: string): void {
  if (!/^card\.[a-z0-9-]+\.[a-z0-9-]+\.[a-z0-9-]+$/.test(actionId)) {
    throw new Error(`Invalid card op id: ${actionId}`);
  }
  handlers.set(actionId, { handler, targetKind });
}

export function listCardOps(): string[] {
  return [...handlers.keys()];
}

/** Effects entry for applyCanvasOperations: resolves + invokes the registered handler. */
export function createCardEffect(ctx: Omit<CardOpContext, 'files'> & { files: CardOpContext['files'] }) {
  return async (op: CanvasCardOperation, node: Item): Promise<Item> => {
    const entry = handlers.get(op.type);
    if (!entry) throw new CanvasStateError(404, 'CANVAS_ACTION_NOT_FOUND', `No card pack registered action: ${op.type}`);
    // Default: the op's card segment must match the target card's kind.
    const expectedKind = entry.targetKind ?? op.type.slice(0, op.type.lastIndexOf('.'));
    if (node.kind !== expectedKind) {
      throw new CanvasStateError(400, 'CANVAS_OPERATION_UNSUPPORTED', `Action ${op.type} requires card kind ${expectedKind}`);
    }
    const patch = await entry.handler(node, op.params ?? {}, ctx);
    return patch ? { ...node, ...patch, data: { ...(node.data as Record<string, unknown> | undefined), ...(patch.data ?? {}) } } : node;
  };
}
