import { randomUUID } from 'node:crypto';
import type { WebContents, WebFrameMain } from 'electron';

export function isPinterestGoogleButton(parentUrl: string, frameUrl: string): boolean {
  try {
    const parent = new URL(parentUrl), frame = new URL(frameUrl);
    return parent.protocol === 'https:' && ['pinterest.com', 'www.pinterest.com'].includes(parent.hostname)
      && frame.origin === 'https://accounts.google.com' && frame.pathname === '/gsi/button';
  } catch { return false; }
}

export function isGoogleLoginUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.origin === 'https://accounts.google.com'
      && /^\/(?:o\/oauth2(?:\/|$)|signin(?:\/|$)|v3\/signin(?:\/|$))/.test(url.pathname);
  } catch { return false; }
}

export function isGoogleButton(parentUrl: string, frameUrl: string): boolean {
  try {
    const parent = new URL(parentUrl), frame = new URL(frameUrl);
    return parent.protocol === 'https:' && parent.hostname !== 'accounts.google.com'
      && frame.origin === 'https://accounts.google.com' && frame.pathname === '/gsi/button';
  } catch { return false; }
}

export function googleButtonClickScript(marker: string): string {
  return `(() => {
    if (window.__daGoogleButtonClick) document.removeEventListener('click', window.__daGoogleButtonClick, true);
    window.__daGoogleButtonClick = event => {
      if (!event.isTrusted || !(event.target instanceof Element) || !event.target.closest('button,[role="button"]')) return;
      event.preventDefault(); event.stopImmediatePropagation(); console.info(${JSON.stringify(marker)});
    };
    document.addEventListener('click', window.__daGoogleButtonClick, true);
  })()`;
}

/** Only the GIS button iframe, never an account/password/consent page. */
export function attachPinterestGoogleButton(guest: WebContents, connect: () => void, matches = isPinterestGoogleButton) {
  const marker = `da-google-button:${randomUUID()}`;
  const install = () => {
    if (guest.isDestroyed()) return;
    for (const frame of guest.mainFrame.framesInSubtree) {
      if (!matches(guest.getURL(), frame.url)) continue;
      void frame.executeJavaScript(googleButtonClickScript(marker)).catch(() => undefined);
    }
  };
  const receive = (event: Electron.Event<Electron.WebContentsConsoleMessageEventParams>) => {
    const frame: WebFrameMain | null = event.frame;
    if (event.message !== marker || !frame || guest.isDestroyed()) return;
    if (!guest.mainFrame.framesInSubtree.includes(frame) || !matches(guest.getURL(), frame.url)) return;
    console.info('[pinterest-auth] Google button iframe click received');
    connect();
  };
  guest.on('did-frame-finish-load', install);
  guest.on('console-message', receive);
  guest.once('destroyed', () => {
    guest.removeListener('did-frame-finish-load', install);
    guest.removeListener('console-message', receive);
  });
  install();
}
