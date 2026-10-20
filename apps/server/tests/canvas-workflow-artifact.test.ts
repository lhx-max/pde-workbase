import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  CanvasStateService,
  selectPrimaryTaskCanvasArtifact,
} from '../src/canvas/state.js';

describe('workflow canvas artifact materialization', () => {
  let root = '';
  let service: CanvasStateService;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'da-workflow-artifact-'));
    service = new CanvasStateService(projectId => projectId === 'project-1' ? root : null);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('delivers storyboard in the backend once and preserves subsequent edits after restart', async () => {
    await service.patch('project-1', { workbenchBasicNodes: [{ id: 'story', kind: 'storyboard', generation: { requestId: 'r1', status: 'running', baseStoryboard: 'null' } }] });
    const input = { nodeId: 'story', requestId: 'r1', runId: 'run-1', content: JSON.stringify({ shots: [{ description: '人物走进车站', characters: ['林夏'], scene: '车站' }] }) };
    const first = await service.applyStoryboardCandidate('project-1', input);
    const nodes = first.state.workbenchBasicNodes as Array<Record<string, unknown>>;
    expect(nodes[0]).toMatchObject({ storyboardEntryMode: 'edit', storyboard: { shots: [{ description: '人物走进车站' }], assets: [{ name: '林夏' }, { name: '车站' }] } });
    expect((await new CanvasStateService(() => root).applyStoryboardCandidate('project-1', input)).revision).toBe(first.revision);
    await service.patch('project-1', { workbenchBasicNodes: nodes.map(node => ({ ...node, storyboard: { shots: [{ description: '人工修改' }] } })) });
    expect((await service.applyStoryboardCandidate('project-1', input)).state.workbenchBasicNodes).toMatchObject([{ storyboard: { shots: [{ description: '人工修改' }] } }]);
    await service.patch('project-1', { workbenchBasicNodes: [] });
    await expect(service.applyStoryboardCandidate('project-1', input)).rejects.toMatchObject({ status: 404 });
  });

  it('rejects invalid storyboard, changed baseline and a newer generation without overwriting', async () => {
    const node = { id: 'story', kind: 'storyboard', generation: { requestId: 'r1', status: 'running', baseStoryboard: 'null' } };
    await service.patch('project-1', { workbenchBasicNodes: [node] });
    const input = { nodeId: 'story', requestId: 'r1', runId: 'run-1', content: '{"shots":[]}' };
    await expect(service.applyStoryboardCandidate('project-1', input)).rejects.toThrow('没有可用镜头');
    input.content = '{"shots":[{"description":"生成"}]}';
    await service.patch('project-1', { workbenchBasicNodes: [{ ...node, storyboard: { shots: [{ description: '编辑中' }] } }] });
    await expect(service.applyStoryboardCandidate('project-1', input)).rejects.toMatchObject({ status: 409 });
    await service.patch('project-1', { workbenchBasicNodes: [{ ...node, generation: { ...node.generation, requestId: 'r2' } }] });
    await expect(service.applyStoryboardCandidate('project-1', input)).rejects.toMatchObject({ status: 409 });
  });

  it('links a saved text candidate in the backend without adopting or rewriting the original', async () => {
    await service.patch('project-1', { workbenchBasicNodes: [{ id: 'text-1', kind: 'text', text: '原文', generation: { requestId: 'r1', status: 'running' } }] });
    const input = { nodeId: 'text-1', requestId: 'r1', runId: 'run-1', content: '候选' };
    const first = await service.linkTextCandidate('project-1', input);
    const recovered = await new CanvasStateService(() => root).linkTextCandidate('project-1', input);
    expect(recovered.revision).toBe(first.revision);
    expect(recovered.state.workbenchBasicNodes).toEqual([expect.objectContaining({ text: '原文', generation: expect.objectContaining({ candidateText: '候选', status: 'succeeded' }) })]);
    expect(await readFile(path.join(root, 'sources/text/text-1.md'), 'utf8')).toBe('原文');
  });

  it('never overwrites a hand edit or resurrects a deleted delivered card on recovery', async () => {
    const input = { workflowRunId: 's2-run', stepRunId: 's2-save', nodeId: 'save', kind: 'text' as const, title: '正文', content: '初稿' };
    const first = await service.materializeWorkflowArtifact('project-1', input);
    const snapshot = await service.read('project-1');
    const nodes = snapshot.state.workbenchBasicNodes as Array<Record<string, unknown>>;
    await service.patch('project-1', { workbenchBasicNodes: nodes.map(node => ({ ...node, text: '人工修改' })) });
    await service.materializeWorkflowArtifact('project-1', input);
    expect(await readFile(path.join(root, 'sources/text', `${first.canvasNodeId}.md`), 'utf8')).toBe('人工修改');
    await service.patch('project-1', { workbenchBasicNodes: [] });
    await expect(new CanvasStateService(() => root).materializeWorkflowArtifact('project-1', input)).rejects.toMatchObject({ status: 409 });
    expect((await service.read('project-1')).state.workbenchBasicNodes).toEqual([]);
  });

  it('adopts a text candidate once and preserves edits when the action is replayed', async () => {
    const base = { id: 'text-1', kind: 'text', text: '原文', generation: { requestId: 'r1', status: 'running' } };
    await service.patch('project-1', { workbenchBasicNodes: [base, { id: 'ref', kind: 'text', text: '参考不变' }] });
    const input = { nodeId: 'text-1', requestId: 'r1', baseDigest: `sha256:${createHash('sha256').update('原文').digest('hex')}`, content: '候选' };
    const applied = await service.applyTextCandidate('project-1', input);
    expect(await readFile(path.join(root, 'sources/text/text-1.md'), 'utf8')).toBe('候选');
    expect(await readFile(path.join(root, 'sources/text/ref.md'), 'utf8')).toBe('参考不变');
    const nodes = applied.state.workbenchBasicNodes as Array<Record<string, unknown>>;
    await service.patch('project-1', { workbenchBasicNodes: nodes.map(node => node.id === 'text-1' ? { ...node, text: '采用后人工修改' } : node) });
    const replay = await service.applyTextCandidate('project-1', input);
    expect((replay.state.workbenchBasicNodes as Array<Record<string, unknown>>)[0]?.text).toBe('采用后人工修改');
  });

  it('forks a shared text document when one card adopts an AI candidate', async () => {
    const shared = '画布文本/shared.md';
    await service.patch('project-1', { workbenchBasicNodes: [
      { id: 'text-1', kind: 'text', text: '原文', projectFilePath: shared, generation: { requestId: 'r1', status: 'running' } },
      { id: 'text-2', kind: 'text', text: '原文', projectFilePath: shared },
    ] });
    const input = { nodeId: 'text-1', requestId: 'r1', baseDigest: `sha256:${createHash('sha256').update('原文').digest('hex')}`, content: '候选' };
    const applied = await service.applyTextCandidate('project-1', input);
    const nodes = applied.state.workbenchBasicNodes as Array<Record<string, unknown>>;

    expect(nodes[0]).toMatchObject({ text: '候选', projectFilePath: 'sources/text/text-1.md' });
    expect(nodes[1]).toMatchObject({ text: '原文', projectFilePath: shared });
    expect(await readFile(path.join(root, shared), 'utf8')).toBe('原文');
    expect(await readFile(path.join(root, 'sources/text/text-1.md'), 'utf8')).toBe('候选');
  });

  it('enforces copy-on-write for an inline edit from an older client', async () => {
    const shared = '画布文本/shared.md';
    const original = [
      { id: 'text-1', kind: 'text', text: '原文', projectFilePath: shared },
      { id: 'text-2', kind: 'text', text: '原文', projectFilePath: shared },
    ];
    await service.patch('project-1', { workbenchBasicNodes: original });
    const changed = await service.patch('project-1', { workbenchBasicNodes: [
      { ...original[0], text: '只改第一张' },
      original[1],
    ] });
    const nodes = changed.state.workbenchBasicNodes as Array<Record<string, unknown>>;

    expect(nodes[0]?.projectFilePath).toBe('sources/text/text-1.md');
    expect(nodes[1]?.projectFilePath).toBe(shared);
    expect(await readFile(path.join(root, shared), 'utf8')).toBe('原文');
    expect(await readFile(path.join(root, String(nodes[0]?.projectFilePath)), 'utf8')).toBe('只改第一张');
  });

  it('keeps references shared when the backing document edits every card together', async () => {
    const shared = 'shared-note.md';
    const original = [
      { id: 'text-1', kind: 'text', text: '原文', projectFilePath: shared },
      { id: 'text-2', kind: 'text', text: '原文', projectFilePath: shared },
    ];
    await service.patch('project-1', { workbenchBasicNodes: original });
    const changed = await service.patch('project-1', { workbenchBasicNodes: original.map(node => ({ ...node, text: '文档统一修改' })) });
    const nodes = changed.state.workbenchBasicNodes as Array<Record<string, unknown>>;

    expect(nodes.map(node => node.projectFilePath)).toEqual([shared, shared]);
    expect(await readFile(path.join(root, shared), 'utf8')).toBe('文档统一修改');
  });

  it('rejects a stale candidate without changing the current text or document', async () => {
    await service.patch('project-1', { workbenchBasicNodes: [{ id: 'text-1', kind: 'text', text: '人工新版本', generation: { requestId: 'r1' } }] });
    await expect(service.applyTextCandidate('project-1', { nodeId: 'text-1', requestId: 'r1', baseDigest: `sha256:${createHash('sha256').update('旧版').digest('hex')}`, content: '候选' })).rejects.toMatchObject({ status: 409 });
    expect(await readFile(path.join(root, 'sources/text/text-1.md'), 'utf8')).toBe('人工新版本');
  });

  it('rejects an independently edited project document', async () => {
    await service.patch('project-1', { workbenchBasicNodes: [{ id: 'text-1', kind: 'text', text: '原文', generation: { requestId: 'r1' } }] });
    await writeFile(path.join(root, 'sources/text/text-1.md'), '外部编辑');
    await expect(service.applyTextCandidate('project-1', { nodeId: 'text-1', requestId: 'r1', baseDigest: `sha256:${createHash('sha256').update('原文').digest('hex')}`, content: '候选' })).rejects.toMatchObject({ status: 409 });
    expect(await readFile(path.join(root, 'sources/text/text-1.md'), 'utf8')).toBe('外部编辑');
  });

  it('keeps ordinary canvas text as a real Markdown attachment source', async () => {
    await service.patch('project-1', {
      workbenchBasicNodes: [{
        id: 'brief-1', kind: 'text', x: 10, y: 20, width: 350, height: 360,
        title: '活动需求', text: '第一版正文',
      }],
    });
    expect(await readFile(path.join(root, 'sources/text', 'brief-1.md'), 'utf8')).toBe('第一版正文');

    await service.patch('project-1', {
      workbenchBasicNodes: [{
        id: 'brief-1', kind: 'text', x: 10, y: 20, width: 350, height: 360,
        title: '活动需求', text: '第二版正文',
      }],
    });
    expect(await readFile(path.join(root, 'sources/text', 'brief-1.md'), 'utf8')).toBe('第二版正文');
  });

  it('creates an idempotent text node in the persisted workbench canvas', async () => {
    const input = {
      workflowRunId: 'run-1',
      stepRunId: 'step-1',
      nodeId: 'artifact',
      sourceAgentStepRunId: 'agent-step-1',
      sourceResultId: 'result-1',
      sourceItemIds: ['1', '2', '2'],
      kind: 'text' as const,
      title: '活动文案',
      content: '真实写入画布的正文',
    };

    const first = await service.materializeWorkflowArtifact('project-1', input);
    const documentPath = path.join(root, 'sources/text', `${first.canvasNodeId}.md`);
    expect(await readFile(documentPath, 'utf8')).toBe('真实写入画布的正文');
    await rm(documentPath);
    const retry = await service.materializeWorkflowArtifact('project-1', input);
    const snapshot = await service.read('project-1');

    expect(retry.canvasNodeId).toBe(first.canvasNodeId);
    expect(await readFile(documentPath, 'utf8')).toBe('真实写入画布的正文');
    expect(snapshot.state.workbenchBasicNodes).toEqual([
      expect.objectContaining({
        id: first.canvasNodeId,
        kind: 'text',
        width: 420,
        height: 520,
        title: '活动文案',
        text: '真实写入画布的正文',
        projectFilePath: `sources/text/${first.canvasNodeId}.md`,
        sourceMime: 'text/markdown',
        source: {
          workflowRunId: 'run-1',
          stepRunId: 'step-1',
          nodeId: 'artifact',
          agentStepRunId: 'agent-step-1',
          resultId: 'result-1',
          itemIds: ['1', '2'],
        },
      }),
    ]);
  });

  it('places a confirmed artifact to the right of its source result card', async () => {
    await service.patch('project-1', {
      workbenchWorkflowStagePositionsV2: {
        'workflow-result-result-2': { x: 840, y: 360 },
      },
    });
    const result = await service.materializeWorkflowArtifact('project-1', {
      workflowRunId: 'run-2',
      stepRunId: 'review-step-2',
      nodeId: 'review-2',
      sourceResultId: 'result-2',
      kind: 'text',
      title: '方案正文',
      content: '# 正文',
    });
    const snapshot = await service.read('project-1');

    expect(snapshot.state.workbenchBasicNodes).toEqual([
      expect.objectContaining({ id: result.canvasNodeId, x: 1440, y: 360 }),
    ]);
  });

  it('repairs lineage on an idempotent retry without duplicating the canvas node', async () => {
    const base = {
      workflowRunId: 'run-repair',
      stepRunId: 'delivery-repair',
      nodeId: 'delivery',
      kind: 'text' as const,
      title: '正文',
      content: '# 正文',
    };
    const first = await service.materializeWorkflowArtifact('project-1', base);
    const repaired = await service.materializeWorkflowArtifact('project-1', {
      ...base,
      sourceResultId: 'result-before-delivery',
    });
    const snapshot = await service.read('project-1');

    expect(repaired.canvasNodeId).toBe(first.canvasNodeId);
    expect(snapshot.state.workbenchBasicNodes).toEqual([
      expect.objectContaining({
        id: first.canvasNodeId,
        source: expect.objectContaining({ resultId: 'result-before-delivery' }),
      }),
    ]);
  });

  it('creates an image production card with the configured generation draft', async () => {
    const result = await service.materializeWorkflowArtifact('project-1', {
      workflowRunId: 'run-image',
      stepRunId: 'step-image',
      nodeId: 'image-artifact',
      kind: 'image',
      title: '主视觉',
      content: '城市夜景，蓝紫色调',
      image: { ratio: '16:9', count: 3, resolution: '4K' },
    });
    const snapshot = await service.read('project-1');

    expect(snapshot.state.workbenchInstances).toEqual([
      expect.objectContaining({ id: result.canvasNodeId, kind: 'visual', label: '主视觉' }),
    ]);
    expect(snapshot.state.workbenchTaskDrafts).toMatchObject({
      [result.canvasNodeId]: {
        text: '城市夜景，蓝紫色调',
        imageCount: 3,
        imageRatio: '16:9',
        imageRatios: ['16:9'],
        imageResolution: '4K',
      },
    });
  });

  it('repairs lineage for an existing visual delivery without creating a second card', async () => {
    const base = {
      workflowRunId: 'run-image-repair',
      stepRunId: 'delivery-image-repair',
      nodeId: 'delivery-image',
      kind: 'image' as const,
      title: '主视觉',
      content: '城市夜景',
    };
    const first = await service.materializeWorkflowArtifact('project-1', base);
    const repaired = await service.materializeWorkflowArtifact('project-1', {
      ...base,
      sourceResultId: 'result-before-image-delivery',
    });
    const snapshot = await service.read('project-1');

    expect(repaired.canvasNodeId).toBe(first.canvasNodeId);
    expect(snapshot.state.workbenchInstances).toEqual([
      expect.objectContaining({
        id: first.canvasNodeId,
        source: expect.objectContaining({ resultId: 'result-before-image-delivery' }),
      }),
    ]);
  });

  it('preserves a server-materialized text card when a stale client canvas snapshot arrives later', async () => {
    await service.patch('project-1', {
      workbenchBasicNodes: [{ id: 'manual-text', kind: 'text', x: 20, y: 30, text: 'draft' }],
    });
    const clientBase = await service.read('project-1');

    const materialized = await service.materializeWorkflowArtifact('project-1', {
      workflowRunId: 'run-concurrent-text',
      stepRunId: 'delivery-concurrent-text',
      nodeId: 'delivery-text',
      kind: 'text',
      title: '正文',
      content: '# 不能被旧快照覆盖',
    });

    await service.patch(
      'project-1',
      {
        workbenchBasicNodes: [{ id: 'manual-text', kind: 'text', x: 80, y: 90, text: 'draft' }],
      },
      {
        expectedRevision: clientBase.revision,
        base: { workbenchBasicNodes: clientBase.state.workbenchBasicNodes },
      },
    );
    const snapshot = await service.read('project-1');
    const nodes = snapshot.state.workbenchBasicNodes as Array<Record<string, unknown>>;

    expect(nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'manual-text', x: 80, y: 90 }),
      expect.objectContaining({ id: materialized.canvasNodeId, projectFilePath: `sources/text/${materialized.canvasNodeId}.md` }),
    ]));
  });

  it('preserves a server-materialized image card and draft when stale visual state arrives later', async () => {
    await service.patch('project-1', {
      workbenchInstances: [{ id: 'manual-visual', kind: 'visual', x: 10, y: 20 }],
      workbenchTaskDrafts: {
        'manual-visual': { text: '原始描述', attachments: [] },
      },
    });
    const clientBase = await service.read('project-1');

    const materialized = await service.materializeWorkflowArtifact('project-1', {
      workflowRunId: 'run-concurrent-image',
      stepRunId: 'delivery-concurrent-image',
      nodeId: 'delivery-image',
      kind: 'image',
      title: '主视觉',
      content: '蓝紫色城市夜景',
    });

    await service.patch(
      'project-1',
      {
        workbenchInstances: [{ id: 'manual-visual', kind: 'visual', x: 70, y: 80 }],
        workbenchTaskDrafts: {
          'manual-visual': { text: '修改后的描述', attachments: [] },
        },
      },
      {
        expectedRevision: clientBase.revision,
        base: {
          workbenchInstances: clientBase.state.workbenchInstances,
          workbenchTaskDrafts: clientBase.state.workbenchTaskDrafts,
        },
      },
    );
    const snapshot = await service.read('project-1');
    const instances = snapshot.state.workbenchInstances as Array<Record<string, unknown>>;
    const drafts = snapshot.state.workbenchTaskDrafts as Record<string, Record<string, unknown>>;

    expect(instances).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'manual-visual', x: 70, y: 80 }),
      expect.objectContaining({ id: materialized.canvasNodeId, kind: 'visual' }),
    ]));
    expect(drafts['manual-visual']).toMatchObject({ text: '修改后的描述' });
    expect(drafts[materialized.canvasNodeId]).toMatchObject({ text: '蓝紫色城市夜景' });
  });

  it('selects one manifest-declared primary chat artifact and ignores supporting files', () => {
    const now = Date.now();
    const primary = {
      name: 'deck.html',
      size: 2048,
      mtime: now - 10,
      kind: 'html' as const,
      mime: 'text/html',
      artifactManifest: {
        version: 1 as const,
        kind: 'deck' as const,
        title: '年度方案',
        entry: 'deck.html',
        renderer: 'deck-html' as const,
        status: 'complete' as const,
        exports: ['html' as const],
        primary: true,
      },
    };
    const selected = selectPrimaryTaskCanvasArtifact([
      { name: 'preview.html', size: 4096, mtime: now, kind: 'html', mime: 'text/html' },
      { name: 'cover.png', size: 1024, mtime: now, kind: 'image', mime: 'image/png' },
      primary,
    ]);

    expect(selected).toBe(primary);
  });

  it('selects a primary media or document artifact when a turn produces no page', () => {
    const now = Date.now();
    expect(selectPrimaryTaskCanvasArtifact([
      { name: 'notes.txt', size: 20, mtime: now + 2, kind: 'text', mime: 'text/plain' },
      { name: 'poster.png', size: 200, mtime: now, kind: 'image', mime: 'image/png' },
      { name: 'readme.md', size: 100, mtime: now + 1, kind: 'text', mime: 'text/markdown' },
    ])?.name).toBe('poster.png');
    expect(selectPrimaryTaskCanvasArtifact([
      { name: 'notes.txt', size: 20, mtime: now + 2, kind: 'text', mime: 'text/plain' },
      { name: 'readme.md', size: 100, mtime: now + 1, kind: 'text', mime: 'text/markdown' },
    ])?.name).toBe('readme.md');
  });

  it('materializes an ordinary chat deck once and refreshes the same card on retry', async () => {
    await writeFile(path.join(root, 'deck.html'), '<!doctype html><title>v1</title>');
    const baseFile = {
      name: 'deck.html',
      size: 35,
      mtime: Date.now(),
      kind: 'html' as const,
      mime: 'text/html',
      artifactManifest: {
        version: 1 as const,
        kind: 'deck' as const,
        title: '年度方案 v1',
        entry: 'deck.html',
        renderer: 'deck-html' as const,
        exports: ['html' as const],
        primary: true,
      },
    };

    const first = await service.materializeTaskArtifact('project-1', {
      taskId: 'message-1',
      file: baseFile,
    });
    const retry = await service.materializeTaskArtifact('project-1', {
      taskId: 'message-1',
      file: baseFile,
    });
    await writeFile(path.join(root, 'deck.html'), '<!doctype html><title>v2</title>');
    const updated = await service.materializeTaskArtifact('project-1', {
      taskId: 'message-2',
      file: {
        ...baseFile,
        mtime: Date.now() + 1,
        artifactManifest: { ...baseFile.artifactManifest, title: '年度方案 v2' },
      },
    });
    const snapshot = await service.read('project-1');
    const nodes = snapshot.state.workbenchBasicNodes as Array<Record<string, any>>;

    expect(first.created).toBe(true);
    expect(retry).toMatchObject({ canvasNodeId: first.canvasNodeId, created: false });
    expect(updated).toMatchObject({ canvasNodeId: first.canvasNodeId, created: false });
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({
      id: first.canvasNodeId,
      kind: 'page',
      artifactFormat: 'presentation',
      title: '年度方案 v2',
      projectFilePath: 'deck.html',
      artifact: {
        renderer: 'html',
        summary: expect.stringContaining('幻灯片'),
        resource: { kind: 'project-file', path: 'deck.html', mimeType: 'text/html' },
      },
    });
  });

  it('materializes a normal-chat image as the native editable image node', async () => {
    await writeFile(path.join(root, 'poster.png'), 'fake-png-fixture');
    const result = await service.materializeTaskArtifact('project-1', {
      taskId: 'message-image',
      file: {
        name: 'poster.png',
        size: 16,
        mtime: Date.now(),
        kind: 'image',
        mime: 'image/png',
      },
    });
    const snapshot = await service.read('project-1');

    expect(snapshot.state.workbenchImages).toEqual([
      expect.objectContaining({
        id: result.canvasNodeId,
        path: 'poster.png',
        status: 'ready',
      }),
    ]);
    expect(snapshot.state.workbenchBasicNodes).toEqual([]);
  });

  it.each([
    ['note.md', 'text', 'text/markdown', '# 真实正文', 'text'],
    ['clip.mp4', 'video', 'video/mp4', 'fixture', 'video'],
    ['drawing.sketch', 'sketch', 'application/json', '{}', 'sketch'],
    ['plan.storyboard.json', 'code', 'application/json', '{"shots":[{"description":"开场镜头","dialogue":"你好"}]}', 'storyboard'],
  ] as const)('delivers %s into its native component and keeps the node on retry', async (name, kind, mime, content, nodeKind) => {
    await writeFile(path.join(root, name), content);
    const input = { taskId: 'm', file: { name, kind, mime, size: content.length, mtime: 1 } };
    expect(selectPrimaryTaskCanvasArtifact([input.file])?.name).toBe(name);
    const first = await service.materializeTaskArtifact('project-1', input);
    const retry = await service.materializeTaskArtifact('project-1', input);
    expect(retry.canvasNodeId).toBe(first.canvasNodeId);
    const nodes = (await service.read('project-1')).state.workbenchBasicNodes as Array<Record<string, any>>;
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({ kind: nodeKind, projectFilePath: name });
    if (nodeKind === 'text') expect(nodes[0]?.text).toBe(content);
    if (nodeKind === 'storyboard') expect(nodes[0]?.storyboard.shots[0].description).toBe('开场镜头');
  });

  it('does not replace a manually edited text card during delivery replay', async () => {
    await writeFile(path.join(root, 'note.md'), '# 原文');
    const input = { taskId: 'm', file: { name: 'note.md', kind: 'text' as const, mime: 'text/markdown', size: 10, mtime: 1 } };
    await service.materializeTaskArtifact('project-1', input);
    const snapshot = await service.read('project-1');
    const nodes = snapshot.state.workbenchBasicNodes as Array<Record<string, any>>;
    await service.patch('project-1', { workbenchBasicNodes: nodes.map(node => ({ ...node, text: '# 手工修改', x: 800, y: 600 })) });
    await service.materializeTaskArtifact('project-1', input);
    expect((await service.read('project-1')).state.workbenchBasicNodes).toEqual([expect.objectContaining({text:'# 手工修改',x:800,y:600})]);
  });

  it('rejects symlinks outside the authorized project without creating a node', async () => {
    await symlink(process.execPath, path.join(root, 'outside.md'));
    await expect(service.materializeTaskArtifact('project-1', {
      taskId:'m', file:{name:'outside.md',kind:'text',mime:'text/plain',size:1,mtime:1},
    })).rejects.toThrow('symlink escapes');
    expect((await service.read('project-1')).state.workbenchBasicNodes).toBeUndefined();
  });

  it('updates an existing canvas-owned page by file path instead of duplicating it', async () => {
    await writeFile(path.join(root, 'existing.html'), '<!doctype html>');
    await service.patch('project-1', {
      workbenchBasicNodes: [{
        id: 'canvas-owned-page',
        kind: 'page',
        x: 20,
        y: 30,
        title: '旧标题',
        projectFilePath: 'existing.html',
      }],
    });

    const result = await service.materializeTaskArtifact('project-1', {
      taskId: 'message-2',
      file: {
        name: 'existing.html',
        size: 15,
        mtime: Date.now(),
        kind: 'html',
        mime: 'text/html',
        artifactManifest: {
          version: 1,
          kind: 'html',
          title: '新标题',
          entry: 'existing.html',
          renderer: 'html',
          exports: ['html'],
        },
      },
    });
    const snapshot = await service.read('project-1');

    expect(result).toMatchObject({ canvasNodeId: 'canvas-owned-page', created: false });
    expect(snapshot.state.workbenchBasicNodes).toEqual([
      expect.objectContaining({
        id: 'canvas-owned-page',
        kind: 'page',
        x: 20,
        y: 30,
        title: '旧标题',
        projectFilePath: 'existing.html',
      }),
    ]);
  });

  it('refuses missing and escaping chat artifact paths without creating empty cards', async () => {
    const file = {
      name: 'missing.html',
      size: 0,
      mtime: Date.now(),
      kind: 'html' as const,
      mime: 'text/html',
    };
    await expect(service.materializeTaskArtifact('project-1', {
      taskId: 'message-missing',
      file,
    })).rejects.toMatchObject({ code: 'CANVAS_ITEM_NOT_FOUND' });
    await expect(service.materializeTaskArtifact('project-1', {
      taskId: 'message-escape',
      file: { ...file, name: '../escape.html' },
    })).rejects.toMatchObject({ code: 'CANVAS_INVALID_INPUT' });
    expect((await service.read('project-1')).state.workbenchBasicNodes).toBeUndefined();
  });
});
