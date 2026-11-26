/** 服务端挂载入口：只声明卡片元数据与动作 handler，不引入 React。
 * 画布服务端 `apps/server/src/card-packs.ts` 从这里取 kinds/ops 注册；
 * 渲染组件仍由前端 `packs.ts` 挂 `./index`。 */

import { dramaAudioOps } from './ops';

const dramaAudioPackServer = {
  packId: 'drama',
  name: '@bezier/canvas-pack-drama-audio',
  cards: [
    {
      kind: 'card.drama.audio',
      agent: {
        read: ['title', 'data', 'projectFilePath'],
        write: {
          script: 'card.drama.audio.script',
          segments: 'card.drama.audio.upsert',
          masterGain: 'card.drama.audio.gain',
          trimStartMs: 'card.drama.audio.trim',
          trimEndMs: 'card.drama.audio.trim',
          captions: 'card.drama.audio.analyze',
          dubbingDoc: 'card.drama.audio.compose',
          generatedLineTexts: 'card.drama.audio.dub',
          generatedLineVoices: 'card.drama.audio.dub',
        },
      },
      ops: dramaAudioOps,
    },
  ],
};

export default dramaAudioPackServer;
