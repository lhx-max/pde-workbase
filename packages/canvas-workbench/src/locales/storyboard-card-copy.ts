import type { CopyShape } from './copy-shape';
import { getCanvasActiveLocale } from '../platform/canvas-locale';
import { resolveCanvasLocale } from './node-catalog';
import { STORYBOARD_SHOT_SIZES, STORYBOARD_CAMERA_MOVEMENTS } from './storyboard-enums';
import { videoCameraMoveInstruction, type VideoCameraMove } from './video-camera-catalog';

export function sc(locale?: string | null) {
  return resolveCanvasLocale(locale ?? getCanvasActiveLocale()) === 'zh-CN' ? ZH : EN;
}

const EN = {
  needShots: 'The script must contain 1–50 shots',
  invalidShot: 'Invalid shot format',
  defaultShotPrompt: 'Generate this shot from the current storyboard and reference images.',
  shotSizeLine: (size: string) => `Shot size: ${size}`,
  cameraLine: (move: string) => `Camera: ${move}`,
  aspectLine: (ratio: string) => `Aspect: ${ratio}`,
  lightingLine: (v: string) => `Light & mood: ${v}`,
  dialogueSemantic: (v: string) => `Dialogue / caption meaning: ${v}`,
  soundSemantic: (v: string) => `SFX meaning: ${v}`,
  styleLine: (v: string) => `Visual style: ${v}`,
  extraPrompt: (v: string) => `Extra prompt (if it conflicts with the settings above, the settings win): ${v}`,
  planHeader: (ratio: string, sec: number) => `Storyboard · ${ratio} · ${sec} sec`,
  shotHeader: (n: string, size: string, move: string, sec: number) => `Shot ${n} · ${size} · ${move} · ${sec} sec`,
  descriptionPending: 'Description pending',
  dialogueLine: (v: string) => `Dialogue / VO: ${v}`,
  soundLine: (v: string) => `SFX: ${v}`,
  finalPromptLine: (v: string) => `Final prompt: ${v}`,
  shotSizeEnumLine: `6. shotSize must be one of: ${STORYBOARD_SHOT_SIZES.join(', ')}.`,
  cameraEnumLine: `7. cameraMovement must be one of: ${STORYBOARD_CAMERA_MOVEMENTS.join(', ')}.`,
  readBrief: 'Read the attached brief or script and produce a continuous storyboard ready for AI image generation and later video production.',
  requirementsLabel: 'Requirements:',
  reqTier: (tier: string, count: number, total: number) =>
    `1. Generate only the “${tier}” tier: exactly ${count} shots; durationSec must sum to ${total} seconds. Do not use default shot counts or mix other tiers.`,
  reqShortDrama: '1. Split shots by story beats as above. Do not split mechanically by punctuation or character count.',
  reqGeneral: '1. Default to 6–12 shots in narrative order; fewer than 6 is fine for very short content.',
  req2: '2. description must be a single-shot visual description covering subject, environment, action, framing, and light — no production notes.',
  req3: '3. Keep subject, scene, time, wardrobe, and props continuous across shots.',
  req4: '4. dialogue holds only this shot’s lines, VO, or captions; lighting holds light and mood; sound holds ambience or key SFX; use empty strings when absent.',
  req5: (ratio: string) => `5. Default aspect ratio is ${ratio}.`,
  req8Strict:
    '8. durationSec is a number from 4–30; each shot is at least 4 seconds. If total report duration is less than shot count × 4, propose an adjustment — never emit shots under 4 seconds. finalPrompt summarizes this shot’s image prompt.',
  req8:
    '8. durationSec is an integer from 4–30; each shot is at least 4 seconds. finalPrompt is the final image-ready prompt for this shot.',
  req9:
    '9. Also extract character and scene text settings into assets. Subjects may be people, animals, gifts, vehicles, or other objects — do not invent human bodies, faces, or wardrobe for objects. For compatibility, subjects still use kind="character"; each shot’s characters is an array of subject names; scene is one scene name; empty shots use []. Do not invent appearance facts missing from the source — write “to be filled”. Subjects and scenes are reused only within this storyboard; scene changes need new shots. Do not reuse settings or images from other storyboards just because names match.',
  existingAssets: (json: string) => `Existing project settings: ${json}`,
  jsonOnly: 'Output JSON only — no Markdown fences, no explanation. Format must be:',
  jsonExample:
    '{"aspectRatio":"16:9","assets":[{"kind":"character","name":"subject name","description":"text setting"},{"kind":"scene","name":"scene name","description":"text setting"}],"shots":[{"characters":["subject name"],"scene":"scene name","description":"","shotSize":"中景","lighting":"","dialogue":"","sound":"","cameraMovement":"固定","durationSec":4,"finalPrompt":""}]}',
  userSupplemental: (text: string) => `User supplemental requirements:\n${text}`,
  shortDramaSkill: [
    'Current type: short drama. Use the director breakdown below — do not split by punctuation alone:',
    '- Identify opening, development, turn, climax, and ending. Every scene change, plot turn, or key action needs at least one shot; never drop the ending.',
    '- Short stories or single scenes usually need 6–10 shots; multi-scene / time-jump pieces can use 18–24, capped at 24. Covering the story beats matters more than hitting a count.',
    '- Translate emotion into brows, gaze, breath, gesture, body facing, and visible action — not abstract adverbs like “angrily” or “anxiously”.',
    '- Estimate duration from performance beats: pre-speech action + max(dialogue read time, concurrent action while speaking). Chinese dialogue ≈ 4 chars/sec; add pauses separately.',
    '- Keep subject, scene, time, wardrobe, props, and injury state continuous. Avoid repeating the same camera move on adjacent shots.',
    '- Stay faithful to the source. Do not invent weather, wardrobe, props, locations, or plot facts that are not in the text.',
    '- Default to 9:16 vertical aspect.',
  ].join('\n'),
} as const;

const ZH = {
  needShots: '脚本需要包含 1–50 个镜头',
  invalidShot: '镜头格式无效',
  defaultShotPrompt: '请根据当前分镜与参考图生成这一镜画面。',
  shotSizeLine: (size: string) => `景别：${size}`,
  cameraLine: (move: string) => `镜头：${move}`,
  aspectLine: (ratio: string) => `画幅：${ratio}`,
  lightingLine: (v: string) => `光影氛围：${v}`,
  dialogueSemantic: (v: string) => `台词/字幕语义：${v}`,
  soundSemantic: (v: string) => `音效语义：${v}`,
  styleLine: (v: string) => `视觉风格：${v}`,
  extraPrompt: (v: string) => `补充提示词（与上述当前配置冲突时，以上述配置为准）：${v}`,
  planHeader: (ratio: string, sec: number) => `镜头脚本 · ${ratio} · ${sec} 秒`,
  shotHeader: (n: string, size: string, move: string, sec: number) => `镜头 ${n} · ${size} · ${move} · ${sec} 秒`,
  descriptionPending: '画面待补充',
  dialogueLine: (v: string) => `对白/旁白：${v}`,
  soundLine: (v: string) => `音效：${v}`,
  finalPromptLine: (v: string) => `最终提示词：${v}`,
  shotSizeEnumLine: `6. shotSize 只能是：${STORYBOARD_SHOT_SIZES.join('、')}。`,
  cameraEnumLine: `7. cameraMovement 只能是：${STORYBOARD_CAMERA_MOVEMENTS.join('、')}。`,
  readBrief: '请读取附件中的 brief 或剧本，生成一份可直接用于 AI 生图和后续视频制作的连续分镜脚本。',
  requirementsLabel: '要求：',
  reqTier: (tier: string, count: number, total: number) =>
    `1. 仅生成「${tier}」这一档：严格 ${count} 个镜头，durationSec 合计必须等于 ${total} 秒。不可使用默认镜头数，不得混入其他档位。`,
  reqShortDrama: '1. 按上述剧情节拍拆分镜头，严禁按标点或字数机械切分。',
  reqGeneral: '1. 默认拆成 6–12 个镜头，按叙事先后排序；内容很短时可以少于 6 个。',
  req2: '2. description 必须是单镜头画面描述，写清主体、环境、动作、构图和光线，不要写制作解释。',
  req3: '3. 保持主体、场景、时间、服饰和道具的跨镜连续性。',
  req4: '4. dialogue 只填这一镜的台词、旁白或字幕；lighting 填光影与氛围；sound 填环境音或关键音效；没有则留空字符串。',
  req5: (ratio: string) => `5. 默认画幅为 ${ratio}。`,
  req8Strict:
    '8. durationSec 是 4–30 秒的数值，每镜最少 4 秒。若报告总时长小于镜头数 × 4，必须提示调整方案，不得生成不足 4 秒的镜头；finalPrompt 汇总这一镜的生图提示词。',
  req8: '8. durationSec 是 4–30 的整数秒，每镜最少 4 秒；finalPrompt 汇总这一镜可直接用于生图的最终提示词。',
  req9:
    '9. 同时提取全文的主体和场景文字设定到 assets。主体可以是人、动物、礼物、载具或其他物品，不要给物品补造人体、面部或服饰。为兼容已有数据，主体仍使用 kind="character"，每镜 characters 是主体名称数组，scene 是一个场景名称；没有独立主体的空镜 characters 为 []。不猜测原文没有的外观事实，缺失信息写待补充。主体和场景只在本份分镜内跨镜复用，场景切换要拆镜；不得因同名复用其他分镜方案的设定或图片。',
  existingAssets: (json: string) => `已有项目设定：${json}`,
  jsonOnly: '只输出 JSON，不要 Markdown 代码块，不要解释。格式必须是：',
  jsonExample:
    '{"aspectRatio":"16:9","assets":[{"kind":"character","name":"主体名","description":"文字设定"},{"kind":"scene","name":"场景名","description":"文字设定"}],"shots":[{"characters":["主体名"],"scene":"场景名","description":"","shotSize":"中景","lighting":"","dialogue":"","sound":"","cameraMovement":"固定","durationSec":4,"finalPrompt":""}]}',
  userSupplemental: (text: string) => `用户补充要求：\n${text}`,
  shortDramaSkill: [
    '当前类型：短剧。使用下列导演拆镜方法，不要按标点机械切句：',
    '- 先识别开场、发展、转折、高潮和收尾；每个场景变化、剧情转折或关键动作至少对应一镜，不得丢掉结尾。',
    '- 短故事或单场景通常 6–10 镜；明显多场景、多时间跳转时可以 18–24 镜，最多 24 镜。覆盖剧情比凑数量重要。',
    '- 情绪要翻译成眉眼、视线、呼吸、手势、身体朝向和可见动作，不用“愤怒地”“焦虑地”等抽象词代替表演。',
    '- 镜头时长按表演节拍估算：开口前动作时长 + max(对白朗读时长, 说话时并行动作)；中文对白约 4 字/秒，停顿另计。',
    '- 保持主体、场景、时间、服饰、道具和伤痕等状态连续；相邻镜头不要连续重复同一种运镜。',
    '- 忠于原文，不发明原文没有的天气、服饰、道具、地点或剧情事实。',
    '- 默认使用 9:16 竖屏画幅。',
  ].join('\n'),
} satisfies CopyShape<typeof EN>;

export function buildStoryboardShotPromptLocalized(
  plan: { aspectRatio: string; visualStyle?: string },
  shot: {
    description: string;
    shotSize: string;
    cameraMovement: string;
    cameraMove?: VideoCameraMove;
    lighting?: string;
    dialogue: string;
    sound?: string;
    finalPrompt?: string;
  },
  locale?: string | null,
): string {
  const copy = sc(locale);
  const cameraInstruction = videoCameraMoveInstruction(shot.cameraMove, locale);
  const lines = [shot.description.trim() || copy.defaultShotPrompt];
  if (cameraInstruction) lines.push(cameraInstruction);
  else lines.push(copy.shotSizeLine(shot.shotSize), copy.cameraLine(shot.cameraMovement));
  lines.push(copy.aspectLine(plan.aspectRatio));
  if (shot.lighting?.trim()) lines.push(copy.lightingLine(shot.lighting.trim()));
  if (shot.dialogue.trim()) lines.push(copy.dialogueSemantic(shot.dialogue.trim()));
  if (shot.sound?.trim()) lines.push(copy.soundSemantic(shot.sound.trim()));
  if (plan.visualStyle?.trim()) lines.push(copy.styleLine(plan.visualStyle.trim()));
  if (shot.finalPrompt?.trim()) lines.push(copy.extraPrompt(shot.finalPrompt.trim()));
  return lines.join('\n');
}
