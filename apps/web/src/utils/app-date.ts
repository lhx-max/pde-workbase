/**
 * Visible dates follow the app language, not the operating system.
 * Chinese UI, including zh-TW, uses zh-CN. Every other UI locale uses English.
 */
export function appDateLocale(locale: string | null | undefined): 'zh-CN' | 'en' {
  const value = (locale ?? '').trim().toLowerCase().replace(/_/g, '-');
  if (value === 'zh' || value.startsWith('zh-')) return 'zh-CN';
  return 'en';
}

export type AppDateInput = number | string | Date;

function asDate(value: AppDateInput): Date {
  return value instanceof Date ? value : new Date(value);
}

export function formatAppDate(
  value: AppDateInput,
  locale: string | null | undefined,
  options?: Intl.DateTimeFormatOptions,
): string {
  return asDate(value).toLocaleDateString(appDateLocale(locale), options);
}

export function formatAppTime(
  value: AppDateInput,
  locale: string | null | undefined,
  options?: Intl.DateTimeFormatOptions,
): string {
  return asDate(value).toLocaleTimeString(appDateLocale(locale), options);
}

export function formatAppDateTime(
  value: AppDateInput,
  locale: string | null | undefined,
  options?: Intl.DateTimeFormatOptions,
): string {
  return asDate(value).toLocaleString(appDateLocale(locale), options);
}
