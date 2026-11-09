/** 手写校验：卡片包不引 zod（包零运行时依赖），规则与
 * apps/server `normalizeSafeProjectFilePath` 对齐：工程相对路径
 * 非空、不以 `/` 开头、无 `..`、无反斜杠、无空段。 */

export function isProjectRelativePath(value: unknown): value is string {
  if (typeof value !== 'string' || !value) return false;
  if (value.includes('\\')) return false;
  if (value.startsWith('/')) return false;
  return value.split('/').every(segment => segment.length > 0 && segment !== '.' && segment !== '..');
}

export function assertProjectRelativePath(name: string, value: unknown): string {
  if (!isProjectRelativePath(value)) throw new Error(`card.drama.audio: ${name} 必须是工程相对路径（无前导 /、无 ..）：${JSON.stringify(value)}`);
  return value;
}

export function assertFiniteNumber(name: string, value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`card.drama.audio: ${name} 必须是有限数字`);
  if (value < min || value > max) throw new Error(`card.drama.audio: ${name} 超出范围 [${min}, ${max}]：${value}`);
  return value;
}

export function assertInteger(name: string, value: unknown, min: number, max: number): number {
  const n = assertFiniteNumber(name, value, min, max);
  if (!Number.isSafeInteger(n)) throw new Error(`card.drama.audio: ${name} 必须是整数：${value}`);
  return n;
}

export const GAIN_MIN = 0;
export const GAIN_MAX = 2;
export const GAP_MS_MAX = 60_000;
export const LABEL_MAX_LENGTH = 2_000;
export const SCRIPT_MAX_LENGTH = 20_000;
export const DURATION_MS_MAX = 24 * 3_600_000;

export function assertGain(name: string, value: unknown): number {
  return assertFiniteNumber(name, value, GAIN_MIN, GAIN_MAX);
}

export function assertLabel(name: string, value: unknown): string {
  if (typeof value !== 'string' || !value.length) throw new Error(`card.drama.audio: ${name} 必须是非空字符串`);
  if (value.length > LABEL_MAX_LENGTH) throw new Error(`card.drama.audio: ${name} 长度超过 ${LABEL_MAX_LENGTH}`);
  return value;
}

/** 分段 ID：字母数字与连字符，1..64 位（建卡方生成，handler 只校验形状）。 */
export function assertSegmentId(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/.test(value)) throw new Error(`card.drama.audio: segmentId 非法：${JSON.stringify(value)}`);
  return value;
}

/** 可选文本（null = 清除；undefined = 不改由调用方处理）。 */
export function assertOptionalText(name: string, value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || !value.length) throw new Error(`card.drama.audio: ${name} 必须是非空字符串或 null`);
  if (value.length > SCRIPT_MAX_LENGTH) throw new Error(`card.drama.audio: ${name} 长度超过 ${SCRIPT_MAX_LENGTH}`);
  return value;
}

/** 可选区间：null / undefined 清除该端；数值须在 [0, duration] 内。返回 null = 清除。 */
export function readOptionalMs(name: string, value: unknown, durationMs: number): number | null {
  if (value === undefined || value === null) return null;
  return assertFiniteNumber(name, value, 0, durationMs);
}
