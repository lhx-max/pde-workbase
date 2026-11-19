import { adoptDubbingCandidate, candidateMatches, effectiveLineVoice, lineAudioSource, type DubbingCandidate } from '../dubbing';
import { validateRewriteLines } from '../rewrite';
import { audioDurationOf } from './director-media';
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

export async function generateCandidate(
  read: () => Data, addMedia: SaveMedia, lineId: string, signal: AbortSignal,
): Promise<DubbingCandidate> {
  const before = read();
  const lines = validateRewriteLines(before.rewriteLines, Number(before.videoDurationMs));
  const line = lines.find(row => row.id === lineId);
  if (!line) throw new Error('请选择有效台词。');
  const voice = effectiveLineVoice(before, lineId);
  await checkLocalVoice(signal);
  const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(600_000)]);
  const request = { signal: requestSignal, redirect: 'error', credentials: 'omit' } as const;
  const response = await fetch(`${origin}/gradio_api/call/generate`, {
    ...request, method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ data: [line.text, voice, null, false, '', 2, false, false, 10, 42] }),
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
) {
  const before = read();
  const lines = validateRewriteLines(before.rewriteLines, Number(before.videoDurationMs));
  const missing = lines.filter(line => !lineAudioSource(before, line.id));
  const locks = (before.directorEdit as { locks?: { startMs: number; endMs: number }[] } | undefined)?.locks;
  const available = missing.filter(line => !locks?.some(lock => lock.startMs < line.videoEndMs && lock.endMs > line.videoStartMs));
  if (!available.length) throw new Error('当前没有可补齐的台词，请检查锁定区间。');
  for (const [index, line] of available.entries()) {
    signal.throwIfAborted();
    if (lineAudioSource(read(), line.id)) continue;
    progress(`正在补齐第 ${index + 1}/${available.length} 句`);
    const take = await generateCandidate(read, addMedia, line.id, signal);
    const current = read();
    const changes = adoptDubbingCandidate(current, take);
    assertUnlocked(current, changes);
    if (!patch(changes)) throw new Error('配音已生成，但画布未应用当前结果。');
  }
  progress(`已补齐 ${available.length} 句可编辑台词。请同步试听并核对区间。`);
}
