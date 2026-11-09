export const OPEN_COLLECTOR_TAB_EVENT = 'bezier-design:open-collector-tab';
export const MOBILE_BROWSER_USER_AGENT = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Mobile Safari/537.36';

export function droppedBrowserImage(data: Pick<DataTransfer, 'getData'>): string | null {
  const html = data.getData('text/html');
  const image = html ? new DOMParser().parseFromString(html, 'text/html').querySelector('img')?.getAttribute('src') : null;
  const url = image || data.getData('text/uri-list').split('\n').find(line => line && !line.startsWith('#')) || '';
  try { const parsed = new URL(url.trim()); return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : null; } catch { return null; }
}
