import { workflowFileVersions } from '../workflows/artifact-versions.js';
import { workflowDeliveryOutput } from './workflow-delivery-output.js';
import { workflowDeliveryFiles } from './workflow-delivery-files.js';
import { canvasImageModelId, canvasTextPath, isCanvasTextPath, type ArtifactGenerationConfig, type ArtifactImageOptions } from '@bezier/contracts';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { canvasStateRelativePath, assertProjectPathHasNoSymlinks } from '../project-layout.js';
import { mkdir, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { ArtifactDescriptor, ProjectFile, ResultRenderer, WorkflowResultArtifact } from '@bezier/contracts';
import { canvasArtifactProjection, withCanvasResultHistory, parseStoryboardGenerationResult, type StoryboardGenerationDefaults, type ReportStoryboardRequirements } from '@bezier/contracts';

import { CanvasStateError } from './errors.js';
import { publishCanvasArtifactCandidate, saveCanvasArtifactCandidate, type CanvasArtifactWorkspace } from './artifact-workspace.js';
import {
  findCanvasNodeSummary,
  includeWorkflowResults,
  recordCanvasStateChanges,
  renderCanvasContextPrompt,
  summarizeCanvasState,
} from './context.js';
import { ProjectSerialLock } from '../storage/project-serial-lock.js';
import { recordProjectLedgerObservation } from '../project-ledger/active-recorder.js';
type ResolveCanvasProjectRoot = (projectId: string) => string | null | Promise<string | null>;

/**
 * 画布的视图状态（节点位置、视口、侧栏折叠等）。
 *
 * 与 `case.json` 的分工：`case.json` 是业务真值（创意/话题/产品句/正文），
 * 这里只存「画布怎么摆」。原版把两者分开是对的——画布拖一下就要落盘，
 * 混进业务文档会让每次拖动都改写业务真值的 revision。
 *
 * 与原版的唯一差异是**作用域**：原版是单例（一台机器一份全局
 * `canvas-editor.canvas.data.json`），DA 是多项目多人的，所以按项目落到
 * `<project>/整理/canvas-state.json`。前端不感知这个差异——它请求的
 * `/api/canvas/state` 由项目作用域拼成 `/api/projects/:id/canvas/state`。
 */
export type CanvasState = Record<string, unknown>;

export interface CanvasStateSnapshot {
  state: CanvasState;
  revision: number;
}

export interface CanvasPatchOptions {
  /** Client revision used to produce `changes`; retained for conflict evidence. */
  expectedRevision?: number;
  /** Previous values for changed keys, enabling a lossless three-way merge. */
  base?: CanvasState;
}

export type WorkflowCanvasArtifactKind = import('@bezier/contracts').WorkflowArtifactKind;

export interface WorkflowCanvasArtifactInput {
  workflowRunId: string;
  stepRunId: string;
  nodeId: string;
  /** Agent step that produced the content consumed by this delivery step. */
  sourceAgentStepRunId?: string;
  sourceResultId?: string;
  /** Selected child items on the source result card. */
  sourceItemIds?: string[];
  kind: WorkflowCanvasArtifactKind;
  title: string;
  content: string;
  /** Automatic delivery must contain real artifacts, not a generation draft. */
  requireArtifact?: boolean;
  generation?: ArtifactGenerationConfig;
  /** Legacy workflow payload retained for idempotent recovery of older runs. */
  image?: ArtifactImageOptions;
}

export interface WorkflowCanvasArtifactResult {
  content?: string;
  files?: import('@bezier/contracts').WorkflowArtifactFile[];
  canvasNodeId: string;
  kind: WorkflowCanvasArtifactKind;
  revision: number;
}

export interface TaskCanvasArtifactInput {
  taskId: string;
  file: ProjectFile;
}

export interface TaskCanvasArtifactResult {
  canvasNodeId: string;
  projectFilePath: string;
  created: boolean;
  revision: number;
}

/** Remap card paths and edge-derived inputs without touching frozen uploaded snapshots. */
function reconcileSketchFileReferences(state: CanvasState): CanvasState {
  const aliases = recordValue(state.__sketchFileRenames);
  if (!Object.keys(aliases).length) return state;
  const visit = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(visit);
    if (!value || typeof value !== 'object') return value;
    const item = value as Record<string, unknown>;
    const next = Object.fromEntries(Object.entries(item).map(([key, child]) => [key, visit(child)]));
    const sourceId = item.kind === 'sketch' ? item.id : item.sourceNodeId;
    const paths = typeof sourceId === 'string' ? recordValue(aliases[sourceId]) : {};
    for (const key of ['projectFilePath', 'path']) {
      const source = item[key] || (key === 'projectFilePath' && item.kind === 'sketch' ? `canvas-${item.id}.sketch.json` : undefined);
      const target = typeof source === 'string' ? paths[source] : undefined;
      if (typeof target === 'string') { next[key] = target; if (item.kind === 'sketch') next.sketchPending = false; }
    }
    return next;
  };
  return { ...state,
    ...(state.workbenchBasicNodes ? { workbenchBasicNodes: visit(state.workbenchBasicNodes) } : {}),
    ...(state.workbenchTaskDrafts ? { workbenchTaskDrafts: visit(state.workbenchTaskDrafts) } : {}),
  };
}

interface StoredCanvasState {
  version: 1;
  projectId: string;
  updatedAt: string;
  state: CanvasState;
}

export class CanvasStateService {
  private readonly lock = new ProjectSerialLock();

  constructor(private readonly resolveProjectRoot: ResolveCanvasProjectRoot,
    private readonly readUsage?: (projectId: string) => import('@bezier/contracts').CanvasContextSummary['recentUsage']) {}

  async read(projectId: string): Promise<CanvasStateSnapshot> {
    const file = await this.stateFile(projectId);
    return this.readSnapshot(file);
  }

  async revision(projectId: string): Promise<number> {
    const file = await this.stateFile(projectId);
    return this.readRevision(file);
  }

  /** Media delivery shares the exact serialization boundary with canvas edits. */
  async updateMediaState(projectId: string, update: (state: CanvasState) => CanvasState): Promise<CanvasStateSnapshot> {
    const file = await this.stateFile(projectId);
    return this.lock.run(projectId, async () => {
      const current = await this.readSnapshot(file);
      const next = update(current.state);
      if (next === current.state) return current;
      await mkdir(path.dirname(file), { recursive: true });
      await atomicWrite(file, `${JSON.stringify({ version: 1, projectId, updatedAt: new Date().toISOString(), state: next }, null, 2)}\n`);
      const revision = await this.readRevision(file);
      recordCanvasStateChanges(projectId, current.state, next, revision, path.relative(path.dirname(path.dirname(file)), file));
      return { state: next, revision };
    });
  }

  /** File identity is authoritative even when an older client replays an undo or stale patch. */
  async renameSketchFile(projectId: string, from: string, to: string): Promise<void> {
    if (!from.toLowerCase().endsWith('.sketch.json')) return;
    await this.updateMediaState(projectId, state => {
      const nodes = arrayRecords(state.workbenchBasicNodes);
      const aliases = { ...recordValue(state.__sketchFileRenames) };
      let changed = false;
      const next = nodes.map(node => {
        if (node.kind !== 'sketch' || (node.projectFilePath || `canvas-${node.id}.sketch.json`) !== from || typeof node.id !== 'string') return node;
        const paths = { ...recordValue(aliases[node.id]) };
        for (const [old, target] of Object.entries(paths)) if (target === from) paths[old] = to;
        paths[from] = to;
        // Renaming back to an earlier name must not create a redirect cycle.
        delete paths[to];
        aliases[node.id] = paths;
        changed = true;
        return { ...node, projectFilePath: to, sketchPending: false };
      });
      return changed ? reconcileSketchFileReferences({ ...state, workbenchBasicNodes: next, __sketchFileRenames: aliases }) : state;
    });
  }

  /** Publish a saved candidate on its original card without adopting it. */
  async linkTextCandidate(projectId: string, input: { nodeId: string; requestId: string; runId: string; content: string }): Promise<CanvasStateSnapshot> {
    const file = await this.stateFile(projectId);
    return this.lock.run(projectId, async () => {
      const current = await this.readSnapshot(file);
      const nodes = arrayRecords(current.state.workbenchBasicNodes);
      const node = nodes.find(item => item.id === input.nodeId && item.kind === 'text');
      if (!node) throw new CanvasStateError(404, 'CANVAS_NODE_NOT_FOUND', '原文本卡已不存在，候选仍保留');
      const generation = recordValue(node.generation);
      if (generation.appliedRequestId === input.requestId) return current;
      if (generation.requestId !== input.requestId) throw new CanvasStateError(409, 'CANVAS_TEXT_CONFLICT', '当前任务已改变，候选仍保留');
      if (generation.candidateText === input.content && generation.runId === input.runId && generation.status === 'succeeded') return current;
      const nextNode = { ...node, generation: { ...generation, status: 'succeeded', candidateText: input.content, runId: input.runId, error: undefined } };
      const next = { ...current.state, workbenchBasicNodes: nodes.map(item => item.id === input.nodeId ? nextNode : item) };
      await atomicWrite(file, `${JSON.stringify({ version: 1, projectId, updatedAt: new Date().toISOString(), state: next }, null, 2)}\n`);
      const revision = await this.readRevision(file);
      recordCanvasStateChanges(projectId, current.state, next, revision, path.relative(path.dirname(path.dirname(file)), file));
      return { state: next, revision };
    });
  }

  async failTextDelivery(projectId: string, input: { nodeId: string; requestId: string; runId: string; error: string }): Promise<void> {
    const file = await this.stateFile(projectId);
    await this.lock.run(projectId, async () => {
      const current = await this.readSnapshot(file);
      const nodes = arrayRecords(current.state.workbenchBasicNodes);
      const node = nodes.find(item => item.id === input.nodeId);
      if (!node) return;
      const generation = recordValue(node.generation);
      if (generation.requestId !== input.requestId || generation.appliedRequestId === input.requestId) return;
      const next = { ...current.state, workbenchBasicNodes: nodes.map(item => item.id === input.nodeId
        ? { ...item, generation: { ...generation, runId: input.runId, status: 'failed', error: input.error } } : item) };
      await atomicWrite(file, `${JSON.stringify({ version: 1, projectId, updatedAt: new Date().toISOString(), state: next }, null, 2)}\n`);
      recordCanvasStateChanges(projectId, current.state, next, await this.readRevision(file), path.relative(path.dirname(path.dirname(file)), file));
    });
  }

  /** Backend delivery survives closing chat; a changed/deleted target is never recreated. */
  async applyStoryboardCandidate(projectId: string, input: { nodeId: string; requestId: string; runId: string; content: string }): Promise<CanvasStateSnapshot> {
    const file = await this.stateFile(projectId);
    return this.lock.run(projectId, async () => {
      const current = await this.readSnapshot(file);
      const nodes = arrayRecords(current.state.workbenchBasicNodes);
      const node = nodes.find(item => item.id === input.nodeId && item.kind === 'storyboard');
      if (!node) throw new CanvasStateError(404, 'CANVAS_NODE_NOT_FOUND', '原分镜卡已不存在，候选仍保留');
      const generation = recordValue(node.generation);
      if (generation.appliedRequestId === input.requestId) return current;
      if (generation.requestId !== input.requestId
        || typeof generation.baseStoryboard !== 'string'
        || generation.baseStoryboard !== JSON.stringify(node.storyboard ?? null)) {
        throw new CanvasStateError(409, 'CANVAS_TEXT_CONFLICT', '分镜或当前任务已改变，未覆盖；候选仍保留');
      }
      const storyboard = parseStoryboardGenerationResult(input.content,
        (node.storyboard ?? { aspectRatio: '16:9', visualStyle: '', referenceRoles: {} }) as StoryboardGenerationDefaults,
        node.storyboardRequirements as ReportStoryboardRequirements | undefined);
      const nextNode = withCanvasResultHistory(node, {
        storyboard, storyboardEntryMode: 'edit',
        generation: { ...generation, status: 'succeeded', runId: input.runId, appliedRequestId: input.requestId, error: undefined },
      }, ['storyboard']);
      const next = { ...current.state, workbenchBasicNodes: nodes.map(item => item.id === input.nodeId ? nextNode : item) };
      await atomicWrite(file, `${JSON.stringify({ version: 1, projectId, updatedAt: new Date().toISOString(), state: next }, null, 2)}\n`);
      const revision = await this.readRevision(file);
      recordCanvasStateChanges(projectId, current.state, next, revision, path.relative(path.dirname(path.dirname(file)), file));
      return { state: next, revision };
    });
  }

  /** Adopt an existing answer, never execute the model. Compare inside the canvas lock. */
  async applyTextCandidate(projectId: string, input: { nodeId: string; requestId: string; baseDigest: string; content: string }): Promise<CanvasStateSnapshot> {
    if (!/^[A-Za-z0-9_-]+$/u.test(input.nodeId) || !input.content.trim()) throw new CanvasStateError(400, 'CANVAS_INVALID_INPUT', '无效的文本候选');
    const file = await this.stateFile(projectId);
    return this.lock.run(projectId, async () => {
      const current = await this.readSnapshot(file);
      const nodes = arrayRecords(current.state.workbenchBasicNodes);
      const node = nodes.find(item => item.id === input.nodeId && item.kind === 'text');
      if (!node) throw new CanvasStateError(404, 'CANVAS_NODE_NOT_FOUND', '原文本卡已不存在，候选仍保留');
      const generation = recordValue(node.generation);
      if (generation.appliedRequestId === input.requestId) return current;
      const text = typeof node.text === 'string' ? node.text : '';
      if (`sha256:${createHash('sha256').update(text).digest('hex')}` !== input.baseDigest
        || (generation.requestId && generation.requestId !== input.requestId)) {
        throw new CanvasStateError(409, 'CANVAS_TEXT_CONFLICT', '原文或当前任务已改变，未覆盖；候选仍保留');
      }
      const sourceDocumentPath = canvasTextDocumentPath(node);
      const documentPath = canvasTextCandidateTargetPath(nodes, node, input.requestId);
      const documentFile = path.join(path.dirname(path.dirname(file)), ...sourceDocumentPath.split('/'));
      try {
        const stored = await readFile(documentFile, 'utf8');
        // The candidate value is also accepted to recover an interrupted two-file save.
        if (stored !== text && stored !== input.content) throw new CanvasStateError(409, 'CANVAS_TEXT_CONFLICT', '项目文档已修改，未覆盖');
      } catch (error) { if (!isMissing(error)) throw error; }
      const nextNode = withCanvasResultHistory(node, {
        text: input.content,
        projectFilePath: documentPath,
        generation: { requestId: input.requestId, status: 'succeeded', appliedRequestId: input.requestId },
      }, documentPath === sourceDocumentPath ? ['text'] : ['text', 'projectFilePath']);
      const next = { ...current.state, workbenchBasicNodes: nodes.map(item => item.id === input.nodeId ? nextNode : item) };
      await syncCanvasTextDocuments(file, [nextNode]);
      await atomicWrite(file, `${JSON.stringify({ version: 1, projectId, updatedAt: new Date().toISOString(), state: next }, null, 2)}\n`);
      const revision = await this.readRevision(file);
      recordCanvasStateChanges(projectId, current.state, next, revision, path.relative(path.dirname(path.dirname(file)), file));
      return { state: next, revision };
    });
  }

  /** Publish and bind under the same lock used by interactive canvas edits. */
  async applyArtifactCandidate(projectId: string, workspace: CanvasArtifactWorkspace): Promise<CanvasStateSnapshot> {
    const file = await this.stateFile(projectId);
    if (workspace.projectRoot !== await realpath(path.dirname(path.dirname(file))) || !workspace.target) {
      throw new CanvasStateError(400, 'CANVAS_INVALID_INPUT', '候选项目或目标不一致');
    }
    return this.lock.run(projectId, async () => {
      const current = await this.readSnapshot(file);
      const nodes = arrayRecords(current.state.workbenchBasicNodes);
      const node = nodes.find(item => item.id === workspace.target!.nodeId);
      if (node && recordValue(node.generation).appliedRequestId === workspace.target!.requestId
        && node.projectFilePath === workspace.outputPath) {
        saveCanvasArtifactCandidate(workspace);
        return current;
      }
      // Conflict leaves a standalone candidate file, never a resurrected node.
      publishCanvasArtifactCandidate(workspace);
      if (!node) throw new CanvasStateError(404, 'CANVAS_NODE_NOT_FOUND', '目标已不存在，候选已另存');
      const nextNode = withCanvasResultHistory(node, { projectFilePath: workspace.outputPath,
        generation: { ...recordValue(node.generation), requestId: workspace.target!.requestId, status: 'succeeded', appliedRequestId: workspace.target!.requestId } }, ['projectFilePath']);
      const next = { ...current.state, workbenchBasicNodes: nodes.map(item => item.id === node.id ? nextNode : item) };
      await atomicWrite(file, `${JSON.stringify({ version: 1, projectId, updatedAt: new Date().toISOString(), state: next }, null, 2)}\n`);
      const revision = await this.readRevision(file);
      recordCanvasStateChanges(projectId, current.state, next, revision, path.relative(path.dirname(path.dirname(file)), file));
      return { state: next, revision };
    });
  }

  async context(projectId: string, workflowArtifacts: readonly WorkflowResultArtifact[] = []) {
    const snapshot = await this.read(projectId);
    const summary = includeWorkflowResults(
      summarizeCanvasState(projectId, snapshot.state, snapshot.revision, Number.MAX_SAFE_INTEGER),
      workflowArtifacts,
    );
    const recentUsage = this.readUsage?.(projectId);
    return recentUsage?.length ? { ...summary, recentUsage } : summary;
  }

  async contextPrompt(projectId: string, workflowArtifacts: readonly WorkflowResultArtifact[] = []): Promise<string> {
    return renderCanvasContextPrompt(await this.context(projectId, workflowArtifacts));
  }

  async node(projectId: string, nodeId: string) {
    const snapshot = await this.read(projectId);
    return findCanvasNodeSummary(projectId, snapshot.state, snapshot.revision, nodeId);
  }

  /**
   * 合并写入。
   *
   * revision 用文件 mtime 的毫秒数，与原版语义一致（原版用 mtime_ns）：
   * 前端只拿它做「变了没有」的比较，不要求单调自增。没有实际变化时直接
   * 返回当前 revision 而不落盘，避免拖动结束后的重复 flush 把 revision
   * 顶上去、触发所有客户端无谓地全量重拉。
   */
  async patch(
    projectId: string,
    changes: Record<string, unknown>,
    options: CanvasPatchOptions = {},
  ): Promise<CanvasStateSnapshot> {
    if (!changes || typeof changes !== 'object' || Array.isArray(changes)) {
      throw new CanvasStateError(400, 'CANVAS_INVALID_INPUT', 'state changes must be an object');
    }
    const keys = Object.keys(changes);
    if (keys.length === 0) {
      throw new CanvasStateError(400, 'CANVAS_INVALID_INPUT', 'state changes must be a non-empty object');
    }
    if (keys.some((key) => !key || key.startsWith('__'))) {
      throw new CanvasStateError(400, 'CANVAS_INVALID_INPUT', 'invalid state key');
    }

    const file = await this.stateFile(projectId);
    return this.lock.run(projectId, async () => {
      const current = await this.readSnapshot(file);
      if (
        options.expectedRevision !== undefined
        && options.expectedRevision !== current.revision
        && !options.base
      ) {
        throw new CanvasStateError(409, 'CANVAS_REVISION_CONFLICT', 'canvas revision conflict', {
          expectedRevision: options.expectedRevision,
          actualRevision: current.revision,
        });
      }
      let next = { ...current.state };
      let dirty = false;
      for (const [key, value] of Object.entries(changes)) {
        const hasBase = Object.prototype.hasOwnProperty.call(options.base || {}, key);
        const merged = hasBase
          ? mergeCanvasValue(options.base?.[key], value, next[key])
          : value;
        if (sameJson(next[key], merged)) continue;
        next[key] = merged;
        dirty = true;
      }
      if (!dirty) return current;

      next = reconcileSketchFileReferences(next);
      if (keys.includes('workbenchBasicNodes')) {
        next.workbenchBasicNodes = applyCanvasTextCopyOnWrite(
          arrayRecords(current.state.workbenchBasicNodes),
          arrayRecords(next.workbenchBasicNodes),
        );
        await syncCanvasTextDocuments(file, arrayRecords(next.workbenchBasicNodes));
      }

      const payload: StoredCanvasState = {
        version: 1,
        projectId,
        updatedAt: new Date().toISOString(),
        state: next,
      };
      await mkdir(path.dirname(file), { recursive: true });
      await atomicWrite(file, `${JSON.stringify(payload, null, 2)}\n`);
      const revision = await this.readRevision(file);
      recordCanvasStateChanges(projectId, current.state, next, revision, path.relative(path.dirname(path.dirname(file)), file));
      return { state: next, revision };
    });
  }

  /**
   * Materialize one workflow output through the same persisted canvas state
   * consumed by the workbench. The stable id makes retries idempotent instead
   * of duplicating cards after a network timeout.
   */
  async workflowFileVersions(projectId: string, value: import('@bezier/contracts').JsonValue, verifyOnly = false) {
    const root = await this.resolveProjectRoot(projectId);
    if (!root) throw new CanvasStateError(404, 'PROJECT_NOT_FOUND', '项目不存在');
    return workflowFileVersions(root, value, verifyOnly);
  }

  async materializeWorkflowArtifact(
    projectId: string,
    input: WorkflowCanvasArtifactInput,
  ): Promise<WorkflowCanvasArtifactResult> {
    const file = await this.stateFile(projectId);
    return this.lock.run(projectId, async () => {
      const current = await this.readSnapshot(file);
      const canvasNodeId = workflowCanvasNodeId(input.workflowRunId, input.stepRunId);
      const basicNodes = arrayRecords(current.state.workbenchBasicNodes);
      const instances = arrayRecords(current.state.workbenchInstances);
      const images = arrayRecords(current.state.workbenchImages);
      const existingImages = images.filter(image => image.id === canvasNodeId || String(image.id).startsWith(`${canvasNodeId}-image-`));
      const artifactProjectFilePath = input.kind === 'text'
        ? canvasTextDocumentPath(basicNodes.find(node => node.id === canvasNodeId) ?? { id: canvasNodeId })
        : undefined;
      // Text cards are document-backed everywhere else in the workbench.
      // Persist the Markdown before exposing the canvas node so a refresh or
      // "open details" can never observe a card whose resource still 404s.
      // Repeating this write also repairs artifacts created by older builds
      // that only stored inline canvas text.
      const source = {
        workflowRunId: input.workflowRunId,
        stepRunId: input.stepRunId,
        nodeId: input.nodeId,
        ...(input.sourceAgentStepRunId ? { agentStepRunId: input.sourceAgentStepRunId } : {}),
        ...(input.sourceResultId ? { resultId: input.sourceResultId } : {}),
        ...(input.sourceItemIds?.length
          ? { itemIds: [...new Set(input.sourceItemIds.filter(item => Boolean(item.trim())))] }
          : {}),
      };
      const existingBasicIndex = basicNodes.findIndex(node => node.id === canvasNodeId);
      const existingInstanceIndex = instances.findIndex(node => node.id === canvasNodeId);
      const receiptFile = path.join(path.dirname(file), 'workflow-deliveries', `${canvasNodeId}.json`);
      const savedReceipt = await readFile(receiptFile, 'utf8').then(text => JSON.parse(text)).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
      const finish = async (result: WorkflowCanvasArtifactResult): Promise<WorkflowCanvasArtifactResult> => {
        if (!input.requireArtifact) return result;
        const root = path.dirname(path.dirname(file));
        const output = savedReceipt?.output ?? await workflowDeliveryOutput(root, input.kind, canvasNodeId, (await this.readSnapshot(file)).state);
        await workflowFileVersions(root, output, true);
        await mkdir(path.dirname(receiptFile), { recursive: true });
        await atomicWrite(receiptFile, JSON.stringify({ canvasNodeId, workflowRunId: input.workflowRunId, stepRunId: input.stepRunId, output }));
        return { ...result, ...output };
      };
      if (existingBasicIndex < 0 && existingInstanceIndex < 0 && !existingImages.length) {
        const receipt = await readFile(receiptFile, 'utf8').catch((error: NodeJS.ErrnoException) => {
          if (error.code === 'ENOENT') return null;
          throw error;
        });
        if (receipt) throw new CanvasStateError(409, 'WORKFLOW_TARGET_REMOVED', '原结果卡已移除；已有产物保留，恢复不会重新创建这张卡');
      }
      if (existingImages.length) return finish({ canvasNodeId, kind: input.kind, revision: current.revision });
      if (existingBasicIndex >= 0 || existingInstanceIndex >= 0) {
        // Reconciliation must not replace a document edited after delivery.
        await mkdir(path.dirname(receiptFile), { recursive: true });
        await atomicWrite(receiptFile, JSON.stringify({ canvasNodeId, workflowRunId: input.workflowRunId, stepRunId: input.stepRunId, ...(savedReceipt?.output ? { output: savedReceipt.output } : {}) }));
        const existing = existingBasicIndex >= 0
          ? basicNodes[existingBasicIndex]!
          : instances[existingInstanceIndex]!;
        if (input.kind === 'text' && artifactProjectFilePath && existing.kind === 'text') {
          const documentFile = path.join(path.dirname(path.dirname(file)), artifactProjectFilePath);
          try { await stat(documentFile); }
          catch (error) {
            if (!isMissing(error)) throw error;
            // Repair a missing backing file from the current card, not the
            // historical AI output, so an intervening edit stays authoritative.
            await syncCanvasTextDocuments(file, [{ ...existing, projectFilePath: artifactProjectFilePath }]);
          }
        }
        const repairedSource = { ...recordValue(existing.source), ...source };
        const repairedBasic = existingBasicIndex >= 0
          ? {
              ...existing,
              source: repairedSource,
              ...(artifactProjectFilePath
                ? { projectFilePath: artifactProjectFilePath, sourceMime: 'text/markdown' }
                : {}),
            }
          : existing;
        if (
          JSON.stringify(existing.source) === JSON.stringify(repairedSource)
          && JSON.stringify(existing) === JSON.stringify(repairedBasic)
        ) {
          recordWorkflowCanvasGeneration(projectId, canvasNodeId, input);
          return finish({ canvasNodeId, kind: input.kind, revision: current.revision });
        }
        const nextState: CanvasState = { ...current.state };
        if (existingBasicIndex >= 0) {
          nextState.workbenchBasicNodes = basicNodes.map((node, index) => (
            index === existingBasicIndex ? repairedBasic : node
          ));
        } else {
          nextState.workbenchInstances = instances.map((node, index) => (
            index === existingInstanceIndex ? { ...node, source: repairedSource } : node
          ));
        }
        const payload: StoredCanvasState = {
          version: 1,
          projectId,
          updatedAt: new Date().toISOString(),
          state: nextState,
        };
        await mkdir(path.dirname(file), { recursive: true });
        await atomicWrite(file, `${JSON.stringify(payload, null, 2)}\n`);
        const revision = await this.readRevision(file);
        recordCanvasStateChanges(projectId, current.state, nextState, revision, path.relative(path.dirname(path.dirname(file)), file));
        recordWorkflowCanvasGeneration(projectId, canvasNodeId, input);
        return finish({ canvasNodeId, kind: input.kind, revision });
      }

      const artifactFiles = input.requireArtifact
        ? await workflowDeliveryFiles(path.dirname(path.dirname(file)), { ...input, ...(input.generation?.image ? { image: input.generation.image } : {}) })
        : [];
      const content = artifactFiles[0]?.text ?? input.content;
      if (input.kind === 'text') {
        const projectRoot = path.dirname(path.dirname(file));
        const documentFile = path.join(projectRoot, canvasTextPath(canvasNodeId));
        await mkdir(path.dirname(documentFile), { recursive: true });
        await atomicWrite(documentFile, content);
      }
      const position = workflowResultArtifactPosition(current.state, input.sourceResultId)
        ?? nextWorkflowArtifactPosition(basicNodes, instances);
      const nextState: CanvasState = { ...current.state };
      if (input.kind === 'image' && input.requireArtifact) {
        nextState.workbenchImages = [...images, ...artifactFiles.map((artifact, index) => ({
          id: index === 0 ? canvasNodeId : `${canvasNodeId}-image-${index}`,
          name: input.title || '图片', path: artifact.path, status: 'ready',
          x: position.x + index * 360, y: position.y, source,
          ...(input.generation ? { workflowGeneration: input.generation } : {}),
        }))];
      } else if (input.kind === 'image') {
        const imageOptions = input.generation?.image ?? input.image;
        const ratio = imageOptions?.ratio ?? '1:1';
        const count = Math.max(1, Math.min(4, Math.trunc(imageOptions?.count ?? 1)));
        nextState.workbenchInstances = [
          ...instances,
          {
            id: canvasNodeId,
            kind: 'visual',
            x: position.x,
            y: position.y,
            label: input.title || '图片',
            source,
            workflowGeneration: input.generation,
          },
        ];
        const taskDrafts = recordValue(current.state.workbenchTaskDrafts);
        nextState.workbenchTaskDrafts = {
          ...taskDrafts,
          [canvasNodeId]: {
            text: input.content,
            attachments: [],
            imageCount: count,
            imageRatio: ratio,
            imageRatios: [ratio],
            imageResolution: imageOptions?.resolution ?? '2K',
            ...(imageOptions?.model ? { models: [canvasImageModelId(imageOptions.model)] } : {}),
            ...(imageOptions?.references?.length ? { workflowReferences: imageOptions.references } : {}),
          },
        };
      } else {
        const isText = input.kind === 'text';
        nextState.workbenchBasicNodes = [
          ...basicNodes,
          {
            id: canvasNodeId,
            kind: input.kind === 'presentation' ? 'page' : input.kind,
            ...(input.kind === 'presentation' || input.kind === 'page' ? { artifactFormat: input.kind === 'presentation' ? 'presentation' : 'html' } : {}),
            ...(input.kind === 'video' ? {
              videoAspect: input.generation?.video?.ratio ?? '16:9',
              videoLength: input.generation?.video?.duration ?? 5,
              videoResolution: input.generation?.video?.resolution ?? '720p',
              videoModel: input.generation?.video?.model,
              videoMode: input.generation?.video?.mode ?? 't2v',
              videoCameraMove: input.generation?.video?.cameraMove,
            } : {}),
            ...(input.kind === 'presentation' ? { presentationOptions: {
              ...input.generation?.presentation,
              length: input.generation?.presentation?.length ?? 'standard',
              template: input.generation?.presentation?.template ?? 'smart',
              templateTitle: input.generation?.presentation?.templateTitle ?? '智能匹配',
            } } : {}),
            ...(input.kind === 'page' ? { webpageOptions: input.generation?.page ?? {} } : {}),
            ...(input.kind === 'text' ? { textOptions: input.generation?.text ?? {} } : {}),
            x: position.x,
            y: position.y,
            width: 420,
            height: isText ? 520 : 300,
            title: input.title || (isText ? '文本' : '页面'),
            text: input.requireArtifact && !isText ? '' : content,
            ...(artifactFiles[0] && !isText ? { projectFilePath: artifactFiles[0].path } : {}),
            ...(input.kind === 'video' && artifactFiles[0] ? { videoTask: { id: canvasNodeId, status: 'done', path: artifactFiles[0].path } } : {}),
            ...(artifactProjectFilePath
              ? { projectFilePath: artifactProjectFilePath, sourceMime: 'text/markdown' }
              : {}),
            source,
            ...(input.generation ? { workflowGeneration: input.generation } : {}),
          },
        ];
      }

      const payload: StoredCanvasState = {
        version: 1,
        projectId,
        updatedAt: new Date().toISOString(),
        state: nextState,
      };
      await mkdir(path.dirname(file), { recursive: true });
      await atomicWrite(file, `${JSON.stringify(payload, null, 2)}\n`);
      const revision = await this.readRevision(file);
      recordCanvasStateChanges(projectId, current.state, nextState, revision, path.relative(path.dirname(path.dirname(file)), file));
      recordWorkflowCanvasGeneration(projectId, canvasNodeId, input);
      await mkdir(path.dirname(receiptFile), { recursive: true });
      await atomicWrite(receiptFile, JSON.stringify({ canvasNodeId, workflowRunId: input.workflowRunId, stepRunId: input.stepRunId, ...(savedReceipt?.output ? { output: savedReceipt.output } : {}) }));
      return finish({ canvasNodeId, kind: input.kind, revision });
    });
  }

  /**
   * Materialize the primary durable output from an ordinary chat turn.
   *
   * The project-relative file path is the identity. A retry, reload, or later
   * turn that rewrites the same artifact updates the existing card instead of
   * appending another one. Canvas-authored turns are filtered by the caller;
   * this method deliberately knows nothing about chat/run ownership.
   */
  async materializeTaskArtifact(
    projectId: string,
    input: TaskCanvasArtifactInput,
  ): Promise<TaskCanvasArtifactResult> {
    const file = await this.stateFile(projectId);
    return this.lock.run(projectId, async () => {
      const projectRoot = path.dirname(path.dirname(file));
      const projectFilePath = normalizeSafeProjectFilePath(input.file.path ?? input.file.name);
      const absoluteFile = path.resolve(projectRoot, projectFilePath);
      if (!absoluteFile.startsWith(`${path.resolve(projectRoot)}${path.sep}`)) {
        throw new CanvasStateError(400, 'CANVAS_INVALID_INPUT', 'artifact path escapes the project root');
      }
      let fileStat;
      try {
        fileStat = await stat(absoluteFile);
      } catch (error) {
        if (isMissing(error)) {
          throw new CanvasStateError(404, 'CANVAS_ITEM_NOT_FOUND', 'chat artifact file not found', {
            projectFilePath,
          });
        }
        throw error;
      }
      if (!fileStat.isFile()) {
        throw new CanvasStateError(400, 'CANVAS_INVALID_INPUT', 'chat artifact must reference a project file');
      }
      const resolvedRoot = await realpath(projectRoot);
      if (!(await realpath(absoluteFile)).startsWith(`${resolvedRoot}${path.sep}`)) {
        throw new CanvasStateError(400, 'CANVAS_INVALID_INPUT', 'artifact symlink escapes the project root');
      }

      const current = await this.readSnapshot(file);
      const basicNodes = arrayRecords(current.state.workbenchBasicNodes);
      const instances = arrayRecords(current.state.workbenchInstances);
      const descriptor = chatProjectFileArtifactDescriptor(projectId, input.file, {
        projectFilePath,
        size: fileStat.size,
        mtimeMs: fileStat.mtimeMs,
      });
      if (descriptor.renderer === 'document' && fileStat.size <= 2 * 1024 * 1024 && /\.(md|markdown|txt)$/i.test(projectFilePath)) {
        descriptor.preview = { markdown: await readFile(absoluteFile, 'utf8') };
      }
      if (/\.storyboard\.json$/i.test(projectFilePath)) {
        if (fileStat.size > 2 * 1024 * 1024) throw new CanvasStateError(400, 'CANVAS_INVALID_INPUT', '镜头脚本超过 2 MB，未载入画布');
        const content = await readFile(absoluteFile, 'utf8');
        parseStoryboardGenerationResult(content, { aspectRatio: '16:9', visualStyle: '', referenceRoles: {} });
        descriptor.renderer = 'structured';
        descriptor.preview = { storyboard: content };
      }
      if (input.file.kind === 'sketch') descriptor.preview = { canvasKind: 'sketch' };
      const existingIndex = basicNodes.findIndex(node => (
        canvasNodeProjectFilePath(node) === projectFilePath
      ));

      if (descriptor.renderer === 'image' && (existingIndex < 0 || basicNodes[existingIndex]?.kind === 'artifact')) {
        const images = arrayRecords(current.state.workbenchImages);
        const existingImage = images.find(image => image.path === projectFilePath);
        if (existingImage) {
          recordTaskCanvasGeneration(projectId, String(existingImage.id), projectFilePath, input);
          return { canvasNodeId: String(existingImage.id), projectFilePath, created: false, revision: current.revision };
        }
        const previous = existingIndex >= 0 ? basicNodes[existingIndex] : undefined;
        const position = previous ?? nextWorkflowArtifactPosition(basicNodes, [...instances, ...images]);
        const canvasNodeId = String(previous?.id ?? chatCanvasNodeId(projectFilePath));
        const nextState = {
          ...current.state,
          workbenchBasicNodes: basicNodes.filter(node => node !== previous),
          workbenchImages: [...images, {
            id: canvasNodeId, name: descriptor.title, path: projectFilePath,
            x: position.x, y: position.y, status: 'ready',
          }],
        };
        await this.writeSnapshot(file, projectId, nextState, current.state);
        recordTaskCanvasGeneration(projectId, canvasNodeId, projectFilePath, input);
        return { canvasNodeId, projectFilePath, created: !previous, revision: await this.readRevision(file) };
      }

      if (existingIndex >= 0) {
        const existing = basicNodes[existingIndex]!;
        const projection = canvasArtifactProjection(descriptor);
        // Do not replace an in-canvas text edit with a replayed file delivery.
        const previousPreview = recordValue(recordValue(existing.artifact).preview);
        if (projection.kind === 'text' && existing.kind === 'text' && existing.text !== previousPreview.markdown) {
          projection.text = typeof existing.text === 'string' ? existing.text : projection.text;
        }
        if (projection.kind === 'storyboard' && existing.kind === 'storyboard') {
          // Script editing is canvas-owned after initial delivery; replay only repairs the binding.
          projection.storyboard = existing.storyboard as typeof projection.storyboard;
        }
        const updated = existing.kind === 'artifact' || existing.artifact
          ? {
              ...existing,
              title: descriptor.title,
              projectFilePath,
              sourceMime: descriptor.resource.kind === 'project-file'
                ? descriptor.resource.mimeType
                : input.file.mime,
              artifact: descriptor,
              ...projection,
            }
          : {
              ...existing,
              // A canvas-owned generator card keeps the user's own title;
              // only its durable file binding is repaired. Generated artifact
              // cards above continue to follow their manifest title.
              title: existing.title || descriptor.title,
              projectFilePath,
              sourceMime: input.file.mime,
            };
        if (sameJson(existing, updated)) {
          recordTaskCanvasGeneration(projectId, String(existing.id), projectFilePath, input);
          return {
            canvasNodeId: String(existing.id),
            projectFilePath,
            created: false,
            revision: current.revision,
          };
        }
        const nextState: CanvasState = {
          ...current.state,
          workbenchBasicNodes: basicNodes.map((node, index) => index === existingIndex ? updated : node),
        };
        await this.writeSnapshot(file, projectId, nextState, current.state);
        recordTaskCanvasGeneration(projectId, String(existing.id), projectFilePath, input);
        return {
          canvasNodeId: String(existing.id),
          projectFilePath,
          created: false,
          revision: await this.readRevision(file),
        };
      }

      const position = nextWorkflowArtifactPosition(basicNodes, instances);
      const canvasNodeId = chatCanvasNodeId(projectFilePath);
      const nextState: CanvasState = {
        ...current.state,
        workbenchBasicNodes: [
          ...basicNodes,
          {
            id: canvasNodeId,
            ...canvasArtifactProjection(descriptor),
            x: position.x,
            y: position.y,
            width: 420,
            height: 320,
            title: descriptor.title,
            projectFilePath,
            sourceMime: input.file.mime,
            artifact: descriptor,
          },
        ],
      };
      await this.writeSnapshot(file, projectId, nextState, current.state);
      recordTaskCanvasGeneration(projectId, canvasNodeId, projectFilePath, input);
      return {
        canvasNodeId,
        projectFilePath,
        created: true,
        revision: await this.readRevision(file),
      };
    });
  }

  private async writeSnapshot(
    file: string,
    projectId: string,
    state: CanvasState,
    previousState: CanvasState = {},
  ): Promise<void> {
    const payload: StoredCanvasState = {
      version: 1,
      projectId,
      updatedAt: new Date().toISOString(),
      state,
    };
    await mkdir(path.dirname(file), { recursive: true });
    await atomicWrite(file, `${JSON.stringify(payload, null, 2)}\n`);
    recordCanvasStateChanges(projectId, previousState, state, await this.readRevision(file), path.relative(path.dirname(path.dirname(file)), file));
  }

  private async stateFile(projectId: string): Promise<string> {
    const root = await this.resolveProjectRoot(projectId);
    if (!root) {
      throw new CanvasStateError(404, 'CANVAS_PROJECT_NOT_FOUND', 'project not found', { projectId });
    }
    if (!path.isAbsolute(root)) {
      throw new CanvasStateError(500, 'CANVAS_STORAGE_ERROR', 'project resolver returned a non-absolute root');
    }
    const relative = canvasStateRelativePath(root);
    assertProjectPathHasNoSymlinks(root, relative);
    return path.join(path.resolve(root), relative);
  }

  private async readSnapshot(file: string): Promise<CanvasStateSnapshot> {
    let raw: string;
    try {
      raw = await readFile(file, 'utf8');
    } catch (error) {
      if (isMissing(error)) return { state: {}, revision: 0 };
      throw error;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // 状态文件坏了不该让画布打不开——它是视图状态，丢了最多是节点回到
      // 默认布局。当成空状态继续，下一次写入自然覆盖修好。
      return { state: {}, revision: await this.readRevision(file) };
    }
    const state = (parsed as StoredCanvasState | null)?.state;
    if (state && Array.isArray(state.workbenchBasicNodes)) {
      const root = path.dirname(path.dirname(file));
      state.workbenchBasicNodes = state.workbenchBasicNodes.map((node) => {
        if (!node || node.kind !== 'text' || node.projectFilePath || typeof node.id !== 'string' || !/^[A-Za-z0-9_-]+$/.test(node.id)) return node;
        const legacy = `画布文本/${node.id}.md`;
        return { ...node, projectFilePath: existsSync(path.join(root, legacy)) ? legacy : canvasTextPath(node.id) };
      });
    }
    return {
      state: state && typeof state === 'object' && !Array.isArray(state) ? state : {},
      revision: await this.readRevision(file),
    };
  }

  private async readRevision(file: string): Promise<number> {
    try {
      return Math.trunc((await stat(file)).mtimeMs);
    } catch (error) {
      if (isMissing(error)) return 0;
      throw error;
    }
  }
}

function recordWorkflowCanvasGeneration(
  projectId: string,
  canvasNodeId: string,
  input: WorkflowCanvasArtifactInput,
): void {
  recordProjectLedgerObservation({
    projectId,
    type: 'canvas.generation.succeeded',
    actorType: 'agent',
    source: 'workflow',
    entityType: 'canvas_node',
    entityId: canvasNodeId,
    workflowRunId: input.workflowRunId,
    correlationId: input.workflowRunId,
    summary: `Workflow output materialized on canvas: ${input.title}`,
    payload: {
      kind: input.kind,
      workflowRunId: input.workflowRunId,
      stepRunId: input.stepRunId,
      sourceAgentStepRunId: input.sourceAgentStepRunId,
      sourceResultId: input.sourceResultId,
      sourceItemIds: input.sourceItemIds,
    },
    evidenceRefs: input.sourceResultId
      ? [{ kind: 'db_row', table: 'workflow_result_artifacts', id: input.sourceResultId }]
      : [],
    idempotencyKey: `canvas.workflow.materialized:${canvasNodeId}:${input.stepRunId}`,
  });
}

function recordTaskCanvasGeneration(
  projectId: string,
  canvasNodeId: string,
  projectFilePath: string,
  input: TaskCanvasArtifactInput,
): void {
  recordProjectLedgerObservation({
    projectId,
    type: 'canvas.generation.succeeded',
    actorType: 'agent',
    source: 'agent-adapter',
    entityType: 'canvas_node',
    entityId: canvasNodeId,
    correlationId: input.taskId,
    summary: `Task artifact materialized on canvas: ${projectFilePath}`,
    payload: { taskId: input.taskId, projectFilePath },
    evidenceRefs: [
      { kind: 'project_file', id: projectFilePath, path: projectFilePath },
    ],
    idempotencyKey: `canvas.task.materialized:${canvasNodeId}:${input.taskId}:${projectFilePath}`,
  });
}

async function syncCanvasTextDocuments(
  stateFile: string,
  nodes: readonly Record<string, unknown>[],
): Promise<void> {
  const projectRoot = path.dirname(path.dirname(stateFile));
  for (const node of nodes) {
    if (node.kind !== 'text' || typeof node.text !== 'string') continue;
    const id = typeof node.id === 'string' ? node.id : '';
    if (!/^[A-Za-z0-9_-]+$/u.test(id)) continue;
    const documentPath = canvasTextDocumentPath(node);
    const documentFile = path.join(projectRoot, ...documentPath.split('/'));
    let current = null;
    try {
      current = await readFile(documentFile, 'utf8');
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
    if (current === node.text) continue;
    await mkdir(path.dirname(documentFile), { recursive: true });
    await atomicWrite(documentFile, node.text);
  }
}

function canvasTextDocumentPath(node: Record<string, unknown>): string {
  const id = typeof node.id === 'string' ? node.id : '';
  if (!/^[A-Za-z0-9_-]+$/u.test(id)) throw new CanvasStateError(400, 'CANVAS_INVALID_INPUT', 'invalid canvas text node id');
  return typeof node.projectFilePath === 'string'
    ? normalizeSafeProjectFilePath(node.projectFilePath)
    : canvasTextPath(id);
}

function canvasTextForkPath(
  nodes: readonly Record<string, unknown>[],
  node: Record<string, unknown>,
  forkToken: string,
): string {
  const nodeId = String(node.id);
  const sharedPath = canvasTextDocumentPath(node);
  const otherPaths = new Set(nodes
    .filter(item => item.kind === 'text' && item.id !== node.id)
    .map(canvasTextDocumentPath));
  const ownPath = canvasTextPath(nodeId);
  if (ownPath !== sharedPath && !otherPaths.has(ownPath)) return ownPath;
  const digest = createHash('sha256').update(forkToken).digest('hex').slice(0, 10);
  return canvasTextPath(`${nodeId}-edit-${digest}`);
}

function canvasTextCandidateTargetPath(
  nodes: readonly Record<string, unknown>[],
  node: Record<string, unknown>,
  requestId: string,
): string {
  const sourcePath = canvasTextDocumentPath(node);
  const referenceCount = nodes.filter(item => item.kind === 'text' && canvasTextDocumentPath(item) === sourcePath).length;
  if (referenceCount > 1 || !isCanvasTextPath(sourcePath)) {
    return canvasTextForkPath(nodes, node, requestId);
  }
  return sourcePath;
}

/** Enforce copy-on-write even when an older client sends a whole canvas patch. */
function applyCanvasTextCopyOnWrite(
  currentNodes: readonly Record<string, unknown>[],
  nextNodes: readonly Record<string, unknown>[],
): Record<string, unknown>[] {
  const currentById = new Map(currentNodes.map(node => [node.id, node]));
  const boundNodes = nextNodes.map(node => {
    const current = currentById.get(node.id);
    return node.kind === 'text' && !node.projectFilePath && current?.kind === 'text'
      ? { ...node, projectFilePath: canvasTextDocumentPath(current) }
      : node;
  });
  const nextById = new Map(boundNodes.map(node => [node.id, node]));
  return boundNodes.map(node => {
    const current = currentById.get(node.id);
    if (
      node.kind !== 'text'
      || current?.kind !== 'text'
      || node.text === current.text
      || canvasTextDocumentPath(node) !== canvasTextDocumentPath(current)
    ) return node;
    const sharedPath = canvasTextDocumentPath(current);
    const sharedNodes = currentNodes.filter(item => item.kind === 'text' && canvasTextDocumentPath(item) === sharedPath);
    if (sharedNodes.length <= 1) return node;
    const sharedDocumentEdit = sharedNodes.every(item => {
      const next = nextById.get(item.id);
      return next?.kind === 'text'
        && canvasTextDocumentPath(next) === sharedPath
        && next.text === node.text;
    });
    if (sharedDocumentEdit) return node;
    const forkToken = JSON.stringify([node.id, current.text, node.text]);
    return { ...node, projectFilePath: canvasTextForkPath(nextNodes, node, forkToken) };
  });
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function arrayRecords(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter(item => item && typeof item === 'object' && !Array.isArray(item)) as Array<Record<string, unknown>>
    : [];
}

function sameJson(left: unknown, right: unknown): boolean {
  return Object.is(left, right) || JSON.stringify(left) === JSON.stringify(right);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function recordId(value: unknown): string | null {
  if (!isRecord(value)) return null;
  return typeof value.id === 'string' && value.id ? value.id : null;
}

/**
 * Apply the client's delta (`base` -> `local`) on top of the latest persisted
 * value (`remote`). Server-only additions survive, while explicit client edits
 * and deletions still win. Canvas collections use stable node ids; nested maps
 * such as task drafts use the same algorithm by property name.
 */
function mergeCanvasValue(base: unknown, local: unknown, remote: unknown): unknown {
  if (sameJson(base, local)) return remote;

  if (Array.isArray(base) && Array.isArray(local) && Array.isArray(remote)) {
    const identified = [...base, ...local, ...remote].every(item => recordId(item) !== null);
    if (!identified) return local;

    const baseById = new Map(base.map(item => [recordId(item)!, item]));
    const localById = new Map(local.map(item => [recordId(item)!, item]));
    const remoteById = new Map(remote.map(item => [recordId(item)!, item]));
    const mergedById = new Map(remoteById);

    for (const [id, baseItem] of baseById) {
      if (!localById.has(id)) {
        mergedById.delete(id);
        continue;
      }
      const localItem = localById.get(id);
      if (sameJson(baseItem, localItem)) continue;
      mergedById.set(id, mergeCanvasValue(baseItem, localItem, remoteById.get(id)));
    }
    for (const [id, localItem] of localById) {
      if (baseById.has(id)) continue;
      mergedById.set(id, localItem);
    }

    return [
      ...local.flatMap(item => {
        const id = recordId(item)!;
        return mergedById.has(id) ? [mergedById.get(id)] : [];
      }),
      ...remote.flatMap(item => {
        const id = recordId(item)!;
        return localById.has(id) || baseById.has(id) ? [] : [mergedById.get(id)];
      }),
    ];
  }

  if (isRecord(base) && isRecord(local) && isRecord(remote)) {
    const merged: Record<string, unknown> = { ...remote };
    for (const key of Object.keys(base)) {
      if (!Object.prototype.hasOwnProperty.call(local, key)) delete merged[key];
    }
    for (const [key, localValue] of Object.entries(local)) {
      if (!Object.prototype.hasOwnProperty.call(base, key)) {
        merged[key] = localValue;
        continue;
      }
      merged[key] = mergeCanvasValue(base[key], localValue, remote[key]);
    }
    return merged;
  }

  return local;
}

function workflowCanvasNodeId(workflowRunId: string, stepRunId: string): string {
  const stable = `${workflowRunId}-${stepRunId}`.replace(/[^A-Za-z0-9_-]/gu, '-');
  return `workflow-artifact-${stable}`;
}

function workflowResultArtifactPosition(
  state: CanvasState,
  sourceResultId?: string,
): { x: number; y: number } | null {
  if (!sourceResultId) return null;
  const positions = recordValue(state.workbenchWorkflowStagePositionsV2);
  const source = recordValue(positions[`workflow-result-${sourceResultId}`]);
  const x = typeof source.x === 'number' && Number.isFinite(source.x) ? source.x : null;
  const y = typeof source.y === 'number' && Number.isFinite(source.y) ? source.y : null;
  return x === null || y === null ? null : { x: x + 600, y };
}

function nextWorkflowArtifactPosition(
  basicNodes: Array<Record<string, unknown>>,
  instances: Array<Record<string, unknown>>,
): { x: number; y: number } {
  const nodes = [...basicNodes, ...instances];
  if (nodes.length === 0) return { x: 160, y: 120 };
  const rightmost = nodes.reduce((value, node) => {
    const x = typeof node.x === 'number' && Number.isFinite(node.x) ? node.x : 0;
    const width = typeof node.width === 'number' && Number.isFinite(node.width) ? node.width : 360;
    return Math.max(value, x + width);
  }, 0);
  return { x: rightmost + 80, y: 120 + (nodes.length % 3) * 72 };
}

/** Select exactly one durable deliverable; supporting files never become cards. */
export function selectPrimaryTaskCanvasArtifact(
  files: readonly ProjectFile[],
): ProjectFile | null {
  const candidates = files
    .filter(isSupportedTaskCanvasArtifact)
    .map(file => ({ file, rank: chatCanvasArtifactRank(file) }))
    .sort((left, right) => (
      left.rank - right.rank
      || Number(right.file.mtime || 0) - Number(left.file.mtime || 0)
    ));
  return candidates[0]?.file ?? null;
}

function isSupportedTaskCanvasArtifact(file: ProjectFile): boolean {
  if (file.type === 'dir') return false;
  if (file.artifactManifest?.status === 'error' || file.artifactManifest?.status === 'streaming') {
    return false;
  }
  const filePath = file.path ?? file.name;
  if (file.artifactManifest) return true;
  return [
    'html',
    'image',
    'video',
    'audio',
    'sketch',
    'pdf',
    'document',
    'presentation',
    'spreadsheet',
    'text',
  ].includes(file.kind) || /\.(?:html?|md|markdown|svg|pptx?|pdf|storyboard\.json)$/iu.test(filePath);
}

function chatCanvasArtifactRank(file: ProjectFile): number {
  if (manifestDeclaresPrimary(file)) return 0;
  const manifest = file.artifactManifest;
  if (manifest && manifest.metadata?.inferred !== true) return 1;
  if (manifest?.kind === 'deck' || file.kind === 'presentation') return 2;
  const filePath = file.path ?? file.name;
  if (/(^|\/)index\.html?$/iu.test(filePath)) return 3 + filePath.split('/').length / 100;
  if (file.kind === 'html' || /\.html?$/iu.test(filePath)) return 4;
  if (file.kind === 'image' || /\.svg$/iu.test(filePath)) return 5;
  if (file.kind === 'video') return 6;
  if (file.kind === 'pdf') return 7;
  if (file.kind === 'document' || /\.(?:md|markdown)$/iu.test(filePath)) return 8;
  if (file.kind === 'spreadsheet') return 9;
  if (file.kind === 'audio') return 10;
  if (file.kind === 'sketch') return 11;
  return 12;
}

function manifestDeclaresPrimary(file: ProjectFile): boolean {
  const manifest = file.artifactManifest;
  if (!manifest) return false;
  if (primaryValueTargetsFile(manifest.primary, file.path ?? file.name)) return true;
  const metadata = manifest.metadata;
  if (!metadata || typeof metadata !== 'object') return false;
  if (primaryValueTargetsFile(metadata.primary, file.path ?? file.name)) return true;
  const outputs = metadata.outputs;
  return Boolean(
    outputs
    && typeof outputs === 'object'
    && !Array.isArray(outputs)
    && primaryValueTargetsFile(
      (outputs as { primary?: unknown }).primary,
      file.path ?? file.name,
    ),
  );
}

function primaryValueTargetsFile(value: unknown, fileName: string): boolean {
  if (value === true) return true;
  if (typeof value !== 'string') return false;
  return normalizeComparableProjectFilePath(value) === normalizeComparableProjectFilePath(fileName);
}

function chatProjectFileArtifactDescriptor(
  projectId: string,
  file: ProjectFile,
  actual: { projectFilePath: string; size: number; mtimeMs: number },
): ArtifactDescriptor {
  const manifest = file.artifactManifest;
  const renderer = chatArtifactRenderer(file, actual.projectFilePath);
  const isDeck = manifest?.kind === 'deck' || file.artifactKind === 'deck' || file.kind === 'presentation';
  const title = String(manifest?.title || path.basename(actual.projectFilePath)).trim();
  return {
    id: `project-file:${actual.projectFilePath}`,
    projectId,
    title,
    summary: `${chatArtifactKindLabel(file, renderer, isDeck)} · ${formatFileSize(actual.size)}`,
    renderer,
    preview: { artifactFormat: isDeck ? 'presentation' : 'html' },
    resource: {
      kind: 'project-file',
      path: actual.projectFilePath,
      mimeType: file.mime,
    },
    ...(renderer === 'image' ? { thumbnail: { path: actual.projectFilePath } } : {}),
    capabilities: renderer === 'html' ? ['edit', 'export', 'download'] : ['download'],
    status: 'ready',
    updatedAt: new Date(actual.mtimeMs > 0 ? actual.mtimeMs : 0).toISOString(),
  };
}

function chatArtifactRenderer(file: ProjectFile, projectFilePath: string): ResultRenderer {
  const manifestRenderer = file.artifactManifest?.renderer;
  if (
    file.kind === 'html'
    || /\.html?$/iu.test(projectFilePath)
    || manifestRenderer === 'html'
    || manifestRenderer === 'deck-html'
    || manifestRenderer === 'mini-app'
  ) return 'html';
  if (file.kind === 'image' || manifestRenderer === 'svg' || manifestRenderer === 'diagram') return 'image';
  if (file.kind === 'video') return 'video';
  if (file.kind === 'audio') return 'audio';
  if (
    file.kind === 'document' || file.kind === 'text'
    || /\.(?:md|markdown)$/iu.test(projectFilePath)
    || manifestRenderer === 'markdown'
  ) return 'document';
  if (file.kind === 'code' || manifestRenderer === 'code' || manifestRenderer === 'react-component') {
    return 'code';
  }
  return 'file';
}

function chatArtifactKindLabel(
  file: ProjectFile,
  renderer: ResultRenderer,
  isDeck: boolean,
): string {
  if (isDeck) return '幻灯片';
  if (renderer === 'html') return '网页产物';
  if (renderer === 'image') return '图片';
  if (renderer === 'video') return '视频';
  if (renderer === 'audio') return '音频';
  if (renderer === 'document') return '文档';
  if (renderer === 'code') return '代码';
  if (file.kind === 'pdf') return 'PDF';
  if (file.kind === 'spreadsheet') return '表格';
  return '项目产物';
}

function canvasNodeProjectFilePath(node: Record<string, unknown>): string | null {
  if (typeof node.projectFilePath === 'string') {
    return normalizeComparableProjectFilePath(node.projectFilePath);
  }
  const artifact = recordValue(node.artifact);
  const resource = recordValue(artifact.resource);
  return resource.kind === 'project-file' && typeof resource.path === 'string'
    ? normalizeComparableProjectFilePath(resource.path)
    : null;
}

function normalizeSafeProjectFilePath(value: string): string {
  const normalized = String(value || '').replace(/\\/gu, '/').replace(/^\.\//u, '');
  if (
    !normalized
    || path.posix.isAbsolute(normalized)
    || normalized.split('/').some(segment => !segment || segment === '.' || segment === '..')
  ) {
    throw new CanvasStateError(400, 'CANVAS_INVALID_INPUT', 'invalid chat artifact project path');
  }
  return normalized;
}

function normalizeComparableProjectFilePath(value: string): string {
  return String(value || '').replace(/\\/gu, '/').replace(/^\.\//u, '');
}

function chatCanvasNodeId(projectFilePath: string): string {
  const digest = createHash('sha256').update(projectFilePath).digest('hex').slice(0, 20);
  return `chat-artifact-${digest}`;
}

function formatFileSize(size: number): string {
  if (!Number.isFinite(size) || size <= 0) return '项目文件';
  if (size < 1024) return `${Math.round(size)} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

async function atomicWrite(target: string, content: string): Promise<void> {
  const temporary = path.join(
    path.dirname(target),
    `.${path.basename(target)}.${process.pid}.${randomUUID()}.tmp`,
  );
  try {
    await writeFile(temporary, content, { encoding: 'utf8', flag: 'wx' });
    await rename(temporary, target);
  } catch (error) {
    throw new CanvasStateError(500, 'CANVAS_STORAGE_ERROR', 'failed to persist canvas state atomically', {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error
    && (error as NodeJS.ErrnoException).code === 'ENOENT';
}
