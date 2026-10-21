import { open, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const MAX_JSON_BYTES = 64 * 1024 * 1024;
const VALUE_FLAGS = new Set(['server-url', 'body-file', 'prompt-file', 'output', 'file', 'mime', 'project', 'session', 'token', 'id', 'navigation', 'scope', 'ids', 'version', 'name', 'kind', 'text-file', 'filename', 'path', 'instance']);
const HELP = `canvas-server request METHOD /api/path [--body-file JSON_PATH|-] [--prompt-file TEXT_PATH|-]
canvas-server assets info|list|get|create|upload|patch|batch|versions|content|export|spaces|uses|metadata|analysis|prompt|import|save
canvas-server browser preferences [--body-file REVISION_PATCH_JSON|-]
canvas-server browser resources start|stop|list|scan|read --project ID --session ID
All commands require --server-url URL (or CANVAS_SERVER_URL); use CANVAS_AUTH_TOKEN for authorization.
JSON APIs return machine-readable JSON (--json accepted). Upload uses --file FILE and optional --body-file METADATA_JSON.
Use --output FILE for binary content/export; existing output files are never overwritten.
Assets import/save require --project ID. Space updates, batches, metadata and versions use the original HTTP JSON body shapes.
Native installation, Save As and browser-login consent remain explicit GUI authorization steps.`;

async function textFile(file: string): Promise<string> {
  if (file !== '-') {
    if ((await stat(file)).size > MAX_JSON_BYTES) throw new Error('Request file exceeds 64 MB');
    const text = await readFile(file, 'utf8');
    if (Buffer.byteLength(text) > MAX_JSON_BYTES) throw new Error('Request file exceeds 64 MB');
    return text;
  }
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of process.stdin) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length; if (size > MAX_JSON_BYTES) throw new Error('Standard input exceeds 64 MB'); chunks.push(bytes);
  }
  return Buffer.concat(chunks).toString('utf8');
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a JSON object body');
  return value as Record<string, unknown>;
}

/** Translate CLI actions into the exact public HTTP APIs; never open another database. */
export async function buildHttpCliRequest(args: string[]): Promise<{ url: URL; init: RequestInit; output?: string }> {
  const flags = new Map<string, string>();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (!arg.startsWith('--')) continue;
    const name = arg.slice(2);
    if (['json', 'help'].includes(name)) continue;
    if (!VALUE_FLAGS.has(name)) throw new Error(`Unsupported option --${name}`);
    const value = args[++i];
    if (!value || value.startsWith('--')) throw new Error(`--${name} requires a value`);
    if (flags.has(name)) throw new Error(`Duplicate option --${name}`);
    flags.set(name, value);
  }
  const flag = (name: string) => flags.get(name);
  const required = (name: string) => { const value = flag(name); if (!value) throw new Error(`--${name} is required`); return value; };
  const base = flag('server-url') ?? process.env.CANVAS_SERVER_URL;
  if (!base) throw new Error('--server-url or CANVAS_SERVER_URL is required for API commands');
  const origin = new URL(base);
  if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password || origin.search || origin.hash) throw new Error('Server URL must be credential-free HTTP(S)');
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(process.env.CANVAS_AUTH_TOKEN ? { Authorization: `Bearer ${process.env.CANVAS_AUTH_TOKEN}` } : {}) };
  const bodyFile = flag('body-file'), promptFile = flag('prompt-file');
  if (bodyFile === '-' && promptFile === '-') throw new Error('Only one input can consume standard input');
  let body: RequestInit['body'] = bodyFile ? await textFile(bodyFile) : undefined;
  let endpoint = '', method = 'GET';
  const bodyObject = () => body === undefined ? {} : object(JSON.parse(String(body)));
  const setBody = (value: Record<string, unknown>) => { body = JSON.stringify(value); };
  const positionalId = () => { const id = args[2]; if (!id || id.startsWith('--')) throw new Error('An asset ID is required'); return id; };
  const multipart = async () => {
    const file = required('file'), info = await stat(file);
    if (!info.isFile() || info.size > 200 * 1024 * 1024) throw new Error('Upload requires a regular file no larger than 200 MB');
    const bytes = await readFile(file);
    if (bytes.length > 200 * 1024 * 1024) throw new Error('Upload exceeds 200 MB');
    const form = new FormData();
    for (const [key, value] of Object.entries(bodyObject())) {
      if (key === 'file') throw new Error('Use --file for binary upload');
      form.append(key, typeof value === 'string' ? value : key === 'parentId' && value === null ? '' : JSON.stringify(value));
    }
    form.append('file', new Blob([Uint8Array.from(bytes)], { type: flag('mime') ?? 'application/octet-stream' }), path.basename(file));
    delete headers['Content-Type']; body = form;
  };
  if (args[0] === 'browser') {
    if (args[1] === 'preferences') { endpoint = '/api/browser-preferences'; method = bodyFile ? 'PUT' : 'GET'; }
    else {
      if (args[1] !== 'resources') throw new Error('Expected browser preferences or browser resources start|stop|list|scan|read');
      const action = args[2] === 'list' ? 'snapshot' : args[2];
      if (!action || !['start', 'stop', 'snapshot', 'scan', 'read'].includes(action)) throw new Error('Invalid browser resource action');
      const project = required('project'), sessionId = required('session'), token = flag('token') ?? process.env.CANVAS_BROWSER_RESOURCE_TOKEN;
      if (!token) throw new Error('CANVAS_BROWSER_RESOURCE_TOKEN or --token is required');
      endpoint = `/api/projects/${encodeURIComponent(project)}/browser-resources/${action}`; method = 'POST'; headers['x-browser-resource-token'] = token;
      const navigation = action === 'read' ? Number(required('navigation')) : undefined;
      if (navigation !== undefined && (!Number.isSafeInteger(navigation) || navigation < 0)) throw new Error('Invalid browser navigation identity');
      setBody({ sessionId, ...(action === 'read' ? { resourceId: required('id'), navigationId: navigation } : {}) });
    }
  } else if (args[0] === 'assets') {
    const action = args[1], root = '/api/asset-library';
    if (action === 'list') endpoint = root;
    else if (action === 'info') endpoint = `${root}/info`;
    else if (action === 'create') {
      endpoint = root; method = 'POST'; const input = bodyObject();
      if (flag('name')) input.name = flag('name'); if (flag('kind')) input.kind = flag('kind');
      if (flag('text-file')) { if (bodyFile === '-' && flag('text-file') === '-') throw new Error('Only one input can consume standard input'); input.content = await textFile(flag('text-file')!); }
      setBody(input);
    } else if (action === 'upload') { endpoint = `${root}/upload`; method = 'POST'; await multipart(); }
    else if (action === 'batch') { endpoint = `${root}/batch`; method = 'POST'; }
    else if (action === 'spaces') { endpoint = `${root}/spaces?${new URLSearchParams({ scope: flag('scope') ?? 'local' })}`; method = bodyFile ? 'POST' : 'GET'; }
    else if (action === 'export') { endpoint = `${root}/export?${new URLSearchParams({ ids: required('ids') })}`; required('output'); }
    else if (action === 'import' || action === 'save') {
      endpoint = `/api/projects/${encodeURIComponent(required('project'))}/asset-library/${action}`; method = 'POST'; const input = bodyObject();
      if (action === 'import') { if (args[2] && !args[2].startsWith('--')) input.assetId = args[2]; if (flag('path')) input.path = flag('path'); if (flag('version')) input.versionId = flag('version'); }
      else { if (flag('filename')) input.filename = flag('filename'); if (flag('name')) input.name = flag('name'); }
      setBody(input);
    } else if (['get', 'patch', 'versions', 'content', 'uses', 'metadata', 'analysis', 'prompt'].includes(action ?? '')) {
      const id = encodeURIComponent(positionalId());
      endpoint = `${root}/${id}${action === 'get' || action === 'patch' ? '' : `/${action === 'metadata' ? 'metadata.yaml' : action}`}`;
      if (action === 'patch') method = 'PATCH';
      else if (action === 'versions' && flag('file')) { method = 'POST'; await multipart(); }
      else if (['versions', 'uses', 'analysis', 'prompt'].includes(action!) && bodyFile) method = 'POST';
      if (action === 'content' && flag('version')) endpoint += `?${new URLSearchParams({ version: flag('version')! })}`;
    } else throw new Error('Invalid assets action; use assets --help');
  } else if (args[0] === 'apps') {
    const action = args[1];
    if (action === 'list') endpoint = '/api/apps';
    else if (action === 'call') {
      const appId = args[2], actionId = args[3];
      if (!appId || !actionId) throw new Error('apps call APP_ID ACTION_ID [--instance ID] [--body-file INPUT_JSON]');
      const instance = flag('instance');
      endpoint = instance
        ? `/api/apps/${encodeURIComponent(appId)}/instances/${encodeURIComponent(instance)}/actions/${encodeURIComponent(actionId)}`
        : `/api/apps/${encodeURIComponent(appId)}/actions/${encodeURIComponent(actionId)}`;
      method = 'POST';
      if (body === undefined) body = JSON.stringify({ input: {} });
      else setBody({ input: bodyObject() });
    }
    else if (action === 'state') {
      const appId = args[2];
      if (!appId) throw new Error('apps state APP_ID --instance ID');
      endpoint = `/api/apps/${encodeURIComponent(appId)}/instances/${encodeURIComponent(required('instance'))}/state`;
    }
    else if (action === 'bindings') {
      endpoint = `/api/apps/canvas/instances/${encodeURIComponent(required('project'))}/bindings${flag('scope') === 'all' ? '?all=1' : ''}`;
    }
    else if (action === 'entitlements') endpoint = `/api/apps/entitlements${flag('id') ? `?appId=${encodeURIComponent(flag('id')!)}` : ''}`;
    else if (action === 'audit') endpoint = '/api/apps/audit';
    else throw new Error('Expected apps list|call|state|bindings|entitlements|audit');
  } else if (args[0] === 'request') {
    method = (args[1] ?? '').toUpperCase(); endpoint = args[2] ?? '';
    if (!['GET', 'POST', 'PATCH', 'PUT', 'DELETE'].includes(method) || !endpoint.startsWith('/api/')) throw new Error('request METHOD /api/path [--body-file JSON_PATH|-]');
    if (promptFile) setBody({ ...bodyObject(), prompt: await textFile(promptFile) });
  } else throw new Error('Expected request, assets or browser');
  if (promptFile && args[0] !== 'request') throw new Error('--prompt-file is supported by request commands');
  if (method === 'GET' && body !== undefined) throw new Error('GET commands do not accept a request body');
  if (typeof body === 'string' && Buffer.byteLength(body) > MAX_JSON_BYTES) throw new Error('JSON request exceeds 64 MB');
  const url = new URL(endpoint, origin);
  if (url.origin !== origin.origin || !url.pathname.startsWith('/api/')) throw new Error('Request must remain under the configured server API');
  return { url, init: { method, headers, redirect: 'error', ...(body !== undefined ? { body } : {}) }, ...(flag('output') ? { output: path.resolve(flag('output')!) } : {}) };
}

/** Output files are explicit, binary-safe and create-only. Partial downloads are retained. */
export async function runHttpCli(args: string[]): Promise<void> {
  if (args.includes('--help')) { process.stdout.write(HELP + '\n'); return; }
  const command = await buildHttpCliRequest(args), response = await fetch(command.url, command.init);
  if (!response.ok) { process.stdout.write(await response.text() + '\n'); process.exitCode = 1; return; }
  if (!command.output) {
    const type = response.headers.get('Content-Type') ?? '';
    if (type && !/^(text\/|application\/(?:json|yaml|x-yaml|xml))/.test(type)) throw new Error('Binary response requires --output FILE');
    process.stdout.write(await response.text() + '\n'); return;
  }
  const handle = await open(command.output, 'wx', 0o600).catch(async error => { await response.body?.cancel().catch(() => undefined); throw error; }); let bytes = 0;
  const reader = response.body?.getReader();
  try {
    if (reader) for (;;) {
      const chunk = await reader.read(); if (chunk.done) break;
      let offset = 0;
      while (offset < chunk.value.length) { const written = await handle.write(chunk.value, offset, chunk.value.length - offset); if (!written.bytesWritten) throw new Error('Output write made no progress'); offset += written.bytesWritten; bytes += written.bytesWritten; }
    }
  } catch { await reader?.cancel().catch(() => undefined); throw new Error(`Download interrupted; partial output retained at ${command.output}`); }
  finally { await handle.close(); }
  process.stdout.write(JSON.stringify({ ok: true, file: command.output, bytes, contentType: response.headers.get('Content-Type') }) + '\n');
}
