/** Explicit local-only Provider runner. Does not read or reuse the live canvas data root. */
import path from 'node:path';
import { parseArgs } from 'node:util';
import { createCanvasServer } from './server.js';

if (process.env.NODE_ENV === 'production') throw new Error('The isolated local Provider runner is unavailable in production');

const { values } = parseArgs({ options: { 'data-dir': { type: 'string' }, port: { type: 'string', default: '17463' } }, strict: true });
const dataRoot = values['data-dir'];
const port = Number(values.port);
if (!dataRoot || !path.isAbsolute(dataRoot)) throw new Error('--data-dir must be an explicit absolute path (use a separate Kit data directory)');
if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) throw new Error('--port must be an integer between 1024 and 65535');
const canvas = createCanvasServer({ dataRoot, host: '127.0.0.1', providerLocalDevelopment: true });
await canvas.ready;
const http = canvas.app.listen(port, '127.0.0.1', () => {
  console.log(`Local-only canvas Provider: http://127.0.0.1:${port}; dataRoot=${path.resolve(dataRoot)}`);
});
http.on('error', async error => { console.error(error); await canvas.close(); process.exitCode = 1; });
let closing = false;
const close = async () => {
  if (closing) return;
  closing = true;
  await new Promise<void>(resolve => http.close(() => resolve()));
  await canvas.close();
};
process.once('SIGINT', () => { void close(); });
process.once('SIGTERM', () => { void close(); });
