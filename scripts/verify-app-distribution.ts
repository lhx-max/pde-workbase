import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFile, writeFile, mkdir, lstat } from 'node:fs/promises';
import path from 'node:path';

const consumer = process.argv[2];
if (!consumer || !path.isAbsolute(consumer)) throw new Error('Pass an absolute isolated consumer directory');
const root = process.env.CANVAS_SERVER_URL;
if (!root) throw new Error('Set CANVAS_SERVER_URL to the dedicated local test service');
const command = path.join(consumer, 'node_modules/.bin/canvas-cli');
const evidence = path.resolve('docs/verification/npm-distribution');
await mkdir(evidence, { recursive: true });
const cli = (args: string[], succeeds = true) => {
  const result = spawnSync(command, args, { cwd: consumer, env: process.env, encoding: 'utf8' });
  assert.equal(result.status === 0, succeeds, `${args.join(' ')}: ${result.stdout} ${result.stderr}`);
  return result.stdout.trim();
};
const json = (args: string[], succeeds = true) => JSON.parse(cli(args, succeeds));
const inputFile = async (name: string, value: unknown) => { const file = path.join(consumer, name); await writeFile(file, JSON.stringify(value)); return file; };
const packages: Record<string, string> = {};
const mode = process.env.DISTRIBUTION_VERIFICATION_MODE === 'registry' ? 'registry' : 'local';
const lock = JSON.parse(await readFile(path.join(consumer, 'package-lock.json'), 'utf8'));
for (const name of ['@ks-designai/canvas-surface', '@ks-designai/doc-surface', '@ks-designai/canvas-cli']) {
  const directory = path.join(consumer, 'node_modules', name);
  assert(!(await lstat(directory)).isSymbolicLink(), 'Must install real package files, not source symlinks');
  const manifest = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
  assert(!JSON.stringify(manifest.dependencies ?? {}).match(/workspace:|file:|\/Users\//));
  packages[name] = manifest.version;
  if (mode === 'registry') assert(lock.packages[`node_modules/${name}`].resolved.startsWith('https://npm.corp.kuaishou.com/'), 'Package must resolve from the company registry');
}
assert.equal(cli(['--version']), packages['@ks-designai/canvas-cli']);
assert(cli(['--help']).includes('CANVAS_SERVER_URL'));
const listing = json(['apps', 'list']); assert(JSON.stringify(listing).includes('canvas'));
const detail = json(['request', 'GET', '/api/apps/canvas']); assert(detail.data.requestSchema);
const instanceId = `npm-check-${Date.now()}`;
const create = await inputFile('create.json', { instanceId, name: 'npm distribution verification' });
json(['apps', 'call', 'canvas', 'canvas.create', '--body-file', create]);
const before = json(['apps', 'state', 'canvas', '--instance', instanceId]);
const nodeId = 'npm-installed-cli-card';
const operations = await inputFile('operations.json', { operationId: `npm-op-${Date.now()}`, baseRevision: before.data.revision,
  operations: [{ type: 'node.create', node: { id: nodeId, kind: 'video', title: 'Created by installed CLI', x: 120, y: 100, width: 360, height: 240 } }] });
const writeArgs = ['request', 'POST', `/api/apps/canvas/instances/${instanceId}/operations`, '--body-file', operations];
const receipt = json(writeArgs), replay = json(writeArgs);
assert.deepEqual(replay.data.receipt, receipt.data.receipt, 'Stable operation ID should replay the original receipt');
assert.equal(replay.data.replayed, true);
const after = json(['apps', 'state', 'canvas', '--instance', instanceId]);
assert(after.data.revision > before.data.revision);
assert.equal(after.data.state.workbenchBasicNodes.filter((node: { id: string }) => node.id === nodeId).length, 1);
const stale = await inputFile('stale.json', { operationId: `npm-stale-${Date.now()}`, baseRevision: before.data.revision,
  operations: [{ type: 'node.move', nodeId, x: 999, y: 999 }] });
const conflict = json(['request', 'POST', `/api/apps/canvas/instances/${instanceId}/operations`, '--body-file', stale], false);
assert(JSON.stringify(conflict).includes('CONFLICT'));
const unknown = spawnSync(command, ['apps', 'state', 'canvas', '--instance', 'absent-npm-instance'], { cwd: consumer, encoding: 'utf8', env: process.env });
assert.notEqual(unknown.status, 0);
const docServer = process.env.DOC_SERVER_URL;
let docId: string | undefined;
if (docServer) {
  const registration = await inputFile('doc-register.json', { appId: 'doc', name: '文档', endpoint: `${docServer}/api/apps/doc` });
  json(['request', 'POST', '/api/apps/register', '--body-file', registration]);
  assert(JSON.stringify(json(['apps', 'list'])).includes('doc'));
  const createDoc = await inputFile('doc-create.json', { name: 'npm CLI document verification', content: '# Installed CLI document' });
  const created = json(['apps', 'call', 'doc', 'doc.create', '--body-file', createDoc]);
  docId = created.data.result.instanceId;
  assert(docId);
  const readArgs = ['apps', 'call', 'doc', 'doc.read', '--instance', docId];
  const initial = json(readArgs).data.result;
  assert.equal(initial.content, '# Installed CLI document');
  const writeDoc = await inputFile('doc-write.json', { content: '# Installed CLI document\n\nSaved through the canvas App gateway.', baseContent: initial.content, expectedRevision: initial.revision });
  json(['apps', 'call', 'doc', 'doc.write', '--instance', docId, '--body-file', writeDoc]);
  assert(json(readArgs).data.result.content.includes('Saved through the canvas App gateway.'));
}
await writeFile(path.join(consumer, 'index.html'), '<div id="root"></div><script type="module" src="/main.tsx"></script>');
await writeFile(path.join(consumer, 'main.tsx'), `import React from 'react';
import { createRoot } from 'react-dom/client';
import { CanvasWorkbenchSurface } from '@ks-designai/canvas-surface';
import '@ks-designai/canvas-surface/styles.css';
import { DocumentEditorPane } from '@ks-designai/doc-surface';
import '@ks-designai/doc-surface/styles.css';
const host = {renderPopover:({trigger})=>trigger,renderHoverCard:({trigger})=>trigger,renderDialog:()=>null,renderMenu:({trigger})=>trigger,renderTabs:()=>null};
const api = {readSnapshot:async()=>({content:'# Installed document package',revision:'test-1'}),writeSnapshot:async()=>{throw new Error('Read-only package fixture')}};
const meta = {id:'package-fixture',name:'Installed document package',path:'fixture.md',size:28,updatedAt:'2026-10-21T00:00:00Z'};
createRoot(document.getElementById('root')).render(<main><h1>Installed npm packages</h1><div style={{height:420}}><CanvasWorkbenchSurface projectId="${instanceId}" uiHost={host} transport={{baseUrl:'/canvas'}} businessModules={[]} /></div><div className="doc-surface-root"><DocumentEditorPane document={meta} api={api}/></div></main>);
`);
// Use only the consumer's installed build tool and dependencies.
execFileSync(path.join(consumer, 'node_modules/.bin/vite'), ['build'], { cwd: consumer, stdio: 'inherit' });
const report = { passed: true, mode, consumer, packages, instanceId, nodeId, checks: [
  'No workspace/local-source runtime dependencies or package symlinks', 'Installed CLI version/help and live app discovery',
  'Create/read/write/readback against real local canvas service', 'Stable operation replay and stale-write rejection',
  'Missing instance exits nonzero', 'Both installed UI packages compile in one clean consumer',
  ...(docId ? ['Doc discovery/create/read/write/readback through the same installed CLI and App gateway'] : []),
], docId, beforeRevision: before.data.revision, afterRevision: after.data.revision, conflict };
await writeFile(path.join(evidence, `${mode}-install.json`), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
