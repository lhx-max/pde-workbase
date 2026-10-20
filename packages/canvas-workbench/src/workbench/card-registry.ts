import type React from 'react';
import type { CanvasBasicNode } from './BasicCanvasNode';

/** Props handed to a card-pack renderer. The pack owns `node.data` contents;
 * the platform owns the envelope (id/kind/geometry/paths). */
export interface CardRenderProps {
  node: CanvasBasicNode;
  selected: boolean;
  /** Sole write channel: merges the patch into the card and persists it. */
  onPatch: (patch: { data?: Record<string, unknown>; title?: string; width?: number; height?: number }) => void;
  /** Ask the host to open a project file (e.g. in the files panel). */
  onOpenFile?: (path: string) => void;
}

export type CardRenderer = React.ComponentType<CardRenderProps>;

/** Structural signature for a pack's server-side op handler. The pack compiles
 * against this type; the server registers each entry under the full action id
 * `card.<team>.<name>.<verb>`. */
export type CardPackOpHandler = (
  node: Record<string, unknown> & { id: string },
  params: Record<string, unknown>,
  ctx: { projectId: string; files: { read(projectId: string, relative: string): Promise<string | null>; write(projectId: string, relative: string, content: string): Promise<void> } },
) => Promise<{ data?: Record<string, unknown>; [field: string]: unknown } | void>
  | { data?: Record<string, unknown>; [field: string]: unknown } | void;

export interface CardPackCard {
  /** `card.<team>.<name>` — the team prefix is the ownership boundary. */
  kind: string;
  render: CardRenderer;
  /** Optional server-side op handlers keyed by verb (`refresh` → `card.<team>.<name>.refresh`). */
  ops?: Record<string, CardPackOpHandler>;
}

export interface CardPack {
  cards: CardPackCard[];
}

const renderers = new Map<string, CardRenderer>();
const KIND_PATTERN = /^card\.[a-z0-9-]+\.[a-z0-9-]+$/;

export function registerCardPack(pack: CardPack): void {
  for (const card of pack.cards) {
    if (!KIND_PATTERN.test(card.kind)) throw new Error(`Invalid card kind: ${card.kind}`);
    if (renderers.has(card.kind)) throw new Error(`Card kind already registered: ${card.kind}`);
    renderers.set(card.kind, card.render);
  }
}

/** Returns the pack renderer for a kind, or undefined for core kinds/unknown cards. */
export function cardRendererFor(kind: string): CardRenderer | undefined {
  return renderers.get(kind);
}
