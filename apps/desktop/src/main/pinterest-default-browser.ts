import { basename, join } from 'node:path';
import { stat } from 'node:fs/promises';

/** Resolve the HTTPS default, never substitute another installed browser. */
export function pinterestDefaultBrowser(info: { name: string; path: string }, appData: string) {
  const bundle = basename(info.path);
  const directories: Record<string, string[]> = {
    'Google Chrome.app': ['Google', 'Chrome'],
    'Microsoft Edge.app': ['Microsoft Edge'],
    'Microsoft Edge Beta.app': ['Microsoft Edge Beta'],
    'Microsoft Edge Dev.app': ['Microsoft Edge Dev'],
    'Microsoft Edge Canary.app': ['Microsoft Edge Canary'],
    'Chromium.app': ['Chromium'],
  };
  const directory = directories[bundle];
  return {
    name: info.name || bundle.replace(/\.app$/, ''),
    path: info.path,
    registryDir: directory ? join(appData, ...directory, 'NativeMessagingHosts') : null,
  };
}

/**
 * Every Chromium-family browser we know how to register a Native Messaging host
 * into, expressed as the subdirectory it keeps under the platform appData
 * (`~/Library/Application Support` on macOS). A browser is considered installed
 * when that subdirectory exists, which is enough — writing the host manifest
 * into a browser that never loads the extension is inert, so we never have to
 * guess which browser the user will run the extension in.
 */
export const KNOWN_BROWSER_SUBDIRS: ReadonlyArray<readonly string[]> = [
  ['Google', 'Chrome'],
  ['Microsoft Edge'],
  ['Microsoft Edge Beta'],
  ['Microsoft Edge Dev'],
  ['Microsoft Edge Canary'],
  ['Chromium'],
  ['BraveSoftware', 'Brave-Browser'],
];

/**
 * Returns the NativeMessagingHosts registry directories of every browser from
 * {@link KNOWN_BROWSER_SUBDIRS} whose support directory currently exists under
 * `appData`. Sorted for deterministic ordering; empty when no supported
 * browser is installed.
 */
export async function installedBrowserRegistryDirs(appData: string): Promise<string[]> {
  const dirs: string[] = [];
  await Promise.all(
    KNOWN_BROWSER_SUBDIRS.map(async (parts) => {
      const support = join(appData, ...parts);
      // Stat the browser's support dir itself; a bare NativeMessagingHosts dir
      // is created lazily by the browser, so its absence does not mean the
      // browser is uninstalled — only the support dir is a reliable signal.
      try { await stat(support); } catch { return; }
      dirs.push(join(support, 'NativeMessagingHosts'));
    }),
  );
  return dirs.sort();
}
