import { du, nativeHostLocaleFileBody } from "./locales/desktop-ui.js";
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const PINTEREST_CONNECTOR_ID = 'acgnbiifgajbjpcjfaodlmpekhhdjmfm';
export const PINTEREST_NATIVE_HOST = 'com.canvas_workspace.pinterest_auth';
const quote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;

/** Credentials never enter the URL/clipboard; Chrome's allowlisted native host claims a one-use pairing. */
export async function preparePinterestNativeRelay(options: {
  code: string; executable: string; hostScript: string; runtimeDir: string; registryDir: string;
  onClaim?: () => void;
}) {
  const directory = await mkdtemp(join(tmpdir(), 'da-pin-'));
  const socket = join(directory, 'bridge.sock');
  let claimed = false;
  const server = createServer(client => {
    client.setTimeout(3000, () => client.destroy());
    client.once('data', data => {
      if (data.toString() !== 'claim\n' || claimed) { client.end(JSON.stringify({ error: du().connectionClaimed })); return; }
      claimed = true;
      client.end(JSON.stringify({ code: options.code }));
      options.onClaim?.();
    });
  });
  const close = () => { clearTimeout(timer); server.close(); void rm(directory, { recursive: true, force: true }); };
  const timer = setTimeout(close, 300000); timer.unref();
  try {
    await chmod(directory, 0o700);
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(socket, resolve); });
    await chmod(socket, 0o600);
    await mkdir(options.runtimeDir, { recursive: true, mode: 0o700 });
    await mkdir(options.registryDir, { recursive: true });
    // The host's argv is the temporary socket, so the locale file sits beside that socket.
    await writeFile(join(directory, 'ui-locale'), nativeHostLocaleFileBody(), { mode: 0o600 });
    const launcher = join(options.runtimeDir, 'pinterest-native-host.sh');
    await writeFile(launcher, `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec ${quote(options.executable)} ${quote(options.hostScript)} ${quote(socket)} "$@"\n`, { mode: 0o700 });
    await chmod(launcher, 0o700);
    await writeFile(join(options.registryDir, `${PINTEREST_NATIVE_HOST}.json`), JSON.stringify({ name: PINTEREST_NATIVE_HOST, description: 'DA local Pinterest pairing experiment', path: launcher, type: 'stdio', allowed_origins: [`chrome-extension://${PINTEREST_CONNECTOR_ID}/`] }), { mode: 0o600 });
    return { close };
  } catch (error) { close(); throw error; }
}
