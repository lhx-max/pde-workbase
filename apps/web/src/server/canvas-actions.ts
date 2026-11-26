/** 受控画布动作通道 v2：CLI 只产出「动作提议」（```canvas-actions 块），
 * 本模块把动作映射为平台 **operations 批量**（node.* 通用操作与
 * card.drama.audio.* 卡包 op），经
 * POST /api/apps/canvas/instances/:projectId/operations 提交——
 * 由画布服务端的幂等凭条、卡片类型门禁与 baseRevision 乐观锁统一裁决，
 * 不再自行覆盖状态。媒体动作先经工程文件存在性校验；`import_media.src`
 * 支持本机绝对路径导入：复制上传进工程后被绑定，时长由容器解析
 * （mp4/mov mvhd、wav data 块）自动探测，探测失败要求显式提供。
 * 409 冲突整批记失败，不自动重试。 */

export interface AgentAction {
  type: 'create_card' | 'update_card' | 'card_op' | 'import_media';
  cardId?: unknown;
  title?: unknown;
  x?: unknown;
  y?: unknown;
  kind?: unknown;
  data?: unknown;
  op?: unknown;
  params?: unknown;
  audioRef?: unknown;
  videoRef?: unknown;
  durationMs?: unknown;
  videoDurationMs?: unknown;
  /** import_media专属：本机绝对路径（导入时复制进工程）。 */
  src?: unknown;
}

interface CanvasNode {
  id: string;
  kind: string;
  title?: string;
  x: number;
  y: number;
}

interface PlatformOperation {
  type: string;
  [key: string]: unknown;
}

export interface ActionReceipt {
  index: number;
  label: string;
  status: 'applied' | 'failed';
  error?: string;
}

const CREATE_CARD_KINDS = new Set(['card.drama.audio']);

/** 卡包 op 白名单（与 packages/canvas-pack-drama-audio/src/ops.ts 的 dramaAudioOps 同步）。 */
const CARD_OPS = new Set([
  'attach', 'script', 'upsert', 'remove', 'gap', 'gain', 'mute', 'trim', 'video',
  'align', 'rebind', 'span', 'voice', 'speed', 'dub', 'analyze', 'compose', 'rewrite', 'export', 'export-srt',
]);

const CARD_OP_LABELS: Record<string, string> = {
  attach: '绑定配音源', script: '写台词', upsert: '增改分段', remove: '删分段', gap: '段后停顿',
  gain: '调音量', mute: '静音开关', trim: '裁剪', video: '绑定视频', align: '段对齐视频',
  rebind: '段换配音', span: '段区间', voice: '音色', speed: '变速', dub: '生成配音', analyze: '画面理解',
  compose: '生成配音稿', rewrite: '改写台词', export: '导出 EDL', 'export-srt': '导出字幕',
};

/** dub 走本机 VoxCPM 真实合成（CPU 推理单句数秒到数十秒），提交超时单独放宽。 */
const SLOW_OPS = new Set(['card.drama.audio.dub', 'card.drama.audio.rewrite']);
const OPERATION_TIMEOUT_MS = (operations: PlatformOperation[]) =>
  operations.some(operation => SLOW_OPS.has(operation.type)) ? 300_000 : 60_000;

function canvasOrigin(): URL {
  const configured = process.env.CANVAS_SERVER_ORIGIN?.trim();
  const origin = new URL(configured ?? '');
  if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password
    || origin.pathname !== '/' || origin.search || origin.hash) throw new Error('CANVAS_SERVER_ORIGIN 配置不合法');
  return origin;
}

export function parseCanvasActions(text: string): AgentAction[] | null {
  const blocks = [...text.matchAll(/```canvas-actions\s*([\s\S]*?)```/gu)];
  const last = blocks.at(-1);
  if (!last) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(last[1]); } catch { return []; }
  const actions = (parsed as { actions?: unknown })?.actions;
  if (!Array.isArray(actions)) return [];
  return actions.filter((item): item is AgentAction => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
    return ['create_card', 'update_card', 'card_op', 'import_media'].includes((item as AgentAction).type as string);
  }).slice(0, 20);
}

const validId = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(value);

const validTitle = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 1000;

const validCoord = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= -100_000 && value <= 100_000;

/** 工程相对路径（与卡包 schema 规则一致）。 */
const validRef = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 2000 && !value.includes('\\')
  && !value.startsWith('/') && value.split('/').every(segment => segment.length > 0 && segment !== '.' && segment !== '..');

const validDuration = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= 24 * 3_600_000;

/** import_media 的本机源文件约束：绝对路径 + 扩展名白名单 + 512MB 上限。 */
const SRC_AUDIO_EXTS = new Set(['.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg']);
const SRC_VIDEO_EXTS = new Set(['.mp4', '.mov', '.webm', '.mkv']);
const SRC_MAX_BYTES = 512 * 1024 * 1024;

const validateSrcPath = (value: unknown): { path: string; ext: string; kind: 'audio' | 'video' } | string => {
  if (typeof value !== 'string' || !value.startsWith('/') || value.includes('\\')) return 'src 必须是本机绝对路径';
  if (value.includes('\0')) return 'src 路径不合法';
  const ext = value.slice(value.lastIndexOf('.')).toLowerCase();
  if (SRC_AUDIO_EXTS.has(ext)) return { path: value, ext, kind: 'audio' };
  if (SRC_VIDEO_EXTS.has(ext)) return { path: value, ext, kind: 'video' };
  return `src 扩展名 ${ext || '(无)'} 不在白名单（音频 ${[...SRC_AUDIO_EXTS].join(' ')}；视频 ${[...SRC_VIDEO_EXTS].join(' ')}）`;
};

/** 容器时长探测（毫秒）：mp4/mov 读 moov/mvhd，wav 读 fmt+data 块。失败返回 null。 */
export function probeMediaDurationMs(filePath: string, ext: string): number | null {
  try {
    const fs = require('node:fs') as typeof import('node:fs');
    const fd = fs.openSync(filePath, 'r');
    try {
      if (ext === '.wav') return probeWav(fd);
      if (ext === '.mp4' || ext === '.mov') return probeIsoBmff(fd);
      return null;
    } finally { fs.closeSync(fd); }
  } catch { return null; }
}

function probeWav(fd: number): number | null {
  const fs = require('node:fs') as typeof import('node:fs');
  const header = Buffer.alloc(12);
  if (fs.readSync(fd, header, 0, 12, 0) < 12 || header.toString('ascii', 0, 4) !== 'RIFF' || header.toString('ascii', 8, 12) !== 'WAVE') return null;
  let offset = 12;
  let byteRate = 0;
  let dataSize = 0;
  const chunk = Buffer.alloc(8);
  while (offset + 8 <= fs.fstatSync(fd).size) {
    if (fs.readSync(fd, chunk, 0, 8, offset) < 8) break;
    const id = chunk.toString('ascii', 0, 4);
    const size = chunk.readUInt32LE(4);
    if (id === 'fmt ' && size >= 16) {
      const fmt = Buffer.alloc(Math.min(size, 18));
      fs.readSync(fd, fmt, 0, fmt.length, offset + 8);
      byteRate = fmt.readUInt32LE(8);
    }
    if (id === 'data') { dataSize = size; break; }
    offset += 8 + size + (size % 2);
  }
  if (!byteRate || !dataSize) return null;
  const ms = Math.round(dataSize / byteRate * 1000);
  return ms > 0 && ms <= 24 * 3_600_000 ? ms : null;
}

function probeIsoBmff(fd: number): number | null {
  const fs = require('node:fs') as typeof import('node:fs');
  const size = fs.fstatSync(fd).size;
  const head = Buffer.alloc(8);
  let offset = 0;
  while (offset + 8 <= size) {
    if (fs.readSync(fd, head, 0, 8, offset) < 8) break;
    let boxSize = head.readUInt32BE(0);
    const type = head.toString('ascii', 4, 8);
    if (boxSize === 0) { boxSize = size - offset; }
    if (boxSize === 1) { const ext = Buffer.alloc(8); fs.readSync(fd, ext, 0, 8, offset + 8); boxSize = Number(ext.readBigUInt64BE(0)); }
    if (boxSize < 8 || offset + boxSize > size) return null;
    if (type === 'moov') {
      let inner = offset + 8;
      const mvhd = Buffer.alloc(32);
      while (inner + 8 <= offset + boxSize) {
        if (fs.readSync(fd, head, 0, 8, inner) < 8) break;
        const childSize = head.readUInt32BE(0);
        const childType = head.toString('ascii', 4, 8);
        if (childType === 'mvhd' && childSize >= 24 && childSize <= 120) {
          const body = Buffer.alloc(Math.min(childSize - 8, 32));
          fs.readSync(fd, body, 0, body.length, inner + 8);
          const version = body.readUInt8(0);
          const timescale = version === 1 ? body.readUInt32BE(20) : body.readUInt32BE(12);
          const duration = version === 1 ? Number(body.readBigUInt64BE(24)) : body.readUInt32BE(16);
          if (!timescale || duration <= 0) return null;
          const ms = Math.round(duration / timescale * 1000);
          return ms > 0 && ms <= 24 * 3_600_000 ? ms : null;
        }
        inner += childSize;
      }
      return null;
    }
    offset += boxSize;
  }
  return null;
}

const validParams = (value: unknown): value is Record<string, unknown> => {
  if (value === undefined) return true;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return JSON.stringify(value).length <= 16_000;
};

/** 把动作映射为平台 operations；同时产出人类可读标签。非法动作进 invalid。 */
function buildOperations(actions: AgentAction[], projectNodes: CanvasNode[]): { operations: PlatformOperation[]; labels: string[]; invalid: string[] } {
  const operations: PlatformOperation[] = [];
  const labels: string[] = [];
  const invalid: string[] = [];
  const known = new Set(projectNodes.map(node => node.id));
  actions.forEach((action, actionIndex) => {
    const where = `动作#${actionIndex + 1}`;
    const referenced = (): boolean => {
      if (!validId(action.cardId)) { invalid.push(`${where}：cardId 不合法`); return false; }
      if (!known.has(action.cardId)) { invalid.push(`${where}：卡片 ${action.cardId} 不存在`); return false; }
      return true;
    };
    if (action.type === 'create_card') {
      if (action.kind !== undefined && !validId(action.kind)) { invalid.push(`${where}：kind 不合法`); return; }
      const kind = typeof action.kind === 'string' ? action.kind : 'card.drama.audio';
      if (!CREATE_CARD_KINDS.has(kind)) { invalid.push(`${where}：kind ${kind} 不在开放卡种白名单`); return; }
      if (!validCoord(action.x) || !validCoord(action.y)) { invalid.push(`${where}：create_card 需要合法 x/y 坐标`); return; }
      const nodeId = `assistcard${crypto.randomUUID().replace(/-/gu, '').slice(0, 16)}`;
      known.add(nodeId);
      operations.push({
        type: 'node.create',
        node: {
          id: nodeId, kind, x: action.x, y: action.y,
          ...(validTitle(action.title) ? { title: action.title } : {}),
          ...(validParams(action.data) && action.data ? { data: action.data } : {}),
        },
      });
      labels.push(`新建 ${kind} 卡「${typeof action.title === 'string' ? action.title : nodeId}」`);
      return;
    }
    if (action.type === 'update_card') {
      if (!referenced()) return;
      if (!validCoord(action.x) && !validCoord(action.y) && !validTitle(action.title)) {
        invalid.push(`${where}：update_card 只支持 title/x/y，其他字段请用 card_op`);
        return;
      }
      if (validCoord(action.x) || validCoord(action.y)) {
        operations.push({ type: 'node.move', nodeId: action.cardId as string, x: validCoord(action.x) ? action.x : 0, y: validCoord(action.y) ? action.y : 0 });
        labels.push(`移动卡片 ${action.cardId}`);
      }
      if (validTitle(action.title)) {
        operations.push({ type: 'node.rename', nodeId: action.cardId as string, title: action.title });
        labels.push(`重命名卡片 ${action.cardId}`);
      }
      return;
    }
    if (action.type === 'card_op') {
      if (!referenced()) return;
      if (typeof action.op !== 'string' || !CARD_OPS.has(action.op)) { invalid.push(`${where}：op ${String(action.op)} 不在白名单`); return; }
      if (!validParams(action.params)) { invalid.push(`${where}：params 必须是 ≤16KB 对象`); return; }
      operations.push({ type: `card.drama.audio.${action.op}`, nodeId: action.cardId as string, ...(action.params ? { params: action.params } : {}) });
      labels.push(`卡片 ${action.cardId} ${CARD_OP_LABELS[action.op] ?? action.op}`);
      return;
    }
    if (action.type === 'import_media') {
      const hasAudio = validRef(action.audioRef);
      const hasVideo = validRef(action.videoRef);
      if (!hasAudio && !hasVideo) { invalid.push(`${where}：import_media 需要 audioRef 或 videoRef（本机导入用 src，由服务端转换）`); return; }
      if (hasAudio && !validDuration(action.durationMs)) { invalid.push(`${where}：音频导入需要 durationMs（毫秒）`); return; }
      if (hasVideo && !validDuration(action.videoDurationMs)) { invalid.push(`${where}：视频导入需要 videoDurationMs（毫秒）`); return; }
      // import_media 只导入到已有卡片，不再隐式新建卡（曾导致每次导入都多一张卡）；新建卡请显式用 create_card。
      if (action.cardId === undefined) { invalid.push(`${where}：import_media 需要 cardId，导入到已有卡片；新建卡请先用 create_card`); return; }
      if (!referenced()) return;
      const nodeId = action.cardId as string;
      if (hasAudio && hasVideo) {
        operations.push({
          type: 'card.drama.audio.attach', nodeId,
          params: { audioRef: action.audioRef, durationMs: action.durationMs, videoRef: action.videoRef, videoDurationMs: action.videoDurationMs },
        });
        labels.push(`导入视频+音频到 ${nodeId}`);
      } else if (hasVideo) {
        operations.push({ type: 'card.drama.audio.video', nodeId, params: { videoRef: action.videoRef, videoDurationMs: action.videoDurationMs } });
        labels.push(`导入视频到 ${nodeId}`);
      } else {
        operations.push({ type: 'card.drama.audio.attach', nodeId, params: { audioRef: action.audioRef, durationMs: action.durationMs } });
        labels.push(`导入音频到 ${nodeId}`);
      }
    }
  });
  return { operations, labels, invalid };
}

/** import_media 的 src 预处理：本机文件 → 复制上传进工程 → 转为工程内
 * audioRef/videoRef + 时长（显式参数优先；mp4/mov/wav 自动探测，其余必须显式）。
 * 返回处理后的动作副本与新增校验拒绝项；未提供 src 的动作原样通过。 */
async function prepareImportSources(origin: URL, projectId: string, actions: AgentAction[], invalid: string[]): Promise<AgentAction[]> {
  const fs = require('node:fs') as typeof import('node:fs');
  const prepared: AgentAction[] = [];
  for (const [index, action] of actions.entries()) {
    if (action.type !== 'import_media' || action.src === undefined) { prepared.push(action); continue; }
    const where = `动作#${index + 1}`;
    const decided = validateSrcPath(action.src);
    if (typeof decided === 'string') { invalid.push(`${where}：${decided}`); continue; }
    try {
      const stat = fs.statSync(decided.path);
      if (!stat.isFile()) { invalid.push(`${where}：src 不是普通文件`); continue; }
      if (stat.size > SRC_MAX_BYTES) { invalid.push(`${where}：src 超过 512MB 上限`); continue; }
      const explicit = decided.kind === 'audio' ? action.durationMs : action.videoDurationMs;
      const conflictRef = decided.kind === 'audio' ? action.audioRef : action.videoRef;
      if (conflictRef !== undefined) { invalid.push(`${where}：src 与 ${decided.kind === 'audio' ? 'audioRef' : 'videoRef'} 同时提供，请任选其一`); continue; }
      let relative: string | null = null;
      try {
        const blob = await fs.openAsBlob(decided.path);
        const form = new FormData();
        form.set('dir', decided.kind === 'audio' ? 'outputs/voice' : 'inputs');
        form.append('files', blob, decided.path.slice(decided.path.lastIndexOf('/') + 1));
        const headers: Record<string, string> = process.env.CANVAS_AUTH_TOKEN ? { authorization: `Bearer ${process.env.CANVAS_AUTH_TOKEN}` } : {};
        const response = await fetch(`${origin.origin}/api/projects/${encodeURIComponent(projectId)}/upload`, { method: 'POST', headers, body: form, signal: AbortSignal.timeout(120_000) });
        const body = await response.json() as { files?: { name?: string; originalName?: string }[] };
        relative = response.ok ? body.files?.find(item => typeof item.name === 'string')?.name ?? null : null;
        if (!relative) { invalid.push(`${where}：复制 ${decided.kind} 进工程失败（HTTP ${response.status}）`); continue; }
      } catch (reason) {
        invalid.push(`${where}：复制 ${decided.kind} 进工程失败：${reason instanceof Error ? reason.message : '未知错误'}`);
        continue;
      }
      const duration = validDuration(explicit) ? explicit : probeMediaDurationMs(decided.path, decided.ext);
      const durationField = decided.kind === 'audio' ? 'durationMs' : 'videoDurationMs';
      if (!validDuration(duration)) {
        invalid.push(`${where}：无法从 ${decided.ext} 探测时长，请提供${decided.kind === 'audio' ? 'durationMs' : 'videoDurationMs'}`);
        continue;
      }
      const next: AgentAction = { ...action };
      delete next.src;
      next[decided.kind === 'audio' ? 'audioRef' : 'videoRef'] = relative;
      next[durationField] = duration;
      prepared.push(next);
    } catch (reason) {
      invalid.push(`${where}：src 读取失败：${reason instanceof Error ? reason.message.slice(0, 160) : '未知错误'}`);
    }
  }
  return prepared;
}

export async function applyCanvasActions(projectId: string, actions: AgentAction[] | null): Promise<{
  receipts: ActionReceipt[];
  invalid: string[];
  conflict?: true;
}> {
  if (!actions?.length) return { receipts: [], invalid: [] };
  let origin: URL;
  try { origin = canvasOrigin(); }
  catch (reason) {
    return { receipts: actions.map((action, index) => ({ index: index + 1, label: String(action.type), status: 'failed' as const, error: reason instanceof Error ? reason.message : '后端不可用' })), invalid: [] };
  }

  const resolved: string[] = [];
  const prepared = await prepareImportSources(origin, projectId, actions, resolved);
  if (!prepared.length) return { receipts: [], invalid: resolved };

  // 当前画布：校验卡片存在性 + 取 baseRevision。
  let revision: number;
  let nodes: CanvasNode[];
  try {
    const read = await fetch(`${origin.origin}/api/projects/${encodeURIComponent(projectId)}/canvas/state`, { signal: AbortSignal.timeout(15_000) });
    const body = await read.json() as { ok?: boolean; revision?: number; state?: { workbenchBasicNodes?: CanvasNode[] } };
    if (!read.ok || typeof body.revision !== 'number' || !Array.isArray(body.state?.workbenchBasicNodes)) throw new Error('画布状态读取失败');
    revision = body.revision;
    nodes = body.state.workbenchBasicNodes;
  } catch (reason) {
    return { receipts: actions.map((action, index) => ({ index: index + 1, label: String(action.type), status: 'failed' as const, error: `读取画布失败：${reason instanceof Error ? reason.message : '未知错误'}` })), invalid: resolved };
  }

  const { operations, labels, invalid } = buildOperations(prepared, nodes);
  invalid.push(...resolved);
  const failed = (message: string): ActionReceipt[] => operations.map((_, index) => ({ index: index + 1, label: labels[index] ?? '', status: 'failed' as const, error: message }));

  // 工程文件存在性校验（import_media 的 audioRef/videoRef）。
  const refs = operations.flatMap(operation => {
    if (operation.type === 'card.drama.audio.attach') {
      const params = operation.params as { audioRef?: string; videoRef?: string };
      return [params.audioRef, ...(params.videoRef ? [params.videoRef] : [])];
    }
    if (operation.type === 'card.drama.audio.video') {
      const params = operation.params as { videoRef?: string };
      return params.videoRef ? [params.videoRef] : [];
    }
    return [];
  }).filter((ref): ref is string => typeof ref === 'string');
  for (const ref of [...new Set(refs)]) {
    try {
      const head = await fetch(`${origin.origin}/api/projects/${encodeURIComponent(projectId)}/raw/${ref.split('/').map(encodeURIComponent).join('/')}`, { method: 'HEAD', signal: AbortSignal.timeout(10_000) });
      if (!head.ok) return { receipts: [], invalid: [...invalid, `文件不存在：${ref}（HTTP ${head.status}）；请先上传到工程文件再导入`] };
    } catch (reason) {
      return { receipts: [], invalid: [...invalid, `文件校验失败：${ref}：${reason instanceof Error ? reason.message : '未知错误'}`] };
    }
  }

  if (!operations.length) return { receipts: [], invalid };
  try {
    const response = await fetch(`${origin.origin}/api/apps/canvas/instances/${encodeURIComponent(projectId)}/operations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ operationId: `assist${crypto.randomUUID().replace(/-/gu, '').slice(0, 24)}`, baseRevision: revision, operations }),
      signal: AbortSignal.timeout(OPERATION_TIMEOUT_MS(operations)),
    });
    if (response.status === 409) {
      return { receipts: failed('画布版本冲突（409），请基于最新画布重试'), invalid, conflict: true };
    }
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      return { receipts: failed(`operations 提交失败 HTTP ${response.status}${detail ? `：${detail.slice(0, 200)}` : ''}`), invalid };
    }
    const body = await response.json() as { data?: { receipt?: { status?: string } } };
    const status: ActionReceipt['status'] = body.data?.receipt?.status === 'noop' || body.data?.receipt?.status === 'applied' ? 'applied' : 'failed';
    return {
      receipts: operations.map((_, index) => ({ index: index + 1, label: labels[index] ?? '', status })),
      invalid,
    };
  } catch (reason) {
    return { receipts: failed(`operations 提交异常：${reason instanceof Error ? reason.message : '未知错误'}`), invalid };
  }
}

export function renderReceiptLines(receipts: ActionReceipt[], invalid: string[]): string {
  const lines = invalid.map(text => `· 校验拒绝 ${text}`);
  for (const receipt of receipts) {
    lines.push(receipt.status === 'applied' ? `· 已执行 动作#${receipt.index} ${receipt.label}` : `· 失败 动作#${receipt.index} ${receipt.label}${receipt.error ? `：${receipt.error}` : ''}`);
  }
  return lines.length ? `\n[画布动作回执]\n${lines.join('\n')}` : '';
}
