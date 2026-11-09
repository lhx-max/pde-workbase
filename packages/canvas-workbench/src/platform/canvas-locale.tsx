'use client';

import React from 'react';
import { resolveCanvasLocale } from '../locales/node-catalog';

const CanvasLocaleContext = React.createContext<'en' | 'zh-CN'>('zh-CN');

let activeCanvasLocale: 'en' | 'zh-CN' = 'zh-CN';

/** Active host locale for non-React helpers (toasts, builders). Defaults to zh-CN. */
export function getCanvasActiveLocale(): 'en' | 'zh-CN' {
  return activeCanvasLocale;
}

/** Host locale for canvas chrome. Omitted locale keeps the historical Chinese UI. */
export function CanvasLocaleProvider({
  locale,
  children,
}: {
  locale?: string | null;
  children: React.ReactNode;
}) {
  const resolved = resolveCanvasLocale(locale);
  activeCanvasLocale = resolved;
  React.useEffect(() => {
    activeCanvasLocale = resolved;
  }, [resolved]);
  return (
    <CanvasLocaleContext.Provider value={resolved}>
      {children}
    </CanvasLocaleContext.Provider>
  );
}

export function useCanvasLocale(): 'en' | 'zh-CN' {
  return React.useContext(CanvasLocaleContext);
}
