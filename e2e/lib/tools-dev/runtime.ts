import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { T } from '../timeouts.js';

export const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const scratchRoot = path.join(repositoryRoot, '.tmp', 'e2e-runs');
export type RuntimeTarget = 'web' | 'desktop';
export interface ToolsDevRuntime {
  target: RuntimeTarget;
  root: string;
  dataRoot: string;
  serverUrl: string;
  webUrl: string;
  inspectUrl: string;
  browserPort: number;
  logs(): Promise<string>;
  dispose(options?: { preserve?: boolean }): Promise<void>;
}

async function reservePort(): Promise<{ server: Server; port: number }> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Port reservation failed');
  return { server, port: address.port };
}
async function releasePort(server: Server) { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
function ownedSignal(child: ChildProcess, signal: NodeJS.Signals) {
  if (!child.pid) return;
  try {
    if (process.platform === 'win32') child.kill(signal);
    else process.kill(-child.pid, signal); // Only the process group this invocation created.
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
}
/** Framework-neutral lifecycle: every call owns one complete tools-dev instance. */
export async function startToolsDev(options: { target?: RuntimeTarget; label?: string } = {}): Promise<ToolsDevRuntime> {
  const target = options.target ?? 'web';
  await mkdir(scratchRoot, { recursive: true });
  const root = await mkdtemp(path.join(scratchRoot, `${(options.label ?? target).replace(/[^a-z0-9-]/gi, '-')}-`));
  const realRoot = await realpath(root);
  const dataRoot = path.join(root, 'data');
  const logPath = path.join(root, 'runtime.log');
  const reservations = await Promise.all(Array.from({ length: 4 }, () => reservePort()));
  const [serverPort, webPort, browserPort, inspectPort] = reservations.map(item => item.port) as [number, number, number, number];
  const serverUrl = `http://127.0.0.1:${serverPort}`, webUrl = `http://127.0.0.1:${webPort}`, inspectUrl = `http://127.0.0.1:${inspectPort}`;
  // Ports remain reserved together until the single official launcher takes over.
  await Promise.all(reservations.map(item => releasePort(item.server)));
  const pnpmScript = process.env.CANVAS_E2E_PNPM ?? process.env.npm_execpath;
  const args = ['tools-dev', 'run', target, '--data-dir', dataRoot, '--daemon-port', String(serverPort), '--web-port', String(webPort), '--browser-host-port', String(browserPort), '--production'];
  if (target === 'desktop') args.push('--inspect-port', String(inspectPort));
  const executable = pnpmScript ? process.execPath : 'pnpm';
  const argv = pnpmScript ? [pnpmScript, ...args] : args;
  const env: NodeJS.ProcessEnv = { ...process.env, NEXT_TELEMETRY_DISABLED: '1' };
  // Never borrow an ambient data root, native grant secret or external adapter/account.
  for (const key of Object.keys(env)) if (key.startsWith('CANVAS_')) delete env[key];
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(executable, argv, { cwd: repositoryRoot, env, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
  let output = '', pending = '', closed = false, stopping = false;
  let resolveReady!: () => void, rejectReady!: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  let launcherReady = false, desktopReady = false;
  const record = (chunk: Buffer) => {
    const text = chunk.toString('utf8'); output += text; pending += text;
    while (pending.includes('\n')) {
      const index = pending.indexOf('\n'); const line = pending.slice(0, index); pending = pending.slice(index + 1);
      try {
        const message = JSON.parse(line);
        if (message.app === 'canvas-workspace' && message.ready === true && message.serverUrl === serverUrl && message.webUrl === webUrl) launcherReady = true;
        if (message.app === 'canvas-desktop' && message.ready === true && message.nativePort === browserPort) desktopReady = true;
        if (launcherReady && (target === 'web' || desktopReady)) resolveReady();
      } catch { /* Non-JSON application logs remain evidence, not readiness. */ }
    }
  };
  child.stdout?.on('data', record);
  child.stderr?.on('data', (chunk: Buffer) => { output += chunk.toString('utf8'); });
  const exit = new Promise<void>(resolve => {
    child.once('close', (code, signal) => { closed = true; if (!stopping) rejectReady(new Error(`tools-dev exited before readiness (${code ?? signal})\n${output.slice(-12000)}`)); resolve(); });
  });
  child.once('error', error => rejectReady(error));
  let disposed = false;
  const runtime: ToolsDevRuntime = {
    target, root, dataRoot, serverUrl, webUrl, inspectUrl, browserPort,
    logs: async () => { await writeFile(logPath, output); return readFile(logPath, 'utf8'); },
    dispose: async ({ preserve = false } = {}) => {
      if (disposed) return; disposed = true; stopping = true;
      if (!closed) {
        ownedSignal(child, 'SIGTERM');
        const killTimer = setTimeout(() => ownedSignal(child, 'SIGKILL'), T.medium);
        try { await exit; } finally { clearTimeout(killTimer); }
      }
      await writeFile(logPath, output);
      if (!preserve) {
        // Resolve and compare the exact directory we created before recursive deletion.
        const targetPath = await realpath(root);
        if (targetPath !== realRoot || path.dirname(targetPath) !== await realpath(scratchRoot)) throw new Error('Refusing cleanup outside owned runtime scratch');
        await rm(targetPath, { recursive: true, force: true });
      }
    },
  };
  const deadline = setTimeout(() => rejectReady(new Error(`tools-dev readiness deadline exceeded\n${output.slice(-12000)}`)), T.xlong);
  try { await ready; return runtime; }
  catch (error) { await runtime.dispose({ preserve: true }); throw error; }
  finally { clearTimeout(deadline); }
}
