import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { canvasArtifactTargetDigest, prepareCanvasArtifactWorkspace, publishCanvasArtifactCandidate } from '../src/canvas/artifact-workspace.js';
import { CanvasStateService } from '../src/canvas/state.js';

describe('isolated canvas candidate files', () => {
  let root: string, project: string;
  const html = '<html><body><section>candidate</section></body></html>';
  beforeEach(() => { root = mkdtempSync(path.join(os.tmpdir(), 'da-candidate-')); project = path.join(root, 'project'); mkdirSync(project); writeFileSync(path.join(project, 'original.html'), html); });
  afterEach(() => rmSync(root, { recursive: true, force: true }));
  const prepare = () => prepareCanvasArtifactWorkspace({ runtimeDataDir: root, projectRoot: project, runId: 'run-1', outputPath: 'candidate.html', references: ['original.html'] });
  it('binds the published result on the backend and replays after reloading without a browser', async () => {
    const node = { id: 'deck', kind: 'page', text: 'original', projectFilePath: 'original.html', generation: { requestId: 'request-1' } };
    mkdirSync(path.join(project, '整理'));
    writeFileSync(path.join(project, '整理/canvas-state.json'), JSON.stringify({ version: 1, projectId: 'p', state: { workbenchBasicNodes: [node] } }));
    const workspace = prepareCanvasArtifactWorkspace({ runtimeDataDir: root, projectRoot: project, runId: 'run', outputPath: 'candidate.html', references: ['original.html'], target: { nodeId: node.id, requestId: 'request-1', digest: canvasArtifactTargetDigest(node) } });
    writeFileSync(path.join(workspace.cwd, 'candidate.html'), html);
    const service = new CanvasStateService(() => project);
    const applied = await service.applyArtifactCandidate('p', workspace);
    expect(applied.state.workbenchBasicNodes).toMatchObject([{ id: 'deck', projectFilePath: 'candidate.html', generation: { appliedRequestId: 'request-1', status: 'succeeded' } }]);
    expect(await new CanvasStateService(() => project).applyArtifactCandidate('p', workspace)).toEqual(applied);
    expect(readFileSync(path.join(project, 'original.html'), 'utf8')).toBe(html);
  });
  it('writes only the isolated copy and publishes a separate candidate idempotently', () => {
    const workspace = prepare();
    writeFileSync(path.join(workspace.cwd, 'original.html'), 'executor changed its copy');
    expect(readFileSync(path.join(project, 'original.html'), 'utf8')).toBe(html);
    writeFileSync(path.join(workspace.cwd, 'candidate.html'), html);
    expect(publishCanvasArtifactCandidate(workspace)).toBe('candidate.html');
    expect(publishCanvasArtifactCandidate(workspace)).toBe('candidate.html');
    expect(readFileSync(path.join(project, 'original.html'), 'utf8')).toBe(html);
  });
  it('preserves manual changes and retains the candidate on a version conflict', () => {
    const workspace = prepare(); writeFileSync(path.join(workspace.cwd, 'candidate.html'), html);
    writeFileSync(path.join(project, 'original.html'), 'manual edit');
    expect(() => publishCanvasArtifactCandidate(workspace)).toThrow('已修改');
    expect(readFileSync(path.join(project, 'original.html'), 'utf8')).toBe('manual edit');
    expect(readFileSync(path.join(project, 'candidate.html'), 'utf8')).toBe(html);
    expect(readFileSync(path.join(workspace.cwd, 'candidate.html'), 'utf8')).toBe(html);
  });
  it('rejects reused attempts, invalid output and preexisting files', () => {
    const workspace = prepare(); expect(prepare).toThrow('已存在');
    writeFileSync(path.join(workspace.cwd, 'candidate.html'), 'not HTML');
    expect(() => publishCanvasArtifactCandidate(workspace)).toThrow('完整 HTML');
    writeFileSync(path.join(workspace.cwd, 'candidate.html'), html);
    writeFileSync(path.join(project, 'candidate.html'), 'another writer');
    expect(() => publishCanvasArtifactCandidate(workspace)).toThrow('拒绝覆盖');
  });
  it('rejects traversal, missing references and symlinks before preparing work', () => {
    symlinkSync(path.join(project, 'original.html'), path.join(project, 'link.html'));
    for (const reference of ['../original.html', 'missing.html', 'link.html']) expect(() => prepareCanvasArtifactWorkspace({ runtimeDataDir: root, projectRoot: project, runId: reference, outputPath: 'candidate.html', references: [reference] })).toThrow();
  });
  it.each(['edited', 'deleted', 'superseded'])('retains output without applying it when the target is %s', change => {
    const node = { id: 'deck', kind: 'page', text: 'original', generation: { requestId: 'request-1' } };
    const workspace = prepareCanvasArtifactWorkspace({ runtimeDataDir: root, projectRoot: project, runId: change, outputPath: 'candidate.html', references: [], target: { nodeId: node.id, requestId: 'request-1', digest: canvasArtifactTargetDigest(node) } });
    mkdirSync(path.join(project, '整理'));
    if (change === 'edited') node.text = 'manual edit';
    if (change === 'superseded') node.generation.requestId = 'request-2';
    writeFileSync(path.join(project, '整理/canvas-state.json'), JSON.stringify({ state: { workbenchBasicNodes: change === 'deleted' ? [] : [node] } }));
    writeFileSync(path.join(workspace.cwd, 'candidate.html'), html);
    expect(() => publishCanvasArtifactCandidate(workspace)).toThrow('目标卡片已修改或删除');
    expect(readFileSync(path.join(project, 'candidate.html'), 'utf8')).toBe(html);
    expect(readFileSync(path.join(workspace.cwd, 'candidate.html'), 'utf8')).toBe(html);
  });
});
