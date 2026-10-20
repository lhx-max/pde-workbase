import type React from 'react';
import type { CanvasBasicNode } from './BasicCanvasNode';
import type { CardPack as SdkCardPack } from '@bezier/canvas-card-sdk';

export type { CardPackOp, CardPackOpHandler, CardPackNode, CardPack, CardPackCard } from '@bezier/canvas-card-sdk';

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

const renderers = new Map<string, CardRenderer>();
const KIND_PATTERN = /^card\.[a-z0-9-]+\.[a-z0-9-]+$/;
const CORE_KINDS = new Set(['text', 'sketch', 'page', 'image', 'artifact', 'storyboard', 'video', 'clip']);

export function registerCardPack(pack: SdkCardPack): void {
  for (const card of pack.cards) {
    const isOverride = CORE_KINDS.has(card.kind);
    if (!isOverride && !KIND_PATTERN.test(card.kind)) throw new Error(`Invalid card kind: ${card.kind}`);
    if (renderers.has(card.kind)) throw new Error(`Card kind already registered: ${card.kind}`);
    renderers.set(card.kind, card.render as CardRenderer);
  }
}

/** Returns the pack renderer for a kind, or undefined for core kinds/unknown cards. */
export function cardRendererFor(kind: string): CardRenderer | undefined {
  return renderers.get(kind);
}
