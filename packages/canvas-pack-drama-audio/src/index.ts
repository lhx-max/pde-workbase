import { createElement } from 'react';
import { RewriteCard } from './rewrite-card';
import { DubbingListCard } from './dubbing-list-card';
import { DubbingEditor } from './dubbing-editor';
import { AudioCard } from './audio-card';
import type { CardPack } from '@bezier/canvas-card-sdk';

/** 短剧配音音频编辑卡片包：渲染挂载入口（前端 `packs.ts` 引用）。 */
export { DubbingEditor } from './dubbing-editor';
export { changeRewriteWindow, validateRewriteLines } from './rewrite';
export { synthesizeDemoLines, demoMediaUrl } from './demo-adapter';
const dramaAudioPack: CardPack = {
  name: '@bezier/canvas-pack-drama-audio',
  cards: [
    { kind: 'card.drama.audio', render: props => createElement(props.node.data?.stage === 'rewrite' ? RewriteCard : props.node.data?.stage === 'line-list' ? DubbingListCard : props.node.data?.stage === 'edit' ? DubbingEditor : AudioCard, props) },
  ],
};

export default dramaAudioPack;
