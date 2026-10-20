import { registerCardOp, type CardOpHandler } from './canvas/card-ops.js';

/** Structural pack shape — packs compile against `CardPack` in the workbench
 * types; the server only needs kind + ops to wire the action pipeline. */
type CardPackLike = { cards: { kind: string; ops?: Record<string, CardOpHandler> }[] };

/** Server-side card-pack mount: each pack's card ops register under
 * `card.<team>.<name>.<verb>`. One import line per pack (build-time, v1). */
const CARD_PACKS: CardPackLike[] = [
  // import yourPack from '@team/canvas-pack-yourbiz';
  // yourPack,
];

for (const pack of CARD_PACKS) {
  for (const card of pack.cards) {
    for (const [verb, handler] of Object.entries(card.ops ?? {})) {
      registerCardOp(`${card.kind}.${verb}`, handler);
    }
  }
}
