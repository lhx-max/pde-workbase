import { createElement } from 'react';
import { DirectorCard } from './director/card';
import { RewriteCard } from './rewrite-card';
import { DubbingListCard } from './dubbing-list-card';
import { DubbingEditor } from './dubbing-editor';
import { AudioCard } from './audio-card';
import type { CardPack } from '@bezier/canvas-card-sdk';

/** 短剧配音音频编辑卡片包：渲染挂载入口（前端 `packs.ts` 引用）。 */
export { DubbingEditor } from './dubbing-editor';
export { changeRewriteWindow, validateRewriteLines } from './rewrite';
export { synthesizeDemoLines, demoMediaUrl, demoProjectOf, readDubbingListSource, patchDubbingListSource, dubbingCounts } from './demo-adapter';
const dramaAudioPack: CardPack = {
  name: '@bezier/canvas-pack-drama-audio',
  cards: [
    {
      kind: 'card.drama.audio',
      render: props => {
        const { node } = props;
        const legacyDemo = (node.data?.demoProfile ?? node.demoProfile) === 'local-test'
          && typeof (node.data?.demoProjectId ?? node.demoProjectId) === 'string';
        if (!legacyDemo) return createElement(DirectorCard, props);
        const stage = node.data?.stage;
        if (stage === 'rewrite') return createElement(RewriteCard, props);
        if (stage === 'line-list') return createElement(DubbingListCard, props);
        return createElement(stage === 'edit' ? DubbingEditor : AudioCard, props);
      },
    },
  ],
};

export default dramaAudioPack;

export { effectiveLineVoice } from './demo-adapter';
export { buildDirectorPlaybackPlan, buildPlaybackPlan, resolvePlaybackDuration, gainAt, gainRegionsOf, originalGainOf, scheduleMixGain } from './playback-plan';
export type { RewriteLine as TimedDubbingLine } from './rewrite';
export type { DramaAudioSegment } from './types';
export type { AudioLayer, AudioListenMode, GainRegion } from './playback-plan';
export type { DubbingPlayback, PlaybackRange } from './dubbing-editor';
