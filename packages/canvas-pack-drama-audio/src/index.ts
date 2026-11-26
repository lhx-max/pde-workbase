import { DirectorCard } from './director/card';
import type { CardPack } from '@bezier/canvas-card-sdk';

/** 短剧配音音频编辑卡片包：渲染挂载入口（前端 `packs.ts` 引用）。 */
export { DubbingEditor } from './dubbing-editor';
export { Workbench as DramaWorkbench } from './director/workbench';
export type { AssistantAgent } from './director/assistant-panel';
export { assertMediaSize, useSessionMedia } from './director/media';
export { generateCandidate } from './director/local-voice';
export { changeRewriteWindow, validateRewriteLines } from './rewrite';
export { adoptDubbingCandidate, candidateMatches, DEFAULT_VOICE_INSTRUCTION, dubbingCounts, effectiveLineVoice, lineAudioSource, lineGenerationCurrent, voiceInstructionOf, type DubbingCandidate } from './dubbing';
export { rewriteDocOf } from './rewrite';
export { assertProjectRelativePath } from './schema';
const dramaAudioPack: CardPack = {
  name: '@bezier/canvas-pack-drama-audio',
  cards: [{ kind: 'card.drama.audio', render: DirectorCard }],
};

export default dramaAudioPack;

export { buildDirectorPlaybackPlan, buildPlaybackPlan, resolvePlaybackDuration, gainAt, gainRegionsOf, originalGainOf, scheduleMixGain } from './playback-plan';
export type { RewriteLine as TimedDubbingLine } from './rewrite';
export type { DramaAudioSegment } from './types';
export type { AudioLayer, AudioListenMode, GainRegion } from './playback-plan';
export type { DubbingPlayback, PlaybackRange } from './dubbing-editor';
