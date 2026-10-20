import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import next from 'next';

// App-owned listener primitive; tools-dev remains the sole lifecycle owner.
const args = process.argv.slice(2);
const option = (name: string): string | undefined => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; };
const hostname = option('--hostname') ?? '127.0.0.1';
const port = Number(option('--port'));
if (hostname !== '127.0.0.1' || !Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Use tools-dev with an explicit loopback web port.');
if (process.env.CANVAS_WEB_URL !== `http://${hostname}:${port}`) throw new Error('The web listener must match the explicit tools-dev runtime URL.');
const dev = !args.includes('--production');
// Next automatically installs an upgrade listener on its declared HTTP server.
// Route that listener through an unbound event target so it cannot also consume MF sockets.
// This object never listens; there is still exactly one web TCP listener.
const nextUpgradeEvents = createServer();
const app = next({ dev, hostname, port, httpServer: nextUpgradeEvents, dir: fileURLToPath(new URL('../../', import.meta.url)) });
await app.prepare();
const handle = app.getRequestHandler();
const rejectUpgrade = (socket: { end: (data: string) => void }, status: number) => { socket.end(`HTTP/1.1 ${status} ${status === 404 ? 'Not Found' : 'Forbidden'}\r\n\r\n`); };
const controller = new AbortController();
const server = createServer((request, response) => { void handle(request, response); });
server.on('upgrade', (request, socket, head) => {
  if (dev && request.url?.startsWith('/_next/')) {
    if (!nextUpgradeEvents.emit('upgrade', request, socket, head)) rejectUpgrade(socket, 404);
  } else rejectUpgrade(socket, 404);
});
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  controller.abort();
  server.close();
  await app.close();
}
process.once('SIGTERM', () => { void stop(); });
process.once('SIGINT', () => { void stop(); });
server.once('error', () => { process.exitCode = 1; void stop(); });
server.listen(port, hostname, () => { console.log(`Canvas web ready: http://${hostname}:${port}`); });
