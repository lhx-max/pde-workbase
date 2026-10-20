import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindDesktopLocale } from '../../src/main/locales/desktop-ui.js';
afterEach(() => bindDesktopLocale('zh-CN'));
import type { DownloadItem, Session, WebContents } from 'electron';
import { attachBrowserDownloads } from '../../src/main/browser-downloads.js';

const appUrl = new URL('http://127.0.0.1:18001/');
const serverUrl = new URL('http://127.0.0.1:18002/');
function contents(url: string) {
  return Object.assign(new EventEmitter(), { getURL: vi.fn(() => url), isDestroyed: vi.fn(() => false), isLoadingMainFrame: vi.fn(() => false) });
}
function fixture() {
  const session = new EventEmitter(); const owner = contents(appUrl.href); const guest = contents('https://site.test/page');
  let alive = true;
  const choosePath = vi.fn((): string | undefined => '/user/chosen/image.png');
  const dispose = attachBrowserDownloads({ session: session as unknown as Session,
    owner: owner as unknown as WebContents, getGuest: source => source === guest as unknown ? guest as unknown as WebContents : undefined,
    ownerAlive: () => alive, appUrl, serverUrl, blockedOrigins: [appUrl.origin, serverUrl.origin, 'http://127.0.0.1:18003'], choosePath,
  });
  function download(url = 'https://site.test/image.png', source = guest, chain = [url]) {
    const item = Object.assign(new EventEmitter(), { getURL: () => url, getURLChain: () => chain,
      getFilename: () => '../../image.png', setSavePath: vi.fn(), cancel: vi.fn(), isDestroyed: () => false });
    const event = { preventDefault: vi.fn() };
    session.emit('will-download', event, item as unknown as DownloadItem, source as unknown as WebContents);
    return { item, event };
  }
  return { session, owner, guest, choosePath, dispose, download, revoke: () => { alive = false; } };
}
describe('native user-confirmed downloads', () => {
  it('uses the original Save As lifecycle and only writes the explicitly chosen path', () => {
    const f = fixture(); const { item, event } = f.download();
    expect(f.choosePath).toHaveBeenCalledWith(expect.objectContaining({ title: '另存为', buttonLabel: '保存', defaultPath: 'image.png', message: '从 https://site.test 页面下载 https://site.test 的文件',
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] }, { name: '所有文件', extensions: ['*'] }] }));
    expect(item.setSavePath).toHaveBeenCalledWith('/user/chosen/image.png'); expect(event.preventDefault).not.toHaveBeenCalled();
  });
  it('retains explicit English native download labels', () => {
    bindDesktopLocale('en');
    const f = fixture(); f.download();
    expect(f.choosePath).toHaveBeenCalledWith(expect.objectContaining({ title: 'Save As',
      message: 'Download from https://site.test in https://site.test' }));
    f.dispose();
  });
  it('allows a guest-owned blob but never borrows another origin', () => {
    const f = fixture(); expect(f.download('blob:https://site.test/id').item.setSavePath).toHaveBeenCalled();
    expect(f.download('blob:https://other.test/id').event.preventDefault).toHaveBeenCalled();
    expect(f.download('blob:https://user:pass@site.test/id').event.preventDefault).toHaveBeenCalled();
  });
  it('cancels when the user dismisses Save As', () => {
    const f = fixture(); f.choosePath.mockReturnValue(undefined); const { item, event } = f.download();
    expect(event.preventDefault).toHaveBeenCalled(); expect(item.setSavePath).not.toHaveBeenCalled();
  });
  it.each(['file:///private/key', 'https://user:secret@site.test/x', 'http://localhost:18002/api/projects', 'http://127.0.0.1:18003/command', 'data:text/html,bad', 'blob:null/id'])('rejects unsafe guest target %s before showing a dialog', url => {
    const f = fixture(); const { event } = f.download(url); expect(event.preventDefault).toHaveBeenCalled(); expect(f.choosePath).not.toHaveBeenCalled();
  });
  it('checks every redirect and rejects unknown guest web contents', () => {
    const f = fixture();
    expect(f.download('https://site.test/x', f.guest, ['http://127.0.0.1:18002/api/secret', 'https://site.test/x']).event.preventDefault).toHaveBeenCalled();
    expect(f.download('https://site.test/x', contents('https://site.test/page')).event.preventDefault).toHaveBeenCalled();
    expect(f.choosePath).not.toHaveBeenCalled();
  });
  it('permits trusted application file/blob exports but never privileged configuration or preview initiators', () => {
    const f = fixture();
    expect(f.download(`${appUrl.origin}/api/projects/p/raw/file.png`, f.owner).item.setSavePath).toHaveBeenCalled();
    expect(f.download(`blob:${appUrl.origin}/id`, f.owner).item.setSavePath).toHaveBeenCalled();
    expect(f.download(`${serverUrl.origin}/api/asset-library/a/content`, f.owner).item.setSavePath).toHaveBeenCalled();
    f.choosePath.mockClear();
    expect(f.download(`${appUrl.origin}/api/app-config`, f.owner).event.preventDefault).toHaveBeenCalled();
    f.owner.getURL.mockReturnValue(`${appUrl.origin}/api/projects/p/preview/a.html`);
    expect(f.download(`${appUrl.origin}/api/projects/p/raw/file.png`, f.owner).event.preventDefault).toHaveBeenCalled();
    expect(f.choosePath).not.toHaveBeenCalled();
  });
  it('cancels a stale document during the native dialog and never assigns the destination', () => {
    const f = fixture(); f.choosePath.mockImplementation(() => { f.guest.emit('did-start-navigation', { isMainFrame: true }); return '/user/chosen/file'; });
    const { item, event } = f.download(); expect(event.preventDefault).toHaveBeenCalled(); expect(item.setSavePath).not.toHaveBeenCalled();
  });
  it('cancels active downloads on navigation, revocation and disposal, removing listeners after completion', () => {
    const f = fixture(); const a = f.download().item; f.guest.emit('did-start-navigation', { isMainFrame: false }); expect(a.cancel).not.toHaveBeenCalled();
    f.guest.emit('did-start-navigation', { isMainFrame: true }); expect(a.cancel).toHaveBeenCalledOnce();
    const b = f.download().item; b.emit('done', {}, 'completed'); f.guest.emit('destroyed'); expect(b.cancel).not.toHaveBeenCalled();
    const c = f.download().item; f.dispose(); expect(c.cancel).toHaveBeenCalledOnce(); expect(f.session.listenerCount('will-download')).toBe(0);
    const g = fixture(); g.revoke(); expect(g.download().event.preventDefault).toHaveBeenCalled(); expect(g.choosePath).not.toHaveBeenCalled();
  });
});
