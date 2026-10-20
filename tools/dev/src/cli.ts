#!/usr/bin/env node
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const args = process.argv.slice(2);
function option(name: string, fallback?: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`);
  return value;
}
function port(name: string, fallback: number): number {
  const value = Number(option(name, String(fallback)));
  if (!Number.isInteger(value) || value < 1024 || value > 65535) throw new Error(`Invalid ${name}`);
  return value;
}
function requireAbsolute(name: string, value?: string): string {
  if (!value || !path.isAbsolute(value)) throw new Error(`${name} requires an explicit absolute path`);
  return path.resolve(value);
}
async function available(port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(port, '127.0.0.1', () => probe.close(error => error ? reject(error) : resolve()));
  });
}
function required(relative: string): string {
  const target = path.join(root, relative);
  if (!existsSync(target)) throw new Error(`Missing ${relative}. Run the corresponding package build/install first.`);
  return target;
}

if (args.includes('--help') || !args.length) {
  console.log(`Canvas Workspace lifecycle\n\n  pnpm tools-dev run web|desktop|server --data-dir ABSOLUTE_PATH\n    [--daemon-port 17456] [--web-port 17573] [--browser-host-port 17574]\n    [--desktop-user-data ABSOLUTE_PATH] [--production]\n  pnpm tools-dev check\n\nA data root is mandatory; no original application data is discovered or reused.\nCtrl+C stops only the child processes launched by this invocation.\nThe desktop profile defaults to a child of the explicitly supplied data root.\nUse separate data roots, profiles and ports for concurrent instances.`);
  process.exit(0);
}
if (Number(process.versions.node.split('.')[0]) !== 24) throw new Error('Node 24 is required');
if (args[0] === 'check') {
  for (const item of ['apps/server/dist/cli.js', 'apps/desktop/dist/main.js', 'apps/web/node_modules/next/dist/bin/next']) required(item);
  console.log(JSON.stringify({ ok: true, node: process.version, root }));
  process.exit(0);
}
if (args[0] !== 'run' || !['web', 'desktop', 'server'].includes(args[1] ?? '')) throw new Error('Use tools-dev run web|desktop|server --data-dir ABSOLUTE_PATH');
const target = args[1]!;
const dataRoot = requireAbsolute('--data-dir / CANVAS_DATA_DIR', option('--data-dir', process.env.CANVAS_DATA_DIR));
const serverPort = port('--daemon-port', 17456);
const webPort = port('--web-port', 17573);
const browserPort = port('--browser-host-port', 17574);
const inspectPort = args.includes('--inspect-port') ? port('--inspect-port', 17575) : undefined;
if (inspectPort && target !== 'desktop') throw new Error('--inspect-port is only for explicit desktop diagnostics');
const usedPorts = target === 'desktop' ? [serverPort, webPort, browserPort, ...(inspectPort ? [inspectPort] : [])] : target === 'web' ? [serverPort, webPort] : [serverPort];
if (new Set(usedPorts).size !== usedPorts.length) throw new Error('Listener ports must be distinct');
for (const value of usedPorts) await available(value);
const webUrl = `http://127.0.0.1:${webPort}`;
const serverUrl = `http://127.0.0.1:${serverPort}`;
const env: NodeJS.ProcessEnv = { ...process.env, CANVAS_DATA_DIR: dataRoot, CANVAS_PORT: String(serverPort), CANVAS_WEB_URL: webUrl, CANVAS_SERVER_URL: serverUrl, CANVAS_SERVER_ORIGIN: serverUrl, NEXT_TELEMETRY_DISABLED: '1' };
if (target === 'desktop') {
  env.CANVAS_DESKTOP_AUTH_TOKEN = randomBytes(32).toString('base64url');
  env.CANVAS_BROWSER_HOST_PORT = String(browserPort);
  env.CANVAS_BROWSER_HOST_URL = `http://127.0.0.1:${browserPort}`;
  env.CANVAS_DESKTOP_USER_DATA = requireAbsolute('--desktop-user-data', option('--desktop-user-data', path.join(dataRoot, 'desktop-profile')));
}
mkdirSync(dataRoot, { recursive: true });
const children = new Set<ChildProcess>();
const controller = new AbortController();
let stopping = false;
let failed = false;
function stop(code: number) {
  if (stopping) return;
  stopping = true;
  failed ||= code !== 0;
  controller.abort();
  for (const child of children) child.kill('SIGTERM');
  const deadline = setTimeout(() => {
    for (const child of children) child.kill('SIGKILL');
  }, 5000);
  deadline.unref();
  if (!children.size) process.exitCode = failed ? 1 : 0;
}
function launch(label: string, executable: string, argv: string[], cwd: string) {
  const child = spawn(executable, argv, { cwd, env, stdio: 'inherit' });
  children.add(child);
  child.once('error', error => { console.error(`${label}:`, error.message); stop(1); });
  child.once('exit', (code, signal) => {
    children.delete(child);
    if (!stopping) { console.error(`${label} exited (${code ?? signal})`); stop(code === 0 ? 0 : 1); }
    if (!children.size) process.exitCode = failed ? 1 : 0;
  });
  return child;
}
async function waitFor(url: string, health: boolean) {
  const deadline = Date.now() + 120000;
  while (!controller.signal.aborted && Date.now() < deadline) {
    try {
      const response = await fetch(url, { headers: health && env.CANVAS_AUTH_TOKEN ? { Authorization: `Bearer ${env.CANVAS_AUTH_TOKEN}` } : {}, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(2500)]) });
      if (response.ok && (!health || (await response.json() as { service?: string }).service === 'canvas-workspace')) return;
    } catch { /* Retry only readiness, never user mutations. */ }
    await new Promise<void>(resolve => {
      const done = () => { clearTimeout(timer); controller.signal.removeEventListener('abort', done); resolve(); };
      const timer = setTimeout(done, 250);
      controller.signal.addEventListener('abort', done, { once: true });
      if (controller.signal.aborted) done();
    });
  }
  throw new Error(controller.signal.aborted ? 'Runtime stopped before readiness' : `Readiness timeout: ${url}`);
}
process.once('SIGINT', () => stop(0));
process.once('SIGTERM', () => stop(0));
try {
  launch('server', process.execPath, [required('apps/server/dist/cli.js'), '--host', '127.0.0.1', '--port', String(serverPort), '--data-dir', dataRoot], root);
  await waitFor(`${serverUrl}/api/health`, true);
  if (target !== 'server') {
    launch('web', process.execPath, [required('apps/web/node_modules/next/dist/bin/next'), args.includes('--production') ? 'start' : 'dev', '--hostname', '127.0.0.1', '--port', String(webPort)], path.join(root, 'apps/web'));
    await waitFor(webUrl, false);
  }
  if (target === 'desktop') {
    const requireDesktop = createRequire(required('apps/desktop/package.json'));
    const electronPath: unknown = requireDesktop('electron');
    if (typeof electronPath !== 'string') throw new Error('Electron executable was not installed');
    launch('desktop', electronPath, [...(inspectPort ? [`--remote-debugging-port=${inspectPort}`, '--remote-debugging-address=127.0.0.1'] : []), required('apps/desktop/dist/main.js')], root);
  }
  console.log(JSON.stringify({ app: 'canvas-workspace', ready: true, target, serverUrl, ...(target !== 'server' ? { webUrl } : {}), dataRoot }));
} catch (error) {
  if (!stopping) console.error(error instanceof Error ? error.message : error);
  stop(stopping ? 0 : 1);
}
