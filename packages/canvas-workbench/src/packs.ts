import { registerCardPack, type CardPack } from './workbench/card-registry';
import demoPack from '@bezier/canvas-pack-demo';
import dramaAudioPack from '@bezier/canvas-pack-drama-audio';

/** Team card packs mount here — one line per pack (build-time mounting, v1). */
export const CARD_PACKS: CardPack[] = [
  demoPack, // 参考包，FDE 可整体复制改名
  dramaAudioPack, // 短剧配音音频编辑卡（card.drama.audio）
];

for (const pack of CARD_PACKS) registerCardPack(pack);
