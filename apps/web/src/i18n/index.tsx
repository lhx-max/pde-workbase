'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { en } from './locales/en';
import { zhCN } from './locales/zh-CN';
import { getBezierHost } from '@bezier/host';
import { applyBrandName } from './brand';
import { LOCALES, type Dict, type Locale } from './types';

export { LOCALES, LOCALE_LABEL } from './types';
export type { Locale } from './types';

type DictKey = keyof Dict;

// Only active UI locales are bundled. Legacy locale identifiers remain in the
// public type for persisted data, but resolve to English through `t()`.
const DICTS: Partial<Record<Locale, Dict>> = {
  'en': en,
  'zh-CN': zhCN,
};

const LS_KEY = 'bezier:locale';
// Only a deliberate language choice overrides the independent product's
// Chinese default. Legacy automatic browser/OS choices are not user intent.
export const DEFAULT_LOCALE: Locale = 'zh-CN';
const LS_SOURCE_KEY = 'bezier:locale-source';
const MANUAL_LOCALE_SOURCE = 'manual';

function renderTranslation(
  raw: string,
  vars?: Record<string, string | number>,
): string {
  const rendered = vars
    ? raw.replace(/\{(\w+)\}/g, (_, name: string) => {
        const value = vars[name];
        return value == null ? `{${name}}` : String(value);
      })
    : raw;

  // Keep upstream locale refreshes from reintroducing the retired product name.
  return applyBrandName(rendered);
}

export function resolveSystemLocale(languages: readonly string[]): Locale | null {
  const supported = LOCALES as readonly string[];
  for (const raw of languages) {
    const normalized = raw.trim();
    if (!normalized) continue;

    const exact = LOCALES.find((locale) => locale.toLowerCase() === normalized.toLowerCase());
    if (exact) return exact;

    const [language] = normalized.toLowerCase().split('-');
    if (language === 'zh') {
      // The product intentionally uses one Chinese UI locale. Traditional
      // Chinese system settings therefore resolve to Simplified Chinese
      // instead of selecting a no-longer-supported UI pack.
      return 'zh-CN';
    }

    const baseMatch = LOCALES.find((locale) => locale.toLowerCase().split('-')[0] === language);
    if (baseMatch && supported.includes(baseMatch)) return baseMatch;
  }
  return null;
}

/**
 * A `t()` bound to an explicit content-language tag rather than the app UI
 * locale. Used by the question-form card so host-rendered strings inside the
 * card (the "Other" chip, custom-answer copy) match the language the model
 * localized the form into — a Chinese form in an English UI must not mix
 * scripts. Returns null when the tag doesn't resolve to a bundled locale;
 * callers fall back to the context `t`.
 */
export function tForLanguageTag(
  tag: string | undefined,
): ((key: DictKey, vars?: Record<string, string | number>) => string) | null {
  if (!tag || !tag.trim()) return null;
  const locale = resolveSystemLocale([tag]);
  if (!locale) return null;
  const dict = DICTS[locale] ?? en;
  return (key, vars) => {
    const raw = dict[key] ?? en[key] ?? key;
    return renderTranslation(raw, vars);
  };
}

// Simplified Chinese is the standalone product default, including SSR and
// storage-denied browsers. Preserve explicit supported user choices, but do
// not let the test browser's or operating system's English locale change it.
export function detectInitialLocale(): Locale {
  if (typeof window === 'undefined') return DEFAULT_LOCALE;
  let storedLocale: string | null = null;
  let storedSource: string | null = null;
  try {
    storedLocale = window.localStorage.getItem(LS_KEY);
    storedSource = window.localStorage.getItem(LS_SOURCE_KEY);
  } catch {
    /* ignore */
  }
  if (
    storedSource === MANUAL_LOCALE_SOURCE &&
    storedLocale &&
    (LOCALES as string[]).includes(storedLocale)
  ) {
    return storedLocale as Locale;
  }
  return DEFAULT_LOCALE;
}

// Non-React services follow the mounted application's language, just like the
// document and native host. Tokens prevent stale cleanup from clearing another
// owner. Registration occurs only in effects, never during server rendering.
const applicationLocales = new Map<symbol, Locale>();
export function getActiveLocale(): Locale {
  return Array.from(applicationLocales.values()).at(-1) ?? detectInitialLocale();
}

interface I18nContextValue {
  locale: Locale;
  setLocale: (next: Locale) => void;
  t: (key: DictKey, vars?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

// Stand-alone active translator used when no provider is mounted (e.g. an
// isolated test). It MUST be a module-level singleton, not rebuilt per render:
// components legitimately list `t` in effect dependency arrays, and inside the
// provider `t` is identity-stable (useCallback on [locale]). A fresh closure
// here would break that contract only on the provider-less path, turning any
// such effect into an infinite render loop that spins instead of failing —
// which reads as a hung test suite rather than a bug.
const FALLBACK_I18N: I18nContextValue = {
  get locale() { return getActiveLocale(); },
  setLocale: () => { },
  t: tActive,
};

interface ProviderProps {
  initial?: Locale;
  children: ReactNode;
}

const RTL_LOCALES: Locale[] = [];

export function I18nProvider({ initial, children }: ProviderProps) {
  const [locale, setLocaleState] = useState<Locale>(() => initial ?? detectInitialLocale());

  useEffect(() => {
    const owner = Symbol('application-locale');
    applicationLocales.set(owner, locale);
    return () => { applicationLocales.delete(owner); };
  }, [locale]);

  // Keep <html lang="…" dir="…"> in sync so screen readers and CSS hooks
  // pick the right language token and direction without each component
  // having to set it itself.
  useEffect(() => {
    if (typeof document !== 'undefined') {
      const dir = RTL_LOCALES.includes(locale) ? 'rtl' : 'ltr';
      document.documentElement.setAttribute('lang', locale);
      document.documentElement.setAttribute('dir', dir);
    }
    // Native menus and dialogs follow this choice when it differs from the OS.
    getBezierHost()?.ui?.setLocale(locale);
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    try {
      window.localStorage.setItem(LS_KEY, next);
      // Marker so detectInitialLocale knows this came from a deliberate
      // user action and should beat the desktop host's OS locale.
      window.localStorage.setItem(LS_SOURCE_KEY, MANUAL_LOCALE_SOURCE);
    } catch {
      /* ignore */
    }
  }, []);

  const t = useCallback(
    (key: DictKey, vars?: Record<string, string | number>): string => {
      const dict = DICTS[locale] ?? en;
      const raw = dict[key] ?? en[key] ?? key;
      return renderTranslation(raw, vars);
    },
    [locale],
  );

  const value = useMemo<I18nContextValue>(
    () => ({ locale, setLocale, t }),
    [locale, setLocale, t],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function tActive(key: DictKey, vars?: Record<string, string | number>): string {
  const locale = getActiveLocale();
  const dict = DICTS[locale] ?? en;
  const raw = dict[key] ?? en[key] ?? key;
  return renderTranslation(raw, vars);
}

export function tForLocale(locale: string, key: DictKey, vars?: Record<string, string | number>): string {
  const resolved = locale === 'zh-TW' ? 'zh-CN' : locale;
  const dict = (DICTS as Record<string, Dict | undefined>)[resolved] ?? en;
  const raw = dict[key] ?? en[key] ?? key;
  return renderTranslation(raw, vars);
}

export function useI18n(): I18nContextValue {
  // Falling back keeps the API safe to call without requiring every callsite
  // to wrap in a provider. See FALLBACK_I18N on why it is a shared singleton.
  return useContext(I18nContext) ?? FALLBACK_I18N;
}

// Convenience for components that only need the translator function.
export function useT(): I18nContextValue['t'] {
  return useI18n().t;
}
