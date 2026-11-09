import type { HtmlViewerAdapters } from './adapters';

/** Missing optional host operations are failures, never fabricated success. */
export class HtmlViewerCapabilityUnavailable extends Error {
  readonly code = 'UNSUPPORTED_CAPABILITY';
  constructor(public capability: keyof HtmlViewerAdapters) {
    super(`The embedding host has not configured ${capability}.`);
    this.name = 'HtmlViewerCapabilityUnavailable';
  }
}

/** Per-viewer adapter resolution: no mutable global host singleton. */
export function resolveHtmlViewerAdapters(adapters: HtmlViewerAdapters): Required<HtmlViewerAdapters> {
  return new Proxy(adapters, {
    get(target, key: keyof HtmlViewerAdapters) {
      return target[key] ?? (() => Promise.reject(new HtmlViewerCapabilityUnavailable(key)));
    },
  }) as Required<HtmlViewerAdapters>;
}
