import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProjectRegistry } from '../src/storage/project-registry.js';
import { CanvasStateService } from '../src/canvas/state.js';
import { AgentTasks, type TaskRequest } from '../src/services-tasks.js';
import { createHttpAgentAdapter } from '../src/http-adapters.js';
import { registerTaskRoutes } from '../src/routes/tasks.js';
import { ProjectLedger } from '../src/project-ledger/service.js';
import { resolveTaskSkills } from '../src/task-skills.js';
import { fileURLToPath } from 'node:url';
import type { Express, RequestHandler } from 'express';
const roots: string[] = [];
afterEach(() => { vi.unstubAllGlobals(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'task-context-')); roots.push(root);
  const registry = createProjectRegistry(root), project = registry.create({ name: 'Context' });
  const canvas = new CanvasStateService(id => registry.resolveProjectRoot(id));
  const skills = path.join(root, 'installed-skills'); mkdirSync(path.join(skills, 'page-recreation'), { recursive: true });
  writeFileSync(path.join(skills, 'page-recreation/SKILL.md'), '# Complete Page Recreation\nPreserve responsive layout and verify evidence.');
  writeFileSync(path.join(skills, 'page-recreation/fidelity.md'), 'Compare actual motion, not just screenshots.');
  const projectRoot = registry.resolveProjectRoot(project.id)!;
  mkdirSync(path.join(projectRoot, 'snap')); writeFileSync(path.join(projectRoot, 'snap/page.html'), '<html>captured</html>');
  writeFileSync(path.join(projectRoot, 'private.txt'), 'not authorized');
  return { root, registry, project, canvas, skills, projectRoot };
}
const executionContext = { skillIds: ['page-recreation'], sessionMode: 'design', visiblePrompt: 'Extract', context: { skillIds: ['page-recreation'], workspaceItems: [{ id: 'tab', kind: 'browser', label: 'Example', title: 'Example', url: 'https://example.com/', tabId: 'tab' }] } };
const request = () => ({ requestId: 'extract', prompt: 'Extract webpage', executionContext, inputPaths: ['snap/page.html'] }) as TaskRequest;
describe('durable portable browser task context', () => {
  it('HTTP task route retains context on receipt/list/replay and reports conflicting requests as 409', async () => {
    const f = fixture(); const execute = vi.fn(() => new Promise<never>(() => {}));
    const tasks = new AgentTasks(f.registry, f.canvas, { execute }, f.skills);
    const handlers = new Map<string, RequestHandler>();
    const register = (method: string) => (route: string, ...chain: RequestHandler[]) => { handlers.set(`${method} ${route}`, chain[chain.length - 1]!); };
    const app = { post: register('POST'), get: register('GET'), delete: register('DELETE') } as unknown as Express;
    registerTaskRoutes(app, { tasks, registry: f.registry, canvas: f.canvas, ledger: new ProjectLedger(f.root), authorize: (_req, _res, next) => next() });
    const invoke = async (method: string, body?: unknown) => {
      let status = 200; let payload: any;
      const response = { status(value: number) { status = value; return this; }, json(value: unknown) { payload = value; return this; } };
      await handlers.get(`${method} /api/projects/:id/agent/tasks`)!({ params: { id: f.project.id }, body } as unknown as Parameters<RequestHandler>[0], response as unknown as Parameters<RequestHandler>[1], () => {});
      return { status, payload };
    };
    const first = await invoke('POST', JSON.parse(JSON.stringify(request())));
    expect(first.status).toBe(202);
    expect((await invoke('GET')).payload.tasks[0].request.executionContext).toEqual(executionContext);
    const reordered = { inputPaths: ['snap/page.html'], executionContext, prompt: 'Extract webpage', requestId: 'extract' };
    expect((await invoke('POST', reordered)).payload.task.id).toBe(first.payload.task.id);
    expect(await invoke('POST', { ...request(), executionContext: { ...executionContext, visiblePrompt: 'changed' } })).toMatchObject({ status: 409, payload: { error: { code: 'TASK_REQUEST_CONFLICT' } } });
    expect(await invoke('POST', { ...request(), executionContext: { cookies: 'secret' } })).toMatchObject({ status: 400 });
    expect(execute).toHaveBeenCalledOnce(); await tasks.cancel(f.project.id, first.payload.task.id);
  });
  it('loads the independently installed adapted skill, not a placeholder or absent CLI invocation', () => {
    const skills = resolveTaskSkills(fileURLToPath(new URL('../../../resources/skills/', import.meta.url)), ['page-recreation']);
    expect(skills[0]?.instructions).toContain('Standalone execution contract');
    expect(skills[0]?.instructions).toContain('CanvasTaskDelivery');
    expect(skills[0]?.resources.find(resource => resource.path === 'fidelity.md')?.content).toContain('Acceptance is itemized');
    expect(skills[0]?.instructions).not.toMatch(/node <skill-root>|bezier decision predict|npm install/);
  });
  it('persists context, replays without duplicate execution and conflicts on changed metadata', async () => {
    const f = fixture(); const execute = vi.fn(() => new Promise<never>(() => {}));
    const tasks = new AgentTasks(f.registry, f.canvas, { execute }, f.skills);
    const task = await tasks.submit(f.project.id, request());
    expect(tasks.list(f.project.id)[0]?.request).toMatchObject({ executionContext });
    const saved = JSON.parse(readFileSync(path.join(f.root, 'agent-tasks', `${task.id}.json`), 'utf8'));
    expect(saved.requestDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(saved.workspace.inputs[0].digest).toMatch(/^[a-f0-9]{64}$/);
    writeFileSync(path.join(f.projectRoot, 'snap/page.html'), 'changed after acceptance');
    expect((await tasks.submit(f.project.id, request())).id).toBe(task.id);
    await expect(tasks.submit(f.project.id, { ...request(), executionContext: { ...executionContext, visiblePrompt: 'Different' } } as TaskRequest)).rejects.toMatchObject({ status: 409 });
    expect(execute).toHaveBeenCalledOnce(); await tasks.cancel(f.project.id, task.id);
  });
  it('HTTP adapter receives metadata, only pinned authorized bytes, actual skill instructions and preserved ephemeral execution', async () => {
    const f = fixture(); let received!: Record<string, any>; let captured!: () => void;
    const called = new Promise<void>(resolve => { captured = resolve; });
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init: RequestInit) => { received = JSON.parse(String(init.body)); captured(); return new Response(JSON.stringify({ content: 'done' }), { status: 200 }); }));
    const tasks = new AgentTasks(f.registry, f.canvas, createHttpAgentAdapter('https://adapter.invalid'), f.skills);
    const task = await tasks.submit(f.project.id, request(), { systemPrompt: 'Trusted runtime instructions', skillIds: ['workflow-skill'] });
    writeFileSync(path.join(f.projectRoot, 'snap/page.html'), 'changed project source after acceptance');
    await called;
    expect(received.executionContext).toEqual(executionContext);
    expect(received.request.executionContext).toEqual(executionContext);
    expect(received.skillIds).toEqual(['workflow-skill', 'page-recreation']);
    expect(received.systemPrompt).toContain('Trusted runtime instructions');
    expect(received.systemPrompt).toContain('Preserve responsive layout');
    expect(received.installedSkills[0]).toMatchObject({ id: 'page-recreation', instructions: expect.stringContaining('Complete Page Recreation'), digest: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(received.installedSkills[0].resources[0].content).toContain('Compare actual motion');
    expect(received.inputFiles).toHaveLength(1);
    expect(Buffer.from(received.inputFiles[0].contentBase64, 'base64').toString()).toBe('<html>captured</html>');
    const persisted = readFileSync(path.join(f.root, 'agent-tasks', `${task.id}.json`), 'utf8');
    expect(persisted).not.toContain('Trusted runtime instructions');
    await tasks.cancel(f.project.id, task.id);
  });
  it.each([
    { executionContext: { skillIds: ['../../secret'] } },
    { executionContext: { context: { workspaceItems: [{ id: 'x', kind: 'browser', label: '', title: '', url: 'javascript:alert(1)' }] } } },
    { executionContext: { context: { workspaceItems: [{ id: 'x', kind: 'browser', label: '', title: '', url: 'https://user:secret@example.com' }] } } },
    { executionContext: { cookies: 'secret' } },
    { executionContext: { visiblePrompt: 'x'.repeat(9000) } },
    { inputPaths: ['../secret'] }, { inputPaths: ['.env'] }, { inputPaths: ['snap/page.html?cookie=secret'] },
  ])('rejects unsafe/unbounded metadata before execution: %j', async extra => {
    const f = fixture(); const execute = vi.fn(); const tasks = new AgentTasks(f.registry, f.canvas, { execute }, f.skills);
    await expect(tasks.submit(f.project.id, { ...request(), ...extra } as TaskRequest)).rejects.toThrow(); expect(execute).not.toHaveBeenCalled();
  });
  it('fails honestly for missing installed resources or symlinked skill content', async () => {
    const f = fixture(); const execute = vi.fn();
    await expect(new AgentTasks(f.registry, f.canvas, { execute }).submit(f.project.id, request())).rejects.toMatchObject({ code: 'SKILL_RESOURCE_UNAVAILABLE' });
    symlinkSync(path.join(f.projectRoot, 'private.txt'), path.join(f.skills, 'page-recreation/leak.md'));
    await expect(new AgentTasks(f.registry, f.canvas, { execute }, f.skills).submit(f.project.id, request())).rejects.toMatchObject({ code: 'SKILL_RESOURCE_UNAVAILABLE' });
    expect(execute).not.toHaveBeenCalled();
  });
});
