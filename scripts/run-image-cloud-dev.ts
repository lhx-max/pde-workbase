/** Explicit, single-maintainer development runner: remote Appwrite business data,
 * disposable local process/cache state. Never a staging/multi-user auth configuration. */
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import path from 'node:path';
import { createCanvasServer } from '../apps/server/src/server.js';
import { createHttpMediaAdapter } from '../apps/server/src/http-adapters.js';

const { values } = parseArgs({ options: { 'cache-dir': { type: 'string' }, 'maintenance-console-prefs': { type: 'string' }, 'adapter-token-file': { type: 'string' }, 'runtime-namespace': { type: 'string' }, port: { type: 'string', default: '17462' }, 'adapter-url': { type: 'string', default: 'http://127.0.0.1:17465' } } });
for (const key of ['cache-dir', 'maintenance-console-prefs', 'adapter-token-file'] as const) if (!values[key] || !path.isAbsolute(values[key]!)) throw new Error(`Pass an explicit absolute --${key}`);
if (process.env.NODE_ENV === 'production' || process.env.BEZIER_AUTH_IDENTITY_SOURCE === 'request') throw new Error('Maintenance runner is not a production or MA identity bridge');
if (!values['runtime-namespace']) throw new Error('Pass an explicit initialized --runtime-namespace; one writer only');
const prefs = JSON.parse(await readFile(values['maintenance-console-prefs']!, 'utf8'));
const current = prefs[prefs.current];
const raw = typeof current?.cookie === 'string' ? /a_session_console=([^;,\s]+)/u.exec(current.cookie)?.[1] : undefined;
if (!raw) throw new Error('Current CLI console maintenance session is unavailable');
const cookie = `a_session_console=${raw}`;
const endpoint = 'https://frontend-cloud.corp.kuaishou.com/v1';
// Verify actual target-resource authorization; console sessions are not project-user cookies.
const identity = await fetch(`${endpoint}/databases/canvas_app_dev/collections/canvases/documents?queries[]=${encodeURIComponent(JSON.stringify({method:'limit',values:[1]}))}`, { headers: { 'x-appwrite-project': 'grworkspace', cookie, 'x-appwrite-mode': 'admin' }, redirect: 'error' });
if (!identity.ok) throw new Error('Current maintenance storage authorization was rejected');
const adapterToken = (await readFile(values['adapter-token-file']!, 'utf8')).trim();
const api = createCanvasServer({ dataRoot: values['cache-dir']!, host: '127.0.0.1',
  developmentActor: {teamId:'local',userId:'maintenance'},
  appwrite: { endpoint, projectId: 'grworkspace', databaseId: 'canvas_app_dev', bucketId: 'canvas_assets_v2', sessionCookie: cookie, sessionMode: 'admin', runtime: {collectionId:'app_runtime_state',namespace:values['runtime-namespace'],singleWriter:true} },
  media: createHttpMediaAdapter(values['adapter-url']!, adapterToken), allowedOrigins: ['http://127.0.0.1:17580'],
});
await api.ready;
const listener = api.app.listen(Number(values.port), '127.0.0.1', () => console.log(JSON.stringify({ mode: 'single-maintainer-cloud-development', port: Number(values.port), storage: 'Appwrite grworkspace/canvas_app_dev + canvas_assets_v2', local: 'explicit disposable runtime cache' })));
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => listener.close(() => { void api.close(); }));
