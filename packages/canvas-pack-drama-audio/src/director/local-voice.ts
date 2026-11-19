import { adoptDubbingCandidate, candidateMatches, effectiveLineVoice, lineAudioSource, lineGenerationCurrent, lineVoiceOverride, voiceKeyOf, voiceReferenceOf, type DubbingCandidate, type VoiceReference } from '../dubbing';
import { validateRewriteLines } from '../rewrite';
import { audioDurationOf, encodeWav } from './director-media';
import { requireMedia, type MediaLookup } from './media';
import { assertUnlocked } from './director-edits';

const origin = 'http://127.0.0.1:8808';
type Data = Record<string, unknown>;
type SaveMedia = (file: File) => Promise<string>;

export function localVoiceAvailable() {
  return typeof location !== 'undefined' && location.hostname === '127.0.0.1';
}

export async function checkLocalVoice(signal: AbortSignal) {
  if (!localVoiceAvailable()) throw new Error('此配音服务仅在本机工作区可用。');
  try {
    const response = await fetch(`${origin}/gradio_api/info`, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(4_000)]), redirect: 'error', credentials: 'omit',
    });
    const info = await response.json() as { named_endpoints?: Record<string, unknown> };
    if (!response.ok || !info.named_endpoints?.['/generate']) throw new Error();
  } catch {
    signal.throwIfAborted();
    throw new Error('本机 VoxCPM 在 8808 端口不可用，启动后可重新检查。');
  }
}

/** 参考音频最长 15 秒，过长会拖慢克隆且收益有限。 */
const REFERENCE_MAX_MS = 15_000;
type GradioFile = { path: string; meta: { _type: 'gradio.FileData' }; orig_name: string };
const uploadedReferences = new Map<string, GradioFile>();

/** 截取音色基准音频并上传到本机 VoxCPM，同一基准在本次会话只上传一次。 */
export async function uploadReference(reference: VoiceReference, resolve: MediaLookup | undefined, signal: AbortSignal): Promise<GradioFile> {
  const endMs = Math.min(reference.endMs, reference.startMs + REFERENCE_MAX_MS);
  const key = `${reference.audioRef}#${reference.startMs}-${endMs}`;
  const cached = uploadedReferences.get(key);
  if (cached) return cached;
  if (!resolve) throw new Error('音色基准的音频在当前会话不可用，请先恢复会话素材。');
  const source = await fetch(requireMedia(resolve, reference.audioRef), { signal, redirect: 'error' });
  if (!source.ok) throw new Error('无法读取音色基准的音频。');
  const context = new AudioContext();
  let clip: AudioBuffer;
  try {
    const audio = await context.decodeAudioData(await source.arrayBuffer());
    const from = Math.floor(reference.startMs / 1000 * audio.sampleRate);
    const to = Math.min(audio.length, Math.floor(endMs / 1000 * audio.sampleRate));
    if (to - from < audio.sampleRate / 2) throw new Error('音色基准至少需要 0.5 秒有效音频。');
    clip = new AudioBuffer({ length: to - from, numberOfChannels: audio.numberOfChannels, sampleRate: audio.sampleRate });
    for (let channel = 0; channel < audio.numberOfChannels; channel++) clip.copyToChannel(audio.getChannelData(channel).subarray(from, to), channel);
  } finally { await context.close(); }
  const form = new FormData();
  form.append('files', encodeWav(clip), 'voice-reference.wav');
  const response = await fetch(`${origin}/gradio_api/upload`, { method: 'POST', body: form, signal, redirect: 'error', credentials: 'omit' });
  const paths = response.ok ? await response.json() as unknown : null;
  const path = Array.isArray(paths) ? paths[0] : null;
  if (typeof path !== 'string' || !path) throw new Error('音色基准上传到本机 VoxCPM 失败。');
  const file: GradioFile = { path, meta: { _type: 'gradio.FileData' }, orig_name: 'voice-reference.wav' };
  uploadedReferences.set(key, file);
  return file;
}

export async function generateCandidate(
  read: () => Data, addMedia: SaveMedia, lineId: string, signal: AbortSignal, resolve?: MediaLookup,
): Promise<DubbingCandidate> {
  const before = read();
  const lines = validateRewriteLines(before.rewriteLines, Number(before.videoDurationMs));
  const line = lines.find(row => row.id === lineId);
  if (!line) throw new Error('请选择有效台词。');
  const voice = voiceKeyOf(before, lineId);
  await checkLocalVoice(signal);
  const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(600_000)]);
  const request = { signal: requestSignal, redirect: 'error', credentials: 'omit' } as const;
  // 有音色基准时：本句没有单独音色就克隆基准（参考音频 + 参考文字），单独设了音色就以基准为参考并按描述调整语气。
  const reference = voiceReferenceOf(before);
  const override = lineVoiceOverride(before, lineId);
  const referenceFile = reference && reference.lineId !== lineId ? await uploadReference(reference, resolve, requestSignal) : null;
  const clone = Boolean(referenceFile && !override);
  const control = clone ? '' : referenceFile ? override! : effectiveLineVoice(before, lineId);
  const response = await fetch(`${origin}/gradio_api/call/generate`, {
    ...request, method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ data: [line.text, control, referenceFile, clone, clone ? reference!.text : '', 2, false, false, 10, 42] }),
  });
  if (!response.ok) throw new Error(`VoxCPM 拒绝配音请求（HTTP ${response.status}）。`);
  const receipt = await response.json() as { event_id?: string };
  if (!receipt.event_id || !/^[A-Za-z0-9_-]+$/u.test(receipt.event_id)) throw new Error('VoxCPM 未返回任务标识。');
  const result = await fetch(`${origin}/gradio_api/call/generate/${receipt.event_id}`, request);
  if (!result.ok) throw new Error('配音结果读取失败，请核对本机 VoxCPM 状态。');
  const events = (await result.text()).replace(/\r\n/gu, '\n').split('\n\n');
  const payload = events.find(event => event.startsWith('event: complete\n'))?.split('\n')
    .find(line => line.startsWith('data: '))?.slice(6);
  if (!payload) throw new Error('VoxCPM 未返回可用的配音结果。');
  const [{ url }] = JSON.parse(payload) as [{ url?: string }];
  if (!url) throw new Error('VoxCPM 未返回音频文件。');
  const location = new URL(url, origin);
  if (location.origin !== origin || !location.pathname.startsWith('/gradio_api/file=')) throw new Error('VoxCPM 返回了非本机音频。');
  const audio = await fetch(location, request);
  if (!audio.ok) throw new Error('无法下载生成的 WAV。');
  const blob = await audio.blob();
  if (blob.size < 44 || blob.size > 30_000_000) throw new Error('生成的 WAV 大小超限。');
  const file = new File([blob], `voxcpm-${receipt.event_id}.wav`, { type: 'audio/wav' });
  const durationMs = await audioDurationOf(file);
  const audioRef = await addMedia(file);
  const candidate = { lineId, text: line.text, voice, videoRef: before.videoRef, previousSource: lineAudioSource(before, lineId), audioRef, durationMs };
  signal.throwIfAborted();
  if (!candidateMatches(read(), candidate)) throw new Error('生成期间台词、音色或素材已变化。请重新生成配音。');
  return candidate;
}

export async function fillMissing(
  read: () => Data, patch: (data: Data) => boolean, addMedia: SaveMedia,
  signal: AbortSignal, progress: (message: string) => void,
  options: { resolve?: MediaLookup; stale?: boolean; offline?: boolean } = {},
) {
  const before = read();
  const lines = validateRewriteLines(before.rewriteLines, Number(before.videoDurationMs));
  // stale：同时重新生成文字或音色已变化的句子（例如换了音色基准）；offline：重新生成音频不在当前会话的句子。
  const needs = (data: Data, line: { id: string; text: string }) => {
    const source = lineAudioSource(data, line.id);
    return !source || (options.stale === true && !lineGenerationCurrent(data, line.id, line.text))
      || (options.offline === true && Boolean(options.resolve) && !options.resolve!(source));
  };
  const missing = lines.filter(line => needs(before, line));
  const locks = (before.directorEdit as { locks?: { startMs: number; endMs: number }[] } | undefined)?.locks;
  const available = missing.filter(line => !locks?.some(lock => lock.startMs < line.videoEndMs && lock.endMs > line.videoStartMs));
  if (!available.length) throw new Error('当前没有可补齐的台词，请检查锁定区间。');
  for (const [index, line] of available.entries()) {
    signal.throwIfAborted();
    if (!needs(read(), line)) continue;
    progress(`正在${options.stale ? '更新' : options.offline ? '重新生成' : '补齐'}第 ${index + 1}/${available.length} 句`);
    const take = await generateCandidate(read, addMedia, line.id, signal, options.resolve);
    const current = read();
    const changes = adoptDubbingCandidate(current, take);
    assertUnlocked(current, changes);
    if (!patch(changes)) throw new Error('配音已生成，但画布未应用当前结果。');
  }
  progress(`已${options.stale ? '更新' : options.offline ? '重新生成' : '补齐'} ${available.length} 句可编辑台词。请同步试听并核对区间。`);
}
