import { detectInitialLocale, tActive } from './index';
import {
  AGENT_SIGN_IN_ERROR_ZH,
  EXACT_API_ERROR_KEYS,
  FFMPEG_START_ERROR_ZH,
  MEDIA_QUEUED_ZH,
  MEDIA_RUNNING_ZH,
} from './locales/api-error-matchers';
import type { Dict, Locale } from './types';

type Translate = (key: keyof Dict, vars?: Record<string, string | number>) => string;

export interface ApiMessageOptions {
  code?: string | null;
  status?: number;
  locale?: Locale;
  t?: Translate;
}

const HAN = /\p{Script=Han}/u;

const ERROR_KEYS_BY_CODE: Readonly<Record<string, keyof Dict>> = {
  BAD_REQUEST: 'api.error.invalid',
  VALIDATION_FAILED: 'api.error.invalid',
  UNAUTHORIZED: 'api.error.signIn',
  AGENT_AUTH_REQUIRED: 'api.error.signIn',
  FORBIDDEN: 'api.error.forbidden',
  NOT_FOUND: 'api.error.notFound',
  CONFLICT: 'api.error.conflict',
  RATE_LIMITED: 'api.error.rateLimited',
  AGENT_UNAVAILABLE: 'api.error.unavailable',
  UPSTREAM_UNAVAILABLE: 'api.error.unavailable',
  INTERNAL_ERROR: 'api.error.generic',
};

function errorKeyForStatus(status: number | undefined): keyof Dict | undefined {
  if (status === 401) return 'api.error.signIn';
  if (status === 403) return 'api.error.forbidden';
  if (status === 404) return 'api.error.notFound';
  if (status === 409) return 'api.error.conflict';
  if (status === 429) return 'api.error.rateLimited';
  if (status === 502 || status === 503 || status === 504) return 'api.error.unavailable';
  return undefined;
}

/**
 * API `message` is a diagnostic/compatibility field and stays unchanged on the
 * wire. Only the copy shown to a person is localized here. Unknown Chinese
 * server text gets a contextual fallback in English, never a guessed translation.
 */
export function localizeApiMessage(
  message: string | null | undefined,
  fallback: string,
  options: ApiMessageOptions = {},
): string {
  const raw = message?.trim();
  if (!raw) return fallback;
  const locale = options.locale ?? detectInitialLocale();
  const t = options.t ?? tActive;
  if (locale === 'zh-CN' && HAN.test(raw)) return raw;
  const known = EXACT_API_ERROR_KEYS[raw]
    ?? (AGENT_SIGN_IN_ERROR_ZH.test(raw) ? 'api.error.agentSignIn' : undefined)
    ?? (FFMPEG_START_ERROR_ZH.test(raw) ? 'api.error.ffmpegStart' : undefined);
  if (known) return t(known);
  if (locale !== 'zh-CN' && !HAN.test(raw)) return raw;
  const key = (options.code ? ERROR_KEYS_BY_CODE[options.code] : undefined)
    ?? errorKeyForStatus(options.status);
  return key ? t(key) : fallback;
}

/** Reads either `{ error: { code, message } }`, `{ error: string }`, or a message. */
export function displayApiError(
  payload: unknown,
  fallback: string,
  options: ApiMessageOptions = {},
): string {
  if (typeof payload === 'string') return localizeApiMessage(payload, fallback, options);
  if (!payload || typeof payload !== 'object') return fallback;
  const body = payload as { error?: unknown; message?: unknown; code?: unknown };
  const error = body.error ?? body;
  if (typeof error === 'string') return localizeApiMessage(error, fallback, options);
  if (!error || typeof error !== 'object') return fallback;
  const detail = error as { message?: unknown; code?: unknown };
  const message = typeof detail.message === 'string'
    ? detail.message
    : typeof body.message === 'string' ? body.message : undefined;
  const code = typeof detail.code === 'string' ? detail.code : options.code;
  return localizeApiMessage(message, fallback, { ...options, code });
}

/** Media and background-task progress are system status, not user content. */
export function localizeApiProgress(
  line: string,
  options: Pick<ApiMessageOptions, 'locale' | 't'> = {},
): string {
  const raw = line.trim();
  if (!raw) return '';
  const locale = options.locale ?? detectInitialLocale();
  const t = options.t ?? tActive;
  if (raw === MEDIA_RUNNING_ZH) return t('api.progress.mediaRunning');
  const queued = MEDIA_QUEUED_ZH.exec(raw);
  if (queued?.[1]) return t('api.progress.mediaQueued', { count: Number(queued[1]) });
  if (locale !== 'zh-CN' && HAN.test(raw)) return t('api.progress.working');
  return raw;
}
