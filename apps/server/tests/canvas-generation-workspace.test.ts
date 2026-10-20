import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prepareCanvasGenerationWorkspace } from '../src/canvas/generation-workspace.js';
import { CanvasStateService } from '../src/canvas/state.js';

describe('shared canvas generation working copies', () => {
  let root: string; let project: string; let home: string;
  const original = '<html><body>original</body></html>';
  const candidate = '<html><body>candidate</body></html>';
  beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), 'da-canvas-execution-'));
    project = path.join(root, 'project'); home = path.join(root, 'home');
    mkdirSync(project); mkdirSync(home);
    writeFileSync(path.join(project, 'original.html'), original);
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));
  const page = () => ({ id: 'target', kind: 'page', projectFilePath: 'original.html', generation: { requestId: 'request' } });
  const input = () => ({ runtimeDataDir: root, projectRoot: project, projectId: 'project', runId: 'run',
    nodes: [page()], references: [], requestedReferenceCount: 0 });

  it.each(['presentation', 'html'] as const)('stages %s through the same publication contract', async format => {
    const prepared = prepareCanvasGenerationWorkspace({ ...input(), artifact: { nodeId: 'target', requestId: 'request', format, outputPath: 'candidate.html' } });
    expect(prepared.artifact).not.toBeNull();
    expect(readFileSync(path.join(prepared.workspace.cwd, 'original.html'), 'utf8')).toBe(original);
    writeFileSync(path.join(prepared.workspace.cwd, 'candidate.html'), candidate);
    mkdirSync(path.join(project, '整理'));
    writeFileSync(path.join(project, '整理/canvas-state.json'), JSON.stringify({ state: { workbenchBasicNodes: [page()] } }));
    const state = new CanvasStateService(() => project);
    const applied = await state.applyArtifactCandidate('project', prepared.artifact!);
    expect(applied.state.workbenchBasicNodes).toMatchObject([{ projectFilePath: 'candidate.html', generation: { appliedRequestId: 'request' } }]);
    expect(readFileSync(path.join(project, 'original.html'), 'utf8')).toBe(original);
    expect(await state.applyArtifactCandidate('project', prepared.artifact!)).toEqual(applied);
  });

  it.each(['text', 'storyboard'] as const)('stages %s without pretending it is an HTML artifact', outputKind => {
    const prepared = prepareCanvasGenerationWorkspace({ ...input(), nodes: [{ ...page(), kind: outputKind }],
      text: { nodeId: 'target', requestId: 'request', outputKind } });
    expect(prepared.artifact).toBeNull();
    writeFileSync(path.join(prepared.workspace.cwd, 'original.html'), 'copy changed');
    expect(readFileSync(path.join(project, 'original.html'), 'utf8')).toBe(original);
    expect(JSON.parse(readFileSync(path.join(path.dirname(prepared.workspace.cwd), 'manifest.json'), 'utf8'))).toMatchObject({ kind: 'text' });
  });

  it('rejects disappeared targets, partial references and missing projects before execution', () => {
    const base = { ...input(), artifact: { nodeId: 'target', requestId: 'request', format: 'html' as const, outputPath: 'candidate.html' } };
    expect(() => prepareCanvasGenerationWorkspace({ ...base, nodes: [] })).toThrow('目标卡片');
    expect(() => prepareCanvasGenerationWorkspace({ ...base, requestedReferenceCount: 1 })).toThrow('参考文件');
    expect(() => prepareCanvasGenerationWorkspace({ ...base, projectId: null })).toThrow('项目工作目录');
  });

  // Host process containment is delegated to the external execution adapter.
});
