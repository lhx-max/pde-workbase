import { registerCardPack, type CardPack } from './workbench/card-registry';

/** Team card packs mount here — one line per pack (build-time mounting, v1). */
export const CARD_PACKS: CardPack[] = [
  // import yourPack from '@team/canvas-pack-yourbiz';
  // yourPack,
];

for (const pack of CARD_PACKS) registerCardPack(pack);
