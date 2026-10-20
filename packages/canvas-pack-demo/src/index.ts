import { MemoCard } from './MemoCard';
import type { CardPack } from '@bezier/canvas-card-sdk';

/** 参考卡片包：真实可挂载的最小实现，FDE 复制改名即可开工。 */
const demoPack: CardPack = {
  name: '@bezier/canvas-pack-demo',
  cards: [
    { kind: 'card.demo.memo', render: MemoCard },
  ],
};

export default demoPack;
