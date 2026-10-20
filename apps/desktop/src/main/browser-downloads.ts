import { basename, isAbsolute } from 'node:path';
import type { DownloadItem, SaveDialogOptions, Session, WebContents } from 'electron';
import { allowedBrowserUrl, trustedDocument } from '../policy.js';

/** Adapted from upstream runtime.ts attachDownloadSaveAsDialog. Keep the native
 * Save As surface, never create an alternate download manager or auto-open files.
 * Only an owned live document can ask, and every file requires explicit consent.
 */
export function attachBrowserDownloads(options: {
  session: Session;
  owner: WebContents;
  getGuest(source: WebContents): WebContents | undefined;
  ownerAlive(): boolean;
  appUrl: URL;
  serverUrl: URL;
  blockedOrigins: readonly string[];
  choosePath(options: SaveDialogOptions): string | undefined;
}): () => void {
  const active = new Set<() => void>();
  let disposed = false;
  const handler = (event: Electron.Event, item: DownloadItem, source: WebContents) => {
    const isOwner = source === options.owner;
    const initialUrl = source?.getURL();
    const validSource = () => !disposed && options.ownerAlive() && source && !source.isDestroyed()
      && !source.isLoadingMainFrame() && source.getURL() === initialUrl
      && (isOwner ? trustedDocument(initialUrl, options.appUrl) : options.getGuest(source) === source && allowedBrowserUrl(initialUrl, options.blockedOrigins));
    // Electron reports WebContents, not the initiating frame, for native
    // downloads. Do not invent frame provenance or grant host IPC permission:
    // every download is restricted to file surfaces and confirmed natively.
    const validTarget = (input: string) => {
      try {
        const url = new URL(input);
        if (!isOwner) {
          if (url.protocol !== 'blob:') return allowedBrowserUrl(input, options.blockedOrigins);
          const source = new URL(input.slice(5));
          return source.origin === new URL(initialUrl).origin && allowedBrowserUrl(source.href, options.blockedOrigins);
        }
        if (url.username || url.password) return false;
        if (url.protocol === 'blob:') return url.origin === options.appUrl.origin;
        if (!['http:', 'https:'].includes(url.protocol) || ![options.appUrl.origin, options.serverUrl.origin].includes(url.origin)) return false;
        // Only known file/export surfaces, never arbitrary privileged endpoints.
        return /^\/api\/projects\/[^/]+\/(?:raw\/[^/].*|files\/[^/].*|archive)$/.test(url.pathname)
          || /^\/api\/asset-library\/(?:[^/]+\/content|export)$/.test(url.pathname);
      } catch { return false; }
    };
    if (!validSource() || !validTarget(item.getURL()) || !item.getURLChain().every(validTarget)) {
      event.preventDefault(); return;
    }
    let canceled = false;
    let settled = false;
    const cleanup = () => {
      if (settled) return;
      settled = true; active.delete(cancel);
      source.removeListener('did-start-navigation', navigation);
      source.removeListener('destroyed', cancel);
      source.removeListener('render-process-gone', cancel);
      if (!isOwner) {
        options.owner.removeListener('did-start-navigation', navigation);
        options.owner.removeListener('destroyed', cancel);
        options.owner.removeListener('render-process-gone', cancel);
      }
      item.removeListener('done', cleanup);
    };
    const cancel = () => {
      if (settled) return;
      canceled = true;
      try { item.cancel(); } catch { /* Chromium may have already disposed it. */ }
      cleanup();
    };
    const navigation = (details: { isMainFrame?: boolean }) => { if (details.isMainFrame !== false) cancel(); };
    active.add(cancel);
    source.on('did-start-navigation', navigation);
    source.on('destroyed', cancel); source.on('render-process-gone', cancel);
    if (!isOwner) {
      options.owner.on('did-start-navigation', navigation);
      options.owner.on('destroyed', cancel); options.owner.on('render-process-gone', cancel);
    }
    item.once('done', cleanup);
    try {
      // Synchronous native dialog assigns no destination until consent and lets
      // Electron retain the initiating download, rather than re-fetch credentials.
      const name = basename(item.getFilename().replace(/\\/g, '/')).replace(/[\x00-\x1f\x7f]/g, '').replace(/^\.+/, '').slice(0, 180) || 'download';
      const extension = name.split('.').at(-1)?.toLowerCase();
      const filters = ['png', 'jpg', 'jpeg', 'webp'].includes(extension ?? '')
        ? [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }, { name: 'All Files', extensions: ['*'] }]
        : [{ name: 'All Files', extensions: ['*'] }];
      const path = options.choosePath({ title: 'Save As', defaultPath: name, filters,
        message: `Download from ${new URL(item.getURL()).origin} in ${new URL(initialUrl).origin}`, properties: ['dontAddToRecent'] });
      if (!path || !isAbsolute(path) || canceled || !validSource()) {
        event.preventDefault(); cancel(); return;
      }
      item.setSavePath(path);
    } catch {
      event.preventDefault(); cancel();
    }
  };
  options.session.on('will-download', handler);
  return () => {
    disposed = true; options.session.removeListener('will-download', handler);
    for (const cancel of [...active]) cancel();
  };
}
