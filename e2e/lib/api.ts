import type { ToolsDevRuntime } from './tools-dev/runtime.js';
export async function api<T>(runtime: Pick<ToolsDevRuntime, 'serverUrl'>, route: string, body?: unknown, method = body === undefined ? 'GET' : 'POST'): Promise<T> {
  const response = await fetch(`${runtime.serverUrl}${route}`, { method, headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  if (!response.ok) throw new Error(`${method} ${route}: HTTP ${response.status}: ${(await response.text()).slice(0, 1000)}`);
  return response.json() as Promise<T>;
}
export async function createProject(runtime: ToolsDevRuntime, name: string): Promise<string> {
  const { project } = await api<{ project: { id: string } }>(runtime, '/api/projects', { name });
  return project.id;
}
export async function writeText(runtime: ToolsDevRuntime, projectId: string, name: string, content: string) {
  return api<{ file: { name: string }; version?: { id: string } }>(runtime, `/api/projects/${projectId}/files`, { name, content, versionSource: 'manual' });
}
export async function writePresentation(runtime: ToolsDevRuntime, projectId: string, name: string) {
  return api<{ file: { name: string; artifactManifest: { kind: string; renderer: string } } }>(runtime, `/api/projects/${projectId}/files`, {
    name, content: deckDocument, artifactManifest: { kind: 'deck', renderer: 'deck-html', exports: ['html', 'pdf'], status: 'complete', title: 'Workspace presentation' },
  });
}
export async function projectText(runtime: ToolsDevRuntime, projectId: string, name: string) {
  const response = await fetch(`${runtime.serverUrl}/api/projects/${projectId}/files/${encodeURIComponent(name)}`);
  if (!response.ok) throw new Error(`Read ${name}: HTTP ${response.status}`);
  return response.text();
}
export async function setTabs(runtime: ToolsDevRuntime, projectId: string, tabs: string[], active = '__design_files__') {
  return api(runtime, `/api/projects/${projectId}/tabs`, { tabs, active, browserTabs: [] }, 'PUT');
}
export const webDocument = (title = 'Canvas research') => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>body{margin:0;background:#f1f4f8;color:#203245;font:18px system-ui}main{max-width:840px;margin:60px auto;padding:48px;background:white;border-radius:24px}h1{font-size:52px;line-height:1.05;letter-spacing:-2px}p{line-height:1.65}.tag{font-size:12px;letter-spacing:2px;color:#227d6b}button{background:#203245;color:white;border:0;border-radius:10px;padding:14px 20px}</style></head><body><main><p class="tag">CANVAS WORKSPACE / RESEARCH NOTE</p><h1 id="headline">${title}</h1><p>Independent creative work: explore references, connect project assets, edit the original document, and keep each revision beside the canvas.</p><p>This local fixture has no account, network library or chat dependency. It exercises the original preview and source surfaces with a real project file.</p><button id="interactive-example">Try interaction</button></main><script>const button=document.querySelector('#interactive-example');button.addEventListener('click',()=>{button.textContent='Interaction verified'});document.documentElement.dataset.fixtureReady='true';</script></body></html>`;
export const deckDocument = `<!doctype html><html><head><meta charset="utf-8"><title>Workspace presentation</title><style>html,body{margin:0;background:#122839;color:white;font:24px system-ui}.slide{width:1280px;height:720px;box-sizing:border-box;padding:90px;position:absolute;inset:0;background:#122839;color:white}.slide h1{font-size:80px;max-width:900px;letter-spacing:-3px}.slide p{font-size:28px;max-width:850px;line-height:1.5}.slide[data-slide="2"]{background:#e8eee8;color:#203c36}</style></head><body><deck-stage width="1280" height="720"><section class="slide" data-slide="1"><p>CANVAS WORKSPACE</p><h1>From references to delivery.</h1><p>A local, independent creative workspace with original canvas, project files and native browser capture.</p></section><section class="slide" data-slide="2"><p>PROJECT-BOUND BY DESIGN</p><h1>Keep assets beside the work.</h1><p>Browse, collect, revise and export without an account platform or chat surface.</p></section></deck-stage></body></html>`;
