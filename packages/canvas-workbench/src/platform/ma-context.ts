/**
 * MA 会话应用挂载合同的应用侧镜像与纯校验。
 *
 * 结构合同真源在宿主侧（PluginComponentProps.context → ApplicationContextValue）：
 * 宿主实际只承诺 context / fileClient / conversation 三个 props。本模块只负责
 * 在挂载前把 context 校验成有界、安全的形状，并定义「什么是同一个画布实例」
 * 的 scope key。不引用 React，纯函数，可直接被宿主或测试消费。
 *
 * 关键纪律：context.actor 是宿主声称的业务身份，用于路由与隔离，
 * 永远不是授权凭据——每个 HTTP 请求的凭据只能来自宿主注入的
 * getCredential，见 createMaCanvasTransport。
 */

/** 与 Provider 信封 text() 相同的有界字符串规则：非空、≤1000、无控制字符。 */
const MAX_FIELD_LENGTH = 1000;
/** providerInstanceId 进入 URL path，按单段给更紧的上限。 */
const MAX_SEGMENT_LENGTH = 512;
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/u;
/** 会破坏 path 段语义的字符（含 % —— 挡住 %2e%2e 这类二次解码穿越）。 */
const SEGMENT_FORBIDDEN = /[/\\?#%]|\s/;

export interface CanvasAppActor {
  userId: string;
  tenantId: string;
}

/** 宿主发布结构 context 1.0 的镜像；字段名与含义不得自行扩展。 */
export interface CanvasAppContext {
  applicationId: string;
  applicationVersion: string;
  applicationInstanceId: string;
  providerInstanceId: string;
  bizId: string;
  sessionId: string;
  actor: CanvasAppActor;
  locale?: string;
}

export type CanvasAppContextInvalid = {
  ok: false;
  field: string;
  reason: 'missing' | 'invalid' | 'unsupported';
};
export type CanvasAppContextResult =
  | { ok: true; context: CanvasAppContext }
  | CanvasAppContextInvalid;

const bounded = (value: unknown, max = MAX_FIELD_LENGTH): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= max && !CONTROL_CHARS.test(value);

/** providerInstanceId / 解析出的 canvasInstanceId 都会进 URL path，必须是安全的单段。 */
const safeSegment = (value: unknown): value is string =>
  bounded(value, MAX_SEGMENT_LENGTH) && !SEGMENT_FORBIDDEN.test(value as string) && value !== '.' && value !== '..';

const invalid = (field: string, reason: CanvasAppContextInvalid['reason']): CanvasAppContextInvalid =>
  ({ ok: false, field, reason });

/**
 * 挂载前校验 context。任何必填字段缺失/越界/含控制字符，或
 * providerInstanceId 不是安全的单 path 段，都判失败——画布宁可
 * 显示不可用，也不能拿畸形身份去拼 URL 或发请求。
 */
export function validateCanvasAppContext(input: unknown): CanvasAppContextResult {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return invalid('context', 'missing');
  const value = input as Record<string, unknown>;
  if (value.protocolVersion !== undefined && value.protocolVersion !== '1.0') {
    return invalid('protocolVersion', 'unsupported');
  }
  for (const field of ['applicationId', 'applicationVersion', 'applicationInstanceId', 'bizId', 'sessionId'] as const) {
    if (!bounded(value[field])) return invalid(field, value[field] === undefined ? 'missing' : 'invalid');
  }
  const pid = value.providerInstanceId;
  if (!safeSegment(pid)) {
    return invalid('providerInstanceId', pid === undefined ? 'missing' : 'invalid');
  }
  const actor = value.actor;
  if (!actor || typeof actor !== 'object' || Array.isArray(actor)) return invalid('actor', 'missing');
  const tenantId = (actor as Record<string, unknown>).tenantId;
  const userId = (actor as Record<string, unknown>).userId;
  if (!bounded(tenantId) || tenantId !== tenantId.trim()) return invalid('actor.tenantId', tenantId === undefined ? 'missing' : 'invalid');
  if (!bounded(userId) || userId !== userId.trim()) return invalid('actor.userId', userId === undefined ? 'missing' : 'invalid');
  const locale = value.locale;
  if (locale !== undefined && !bounded(locale, 64)) return invalid('locale', 'invalid');
  return {
    ok: true,
    context: {
      applicationId: value.applicationId as string,
      applicationVersion: value.applicationVersion as string,
      applicationInstanceId: value.applicationInstanceId as string,
      providerInstanceId: pid,
      bizId: value.bizId as string,
      sessionId: value.sessionId as string,
      actor: { tenantId, userId },
      ...(locale === undefined ? {} : { locale: locale as string }),
    },
  };
}

/**
 * 决定「需要重新挂载画布」的最小身份集合：canvas 文档归属
 * （tenant + application + providerInstanceId + biz 空间）、授权票据
 * 作用域（applicationInstanceId、userId）与 API 入口（baseUrl）。
 * sessionId、locale 不在内——同一会话内换会话标签或语言不应重置画布草稿；
 * 反之这些字段任何一个变化都必须重建 transport 并重挂载，防止 A/B 状态互渗。
 */
export function canvasAppScopeKey(context: CanvasAppContext, baseUrl: string): string {
  return JSON.stringify([
    baseUrl,
    context.actor.tenantId,
    context.actor.userId,
    context.applicationId,
    context.applicationVersion,
    context.applicationInstanceId,
    context.bizId,
    context.providerInstanceId,
  ]);
}

/** 展示层错误码——只允许这些枚举值上屏，绝不透传底层 cause。 */
export type CanvasAppUnavailableCode =
  | 'CONTEXT_INVALID'
  | 'CONFIGURATION_INVALID'
  | 'RESOURCE_URL_UNAVAILABLE'
  | 'CREDENTIAL_UNAVAILABLE'
  | 'INSTANCE_NOT_FOUND'
  | 'ACCESS_DENIED'
  | 'SERVICE_UNAVAILABLE';

/** 凭据/配置类失败的哨兵错误：让错误边界能映射出安全错误码而不泄露原始 cause。 */
export class CanvasAppError extends Error {
  readonly code: CanvasAppUnavailableCode;
  constructor(code: CanvasAppUnavailableCode, message: string) {
    super(message);
    this.name = 'CanvasAppError';
    this.code = code;
  }
}

/** 预检响应状态 → 展示错误码。404 表示实例不存在，绝不触发创建。 */
export function preflightFailureCode(status: number): CanvasAppUnavailableCode {
  if (status === 404) return 'INSTANCE_NOT_FOUND';
  if (status === 401 || status === 403) return 'ACCESS_DENIED';
  if (status === 400) return 'CONTEXT_INVALID';
  return 'SERVICE_UNAVAILABLE';
}

/** 任意异常 → 展示错误码；非本模块错误一律归并到 SERVICE_UNAVAILABLE。 */
export function sanitizePreflightError(error: unknown): CanvasAppUnavailableCode {
  if (error instanceof CanvasAppError) return error.code;
  return 'SERVICE_UNAVAILABLE';
}

const UNAVAILABLE_MESSAGES: Record<CanvasAppUnavailableCode, { 'zh-CN': string; en: string }> = {
  CONTEXT_INVALID: {
    'zh-CN': '宿主传入的应用上下文缺失或不完整，画布无法打开。',
    en: 'The host did not provide a complete application context; the canvas cannot open.',
  },
  CONFIGURATION_INVALID: {
    'zh-CN': '画布服务地址配置无效，画布无法连接。',
    en: 'The configured canvas API address is invalid; the canvas cannot connect.',
  },
  RESOURCE_URL_UNAVAILABLE: {
    'zh-CN': '宿主未配置受认证的资源地址桥，画布内的图片与预览不可用。',
    en: 'The host did not configure an authenticated resource URL bridge; canvas images and previews are unavailable.',
  },
  CREDENTIAL_UNAVAILABLE: {
    'zh-CN': '宿主凭据获取失败，画布暂时不可用。',
    en: 'The host credential could not be obtained; the canvas is unavailable.',
  },
  INSTANCE_NOT_FOUND: {
    'zh-CN': '该画布实例不存在或尚未初始化，请先在宿主侧完成登记后再打开。',
    en: 'This canvas instance does not exist yet; register it on the host side before opening.',
  },
  ACCESS_DENIED: {
    'zh-CN': '当前身份无权访问该画布实例。',
    en: 'The current identity is not allowed to access this canvas instance.',
  },
  SERVICE_UNAVAILABLE: {
    'zh-CN': '画布服务暂时不可用，请稍后重试。',
    en: 'The canvas service is unavailable; please retry later.',
  },
};

/** 面向用户的不可用文案；locale 省略时沿用画布中文默认。 */
export function canvasAppUnavailableMessage(code: CanvasAppUnavailableCode, locale?: string | null): string {
  const entry = UNAVAILABLE_MESSAGES[code];
  return locale && locale.toLowerCase().startsWith('en') ? entry.en : entry['zh-CN'];
}

/**
 * 每次预检生成新的 requestId / idempotencyKey。canvas.read 是只读动作，
 * 幂等键新鲜与否不改变其读语义；键的作用是让网关/服务端能对单调用去重与审计。
 */
export function newCanvasAppRequestId(): string {
  const cryptoObj = globalThis.crypto;
  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') return `req_${cryptoObj.randomUUID()}`;
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 14)}`;
}

/** Provider 动作路由（相对 API 根）。 */
export function canvasProviderActionPath(providerInstanceId: string, actionId: string): string {
  return `/open-platform/v1/instances/${encodeURIComponent(providerInstanceId)}/actions/${encodeURIComponent(actionId)}`;
}

/**
 * 打开既有实例的唯一允许调用：Provider `canvas.read` 信封。
 * 服务端对未登记实例直接回 PROVIDER_INSTANCE_NOT_FOUND——该动作没有创建语义；
 * 绝不发 canvas.create 或任何 register/MA 管理接口。
 */
export function canvasReadEnvelope(context: CanvasAppContext, requestId: string): Record<string, unknown> {
  return {
    protocolVersion: '1.0',
    requestId,
    idempotencyKey: requestId,
    applicationId: context.applicationId,
    applicationVersion: context.applicationVersion,
    applicationInstanceId: context.applicationInstanceId,
    providerInstanceId: context.providerInstanceId,
    actionId: 'canvas.read',
    bizId: context.bizId,
    sessionId: context.sessionId,
    actor: { tenantId: context.actor.tenantId, userId: context.actor.userId },
    input: {},
  };
}

/**
 * 校验 canvas.read 响应映射并取出真实画布 projectId（data.canvasInstanceId）。
 * 浏览器不能算服务端 sha256 映射，必须信任并核验响应：协议版本、动作、
 * providerInstanceId 回显、正整数外层 revision、有界安全的实例 ID。
 * 任一不符返回 null——映射不可信时宁可报不可用也不挂载错误文档。
 */
export function parseCanvasReadResponse(body: unknown, providerInstanceId: string): string | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const response = body as Record<string, unknown>;
  if (response.protocolVersion !== '1.0') return null;
  if (response.actionId !== 'canvas.read') return null;
  if (response.providerInstanceId !== providerInstanceId) return null;
  if (typeof response.revision !== 'number' || !Number.isSafeInteger(response.revision) || response.revision <= 0) return null;
  const data = response.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const canvasInstanceId = (data as Record<string, unknown>).canvasInstanceId;
  return safeSegment(canvasInstanceId) ? canvasInstanceId : null;
}
