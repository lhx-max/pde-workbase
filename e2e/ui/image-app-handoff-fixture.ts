/** Isolated, loopback-only UI fixture. Does not implement the image App. */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { createCanvasServer } from '../../apps/server/src/server.js';

const { values } = parseArgs({ options: { 'data-dir': { type: 'string' }, port: { type: 'string', default: '17464' } } });
if (!values['data-dir'] || !path.isAbsolute(values['data-dir'])) throw new Error('Pass a new absolute fixture data root');
const port = Number(values.port);
if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid fixture port');
// Refuse an existing root: fixture setup may never overwrite retained user data.
await mkdir(values['data-dir']);
const server = createCanvasServer({ dataRoot: values['data-dir'], host: '127.0.0.1', authorizeAppManagement: () => true });
await server.ready;
server.registry.create({ id: 'image-contract', name: '图片模式接缝验收' });
const project = server.registry.resolveProjectRoot('image-contract');
await mkdir(path.join(project, 'images'), { recursive: true });
await writeFile(path.join(project, 'images/card.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400"><rect width="640" height="400" fill="#dbeafe"/><circle cx="320" cy="190" r="100" fill="#2563eb"/><text x="320" y="350" text-anchor="middle" font-size="28" fill="#172554">Image App handoff fixture</text></svg>');
await server.canvas.updateMediaState('image-contract', state => ({ ...state, workbenchImages: [{ id: 'image-card-1', name: '图片卡接缝测试', path: 'images/card.svg', src: '/api/projects/image-contract/files/images/card.svg', x: 100, y: 80, naturalWidth: 640, naturalHeight: 400, status: 'ready' }] }));
const listener = server.app.listen(port, '127.0.0.1', () => console.log(`Image handoff fixture API: http://127.0.0.1:${port}`));
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => {
  listener.close(() => { void server.close().then(() => { process.exitCode = 0; }); });
});
