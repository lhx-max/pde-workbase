/** 服务端本机 VoxCPM（TTS）客户端：与浏览器端 local-voice.ts 相同的请求语义，
 * 跑在画布服务端进程内，供 dub op 合成真实音频并写入工程文件口。
 * 生成参数与浏览器端保持一致（cfg=2、normalize=false、denoise=false、dit_steps=10、seed=42）；
 * 不假成功：VoxCPM 不可达、返回非法时显式报错。 */

type GradioFile = { path: string; meta: { _type: 'gradio.FileData' }; orig_name: string };

export const DEFAULT_TTS_BASE = 'http://127.0.0.1:8808';
const REQUEST_TIMEOUT_MS = 600_000;
/** 参考音频最长 15 秒，与浏览器端一致：过长会拖慢克隆且收益有限。 */
export const REFERENCE_MAX_MS = 15_000;
const WAV_MIN_BYTES = 44;
const WAV_MAX_BYTES = 30_000_000;

export function ttsBase(): string {
  const configured = process.env.DRAMA_TTS_BASE?.trim();
  if (!configured) return DEFAULT_TTS_BASE;
  let url: URL;
  try { url = new URL(configured); }
  catch { throw new Error('card.drama.audio: DRAMA_TTS_BASE 配置不合法（必须是合法 URL）'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('card.drama.audio: DRAMA_TTS_BASE 配置不合法（必须是 http(s) 源地址）');
  }
  return url.origin;
}

export type ServerTtsRequest = {
  text: string;
  /** 音色描述（control_instruction）；与参考音频二选一或同传（同传＝以参考为基准按描述调整）。 */
  control: string;
  /** 音色参考音频（WAV 字节）；为空时走纯描述生成。 */
  referenceWav?: Uint8Array | null;
  /** 参考音频的文字（克隆模式必填）。 */
  referenceText?: string;
};

export type ServerTtsResult = { bytes: Uint8Array; durationMs: number; eventId: string };

async function uploadReference(bytes: Uint8Array): Promise<GradioFile> {
  const base = ttsBase();
  const form = new FormData();
  form.append('files', new Blob([bytes as Uint8Array<ArrayBuffer>]), 'voice-reference.wav');
  const response = await fetch(`${base}/gradio_api/upload`, { method: 'POST', body: form, signal: AbortSignal.timeout(120_000), redirect: 'error' });
  if (!response.ok) throw new Error(`card.drama.audio: 音色参考上传到 VoxCPM 失败（HTTP ${response.status}）`);
  const paths = await response.json().catch(() => null) as unknown;
  const path = Array.isArray(paths) ? paths[0] : null;
  if (typeof path !== 'string' || !path) throw new Error('card.drama.audio: VoxCPM 未返回参考音频路径。');
  return { path, meta: { _type: 'gradio.FileData' }, orig_name: 'voice-reference.wav' };
}

/** 用本机 VoxCPM 合成一句配音：提交 generate → SSE 等待 complete → 下载 WAV 字节并解析时长。 */
export async function synthesizeServerTts(request: ServerTtsRequest): Promise<ServerTtsResult> {
  const base = ttsBase();
  const referenceFile = request.referenceWav ? await uploadReference(request.referenceWav) : null;
  const clone = Boolean(referenceFile && !request.control);
  if (clone && !request.referenceText?.trim()) throw new Error('card.drama.audio: 克隆音色需要参考音频对应的文字。');
  const payload = { data: [request.text, request.control, referenceFile, clone, clone ? request.referenceText! : '', 2, false, false, 10, 42] };
  let response: Response;
  try {
    response = await fetch(`${base}/gradio_api/call/generate`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS), redirect: 'error',
    });
  } catch (reason) {
    throw new Error(`card.drama.audio: 本机 VoxCPM（${base}）不可达，dub 不可用；请启动后重试。${reason instanceof Error ? `（${reason.message}）` : ''}`);
  }
  if (!response.ok) throw new Error(`card.drama.audio: VoxCPM 拒绝配音请求（HTTP ${response.status}）。`);
  const receipt = await response.json().catch(() => null) as { event_id?: string } | null;
  if (!receipt?.event_id || !/^[A-Za-z0-9_-]+$/u.test(receipt.event_id)) throw new Error('card.drama.audio: VoxCPM 未返回任务标识。');
  let events: string;
  try {
    const result = await fetch(`${base}/gradio_api/call/generate/${receipt.event_id}`, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS), redirect: 'error' });
    if (!result.ok) throw new Error(`HTTP ${result.status}`);
    events = await result.text();
  } catch (reason) {
    throw new Error(`card.drama.audio: 配音结果读取失败，请核对本机 VoxCPM 状态。${reason instanceof Error ? `（${reason.message}）` : ''}`);
  }
  const payloadLine = events.replace(/\r\n/gu, '\n').split('\n\n').find(event => event.startsWith('event: complete\n'))?.split('\n').find(line => line.startsWith('data: '))?.slice(6);
  if (!payloadLine) throw new Error('card.drama.audio: VoxCPM 未返回可用的配音结果（可能是生成失败或超时）。');
  const [{ url }] = JSON.parse(payloadLine) as [{ url?: string }];
  if (!url) throw new Error('card.drama.audio: VoxCPM 未返回音频文件。');
  const location = new URL(url, base);
  if (location.origin !== base || !location.pathname.startsWith('/gradio_api/file=')) throw new Error('card.drama.audio: VoxCPM 返回了非本机音频。');
  const audio = await fetch(location, { signal: AbortSignal.timeout(120_000), redirect: 'error' });
  if (!audio.ok) throw new Error(`card.drama.audio: 无法下载生成的 WAV（HTTP ${audio.status}）。`);
  const bytes = new Uint8Array(await audio.arrayBuffer());
  if (bytes.byteLength < WAV_MIN_BYTES || bytes.byteLength > WAV_MAX_BYTES) throw new Error('card.drama.audio: 生成的 WAV 大小超限。');
  const durationMs = wavDurationMs(bytes);
  return { bytes, durationMs, eventId: receipt.event_id };
}

/** 解析 WAV 字节时长（RIFF/fmt/data 块）；非 WAV 或不完整时抛错（不假成功）。 */
export function wavDurationMs(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < WAV_MIN_BYTES || view.getUint32(0, false) !== 0x52494646 /* 'RIFF' */ || view.getUint32(8, false) !== 0x57415645 /* 'WAVE' */) {
    throw new Error('card.drama.audio: 音频不是可解析的 WAV。');
  }
  let offset = 12;
  let byteRate = 0;
  let dataSize = 0;
  while (offset + 8 <= bytes.byteLength) {
    const id = String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
    const size = view.getUint32(offset + 4, true);
    if (id === 'fmt ' && size >= 16) byteRate = view.getUint32(offset + 8 + 8, true);
    if (id === 'data') { dataSize = size; break; }
    offset += 8 + size + (size % 2);
  }
  if (!byteRate || !dataSize) throw new Error('card.drama.audio: WAV 缺少 fmt/data 块，无法解析时长。');
  const ms = Math.round(dataSize / byteRate * 1000);
  if (ms <= 0 || ms > 24 * 3_600_000) throw new Error('card.drama.audio: WAV 时长不合法。');
  return ms;
}

function wavLayout(bytes: Uint8Array): { fmtChunk: Uint8Array; dataOffset: number; dataSize: number; byteRate: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < WAV_MIN_BYTES || view.getUint32(0, false) !== 0x52494646 || view.getUint32(8, false) !== 0x57415645) {
    throw new Error('card.drama.audio: 音色基准需要 WAV 源（当前源不是 WAV，服务端无法截取参考片段）。');
  }
  let offset = 12;
  let fmtChunk: Uint8Array | null = null;
  let dataOffset = -1;
  let dataSize = 0;
  let byteRate = 0;
  while (offset + 8 <= bytes.byteLength) {
    const id = String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
    const size = view.getUint32(offset + 4, true);
    if (id === 'fmt ' && size >= 16) {
      fmtChunk = bytes.subarray(offset, offset + 8 + size);
      byteRate = view.getUint32(offset + 8 + 8, true);
    }
    if (id === 'data') { dataOffset = offset + 8; dataSize = size; break; }
    offset += 8 + size + (size % 2);
  }
  if (!fmtChunk || dataOffset < 0 || !byteRate) throw new Error('card.drama.audio: 音色基准 WAV 缺少 fmt/data 块。');
  return { fmtChunk, dataOffset, dataSize, byteRate };
}

/** 按毫秒区间截取 WAV 字节（服务端克隆参考用）：保留 fmt 块并重写 data 大小与 RIFF size。 */
export function clipWavBytes(bytes: Uint8Array, startMs: number, endMs: number): Uint8Array {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs < 0 || endMs <= startMs) throw new Error('card.drama.audio: 参考区间必须 startMs < endMs。');
  const { fmtChunk, dataOffset, dataSize, byteRate } = wavLayout(bytes);
  const from = Math.floor(startMs / 1000 * byteRate);
  const to = Math.min(dataSize, Math.ceil(endMs / 1000 * byteRate));
  if (to - from < byteRate / 2) throw new Error('card.drama.audio: 音色基准至少需要 0.5 秒有效音频。');
  const clipped = new Uint8Array(12 + fmtChunk.byteLength + 8 + (to - from));
  const view = new DataView(clipped.buffer);
  clipped.set([0x52, 0x49, 0x46, 0x46], 0);
  view.setUint32(4, clipped.byteLength - 8, true);
  clipped.set([0x57, 0x41, 0x56, 0x45], 8);
  clipped.set(fmtChunk, 12);
  clipped.set([0x64, 0x61, 0x74, 0x61], 12 + fmtChunk.byteLength);
  view.setUint32(12 + fmtChunk.byteLength + 4, to - from, true);
  clipped.set(bytes.subarray(dataOffset + from, dataOffset + to), 12 + fmtChunk.byteLength + 8);
  return clipped;
}
