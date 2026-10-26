import { canvasImageModelId, canvasTextPath, isCanvasTextPath, canvasOperationsRequestSchema, type CanvasCardOperation, type CanvasOperation, type CanvasOperationReceipt, type CanvasOperationsResponse } from '@bezier/contracts';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { canvasStateRelativePath, assertProjectPathHasNoSymlinks } from '../project-layout.js';
import { mkdir, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { canvasArtifactProjection, withCanvasResultHistory, parseStoryboardGenerationResult, type StoryboardGenerationDefaults, type ReportStoryboardRequirements } from '@bezier/contracts';

import { CanvasStateError } from './errors.js';
import {
  findCanvasNodeSummary,
  recordCanvasStateChanges,
  renderCanvasContextPrompt,
  summarizeCanvasState,
} from './context.js';
import { ProjectSerialLock } from '../storage/project-serial-lock.js';
import { createCardEffect, isCardKindRegistered } from './card-ops.js';
import { applyCanvasOperations, assertCanvasMerge, assertCanvasReferences, records, type StoredCanvasOperation } from './operations.js';
import { canonical, equal, mergeCanvasValue as mergeOperationValue } from './merge.js';
import { prepareCanvasImage } from './image-operations.js';
import { prepareCanvasDocument } from './document-operations.js';
import { prepareCanvasSketch, prepareCanvasVideo, type CanvasSketchStore } from '@bezier/canvas-core';
import { ProjectSketchStore } from '../storage/canvas-sketches.js';
import { ProjectVideoStore } from '../storage/canvas-videos.js';
import { reconcileTextOperationReferences } from './text-operation-references.js';
import type { AssetLibraryAdapter } from '../asset-library/service.js';
import { recordProjectLedgerObservation } from '../project-ledger/active-recorder.js';
import { FileCanvasContent, FileCanvasPersistence, normalizeSafeProjectFilePath, type CanvasFileContent, type CanvasPersistence, type CanvasStoredBlob } from './persistence.js';
import { compactOperationJournal } from './operation-journal.js';
import type { CanvasItem, ImageOperation, DocumentOperation, SketchOperation, VideoOperation } from '@bezier/canvas-core';
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
  /** Canvas commit succeeded; these App-side side effects did not. */
  syncWarnings?: string[];
  mirrorPath?: string;
}

export interface CanvasPatchOptions {
  /** Server-only image App journal write; HTTP callers cannot supply this flag. */
  imageAppWrite?: boolean;
  /** Client revision used to produce `changes`; retained for conflict evidence. */
  expectedRevision?: number;
  /** Previous values for changed keys, enabling a lossless three-way merge. */
  base?: CanvasState;
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
  revision?: number;
  operations?: Record<string, StoredCanvasOperation>;
}

/** Side-effect handlers for asset-touching operations, bound per commit. */
export interface CanvasEffects {
  image: (op: ImageOperation, node?: CanvasItem) => Promise<CanvasItem>;
  document: (op: DocumentOperation, node?: CanvasItem) => Promise<CanvasItem>;
  sketch: (op: SketchOperation, node?: CanvasItem) => Promise<CanvasItem>;
  video: (op: VideoOperation, node?: CanvasItem) => Promise<CanvasItem>;
  /** Optional card-pack op dispatch (card.<team>.<name>.<verb>). */
  card?: (op: CanvasCardOperation, node: CanvasItem) => Promise<CanvasItem>;
}
export type CanvasEffectsFactory = (projectId: string, operationId: string) => CanvasEffects | Promise<CanvasEffects>;

export class CanvasStateService {
  private readonly lock = new ProjectSerialLock();
  private readonly persistence: CanvasPersistence;
  private readonly content: CanvasFileContent;
  private readonly effectsFactory: CanvasEffectsFactory | undefined;
  private readonly cardEntitlement: ((projectId: string) => Promise<string[] | undefined>) | undefined;
  private readonly sketchStore: ((projectId: string) => Promise<CanvasSketchStore | null>) | undefined;

  private readonly imageAssets: AssetLibraryAdapter | undefined;
  private readonly textDocumentSynced: ((projectId: string, node: Record<string, unknown>, revision: number, baseContent?: string) => Promise<void>) | undefined;
  private readonly documentNodesChanged: ((projectId: string, nodes: readonly Record<string, unknown>[]) => void | Promise<void>) | undefined;
  private readonly documentQueues = new Map<string, Promise<void>>();
  private readonly textDocumentPrepared: ((projectId: string, node: Record<string, unknown>, revision: number, baseContent?: string) => void | Promise<void>) | undefined;
  private readonly documentMirrorSaved: ((projectId: string, nodeId: string, docId: string, docRevision: string, content: string, path: string, canvasRevision: number) => void) | undefined;
  constructor(private readonly resolveProjectRoot: ResolveCanvasProjectRoot,
    private readonly readUsage?: (projectId: string) => import('@bezier/contracts').CanvasContextSummary['recentUsage'],
    imageAssets?: AssetLibraryAdapter,
    storage?: { persistence?: CanvasPersistence; content?: CanvasFileContent; effects?: CanvasEffectsFactory;
      cardEntitlement?: (projectId: string) => Promise<string[] | undefined>;
      /** When the sketch App is registered, sketch bytes go there. Null keeps the canvas store. */
      sketchStore?: (projectId: string) => Promise<CanvasSketchStore | null>;
      /** Mirror push: runs after a text node's file mirror is written so a
       * bound editor App (doc) gets the fresh content — App store is truth. */
      textDocumentSynced?: (projectId: string, node: Record<string, unknown>, revision: number, baseContent?: string) => Promise<void>;
      /** Reconcile binding presence after any committed write path (including UI PATCH). */
      documentNodesChanged?: (projectId: string, nodes: readonly Record<string, unknown>[]) => void | Promise<void>;
      textDocumentPrepared?: (projectId: string, node: Record<string, unknown>, revision: number, baseContent?: string) => void | Promise<void>;
      documentMirrorSaved?: (projectId: string, nodeId: string, docId: string, docRevision: string, content: string, path: string, canvasRevision: number) => void }) {
    this.imageAssets = imageAssets;
    this.persistence = storage?.persistence ?? new FileCanvasPersistence(resolveProjectRoot);
    this.content = storage?.content ?? new FileCanvasContent(resolveProjectRoot);
    this.effectsFactory = storage?.effects;
    this.cardEntitlement = storage?.cardEntitlement;
    this.sketchStore = storage?.sketchStore;
    this.textDocumentSynced = storage?.textDocumentSynced;
    this.documentNodesChanged = storage?.documentNodesChanged;
    this.textDocumentPrepared = storage?.textDocumentPrepared;
    this.documentMirrorSaved = storage?.documentMirrorSaved;
  }
  get hasOperationImageAssets(): boolean { return Boolean(this.imageAssets); }

  async read(projectId: string): Promise<CanvasStateSnapshot> {
    const stored = await this.persistence.load(projectId);
    return { state: stored.state, revision: stored.revision };
  }

  async revision(projectId: string): Promise<number> {
    return (await this.persistence.load(projectId)).revision;
  }

  /** Media delivery shares the exact serialization boundary with canvas edits. */
  async updateMediaState(projectId: string, update: (state: CanvasState) => CanvasState): Promise<CanvasStateSnapshot> {
    return this.withDocumentChanges(projectId, async () => {
      const current = await this.persistence.load(projectId);
      const next = update(current.state);
      if (next === current.state) return { state: current.state, revision: current.revision };
      const revision = Math.max(current.revision + 1, Date.now());
      await this.commit(projectId, { ...current, state: next, revision });
      recordCanvasStateChanges(projectId, current.state, next, revision, await this.persistence.describe(projectId));
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
  async linkTextCandidate(projectId: string, input: { nodeId: string; requestId: string; runId: string; content: string; baseDigest?:string }): Promise<CanvasStateSnapshot> {
    return this.lock.run(projectId, async () => {
      const current = await this.persistence.load(projectId);
      const nodes = arrayRecords(current.state.workbenchBasicNodes);
      const node = nodes.find(item => item.id === input.nodeId && item.kind === 'text');
      if (!node) throw new CanvasStateError(404, 'CANVAS_NODE_NOT_FOUND', '原文本卡已不存在，候选仍保留');
      const generation = recordValue(node.generation);
      if (generation.appliedRequestId === input.requestId) return { state: current.state, revision: current.revision };
      if (generation.requestId !== input.requestId) throw new CanvasStateError(409, 'CANVAS_TEXT_CONFLICT', '当前任务已改变，候选仍保留');
      if (generation.candidateText === input.content && generation.runId === input.runId && generation.status === 'succeeded') return { state: current.state, revision: current.revision };
      if (input.baseDigest && input.baseDigest !== `sha256:${createHash('sha256').update(typeof node.text === 'string' ? node.text : '').digest('hex')}`) {
        throw new CanvasStateError(409, 'MF_TARGET_STALE', 'MF text target changed; candidate linking rejected');
      }
      const nextNode = { ...node, generation: { ...generation, status: 'succeeded', candidateText: input.content, runId: input.runId, error: undefined } };
      const next = { ...current.state, workbenchBasicNodes: nodes.map(item => item.id === input.nodeId ? nextNode : item) };
      const revision = Math.max(current.revision + 1, Date.now());
      await this.commit(projectId, { ...current, state: next, revision });
      recordCanvasStateChanges(projectId, current.state, next, revision, await this.persistence.describe(projectId));
      return { state: next, revision };
    });
  }

  async failTextDelivery(projectId: string, input: { nodeId: string; requestId: string; runId: string; error: string }): Promise<void> {
    await this.lock.run(projectId, async () => {
      const current = await this.persistence.load(projectId);
      const nodes = arrayRecords(current.state.workbenchBasicNodes);
      const node = nodes.find(item => item.id === input.nodeId);
      if (!node) return;
      const generation = recordValue(node.generation);
      if (generation.requestId !== input.requestId || generation.appliedRequestId === input.requestId) return;
      const next = { ...current.state, workbenchBasicNodes: nodes.map(item => item.id === input.nodeId
        ? { ...item, generation: { ...generation, runId: input.runId, status: 'failed', error: input.error } } : item) };
      const revision = Math.max(current.revision + 1, Date.now());
      await this.commit(projectId, { ...current, state: next, revision });
      recordCanvasStateChanges(projectId, current.state, next, revision, await this.persistence.describe(projectId));
    });
  }

  /** Backend delivery survives closing chat; a changed/deleted target is never recreated. */
  async applyStoryboardCandidate(projectId: string, input: { nodeId: string; requestId: string; runId: string; content: string }): Promise<CanvasStateSnapshot> {
    return this.lock.run(projectId, async () => {
      const current = await this.persistence.load(projectId);
      const nodes = arrayRecords(current.state.workbenchBasicNodes);
      const node = nodes.find(item => item.id === input.nodeId && item.kind === 'storyboard');
      if (!node) throw new CanvasStateError(404, 'CANVAS_NODE_NOT_FOUND', '原分镜卡已不存在，候选仍保留');
      const generation = recordValue(node.generation);
      if (generation.appliedRequestId === input.requestId) return { state: current.state, revision: current.revision };
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
      const revision = Math.max(current.revision + 1, Date.now());
      await this.commit(projectId, { ...current, state: next, revision });
      recordCanvasStateChanges(projectId, current.state, next, revision, await this.persistence.describe(projectId));
      return { state: next, revision };
    });
  }

  /** Adopt an existing answer, never execute the model. Compare inside the canvas lock. */
  async applyTextCandidate(projectId: string, input: { nodeId: string; requestId: string; baseDigest: string; content: string }): Promise<CanvasStateSnapshot> {
    if (!/^[A-Za-z0-9_-]+$/u.test(input.nodeId) || !input.content.trim()) throw new CanvasStateError(400, 'CANVAS_INVALID_INPUT', '无效的文本候选');
    return this.withDocumentChanges(projectId, async () => {
      const current = await this.persistence.load(projectId);
      const nodes = arrayRecords(current.state.workbenchBasicNodes);
      const node = nodes.find(item => item.id === input.nodeId && item.kind === 'text');
      if (!node) throw new CanvasStateError(404, 'CANVAS_NODE_NOT_FOUND', '原文本卡已不存在，候选仍保留');
      const generation = recordValue(node.generation);
      if (generation.appliedRequestId === input.requestId) return { state: current.state, revision: current.revision };
      const text = typeof node.text === 'string' ? node.text : '';
      if (`sha256:${createHash('sha256').update(text).digest('hex')}` !== input.baseDigest
        || (generation.requestId && generation.requestId !== input.requestId)) {
        throw new CanvasStateError(409, 'CANVAS_TEXT_CONFLICT', '原文或当前任务已改变，未覆盖；候选仍保留');
      }
      const sourceDocumentPath = canvasTextDocumentPath(node);
      const documentPath = canvasTextCandidateTargetPath(nodes, node, input.requestId);
      const stored = await this.content.read(projectId, sourceDocumentPath);
      // The candidate value is also accepted to recover an interrupted two-file save.
      if (stored !== null && stored !== text && stored !== input.content) throw new CanvasStateError(409, 'CANVAS_TEXT_CONFLICT', '项目文档已修改，未覆盖');
      const nextNode = withCanvasResultHistory(node, {
        text: input.content,
        projectFilePath: documentPath,
        generation: { requestId: input.requestId, status: 'succeeded', appliedRequestId: input.requestId },
      }, documentPath === sourceDocumentPath ? ['text'] : ['text', 'projectFilePath']);
      const next = { ...current.state, workbenchBasicNodes: nodes.map(item => item.id === input.nodeId ? nextNode : item) };
      await this.syncTextDocuments(projectId, [nextNode]);
      const revision = Math.max(current.revision + 1, Date.now());
      await this.commit(projectId, { ...current, state: next, revision });
      recordCanvasStateChanges(projectId, current.state, next, revision, await this.persistence.describe(projectId));
      return { state: next, revision };
    });
  }

  async context(projectId: string) {
    const snapshot = await this.read(projectId);
    const summary = summarizeCanvasState(projectId, snapshot.state, snapshot.revision, Number.MAX_SAFE_INTEGER);
    const recentUsage = this.readUsage?.(projectId);
    return recentUsage?.length ? { ...summary, recentUsage } : summary;
  }

  async contextPrompt(projectId: string): Promise<string> {
    return renderCanvasContextPrompt(await this.context(projectId));
  }

  async node(projectId: string, nodeId: string) {
    const snapshot = await this.read(projectId);
    return findCanvasNodeSummary(projectId, snapshot.state, snapshot.revision, nodeId);
  }

  /**
   * Legacy canvases use mtime; once operations introduce a persisted revision,
   * every writer advances that revision while retaining the operation journal.
   * Unchanged PATCHes still return without writing.
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
    if (keys.some(key=>['workbenchImageReceipts','workbenchImageEdits','workbenchImageReferenceReceipts'].includes(key)) && !options.imageAppWrite) {
      throw new CanvasStateError(403, 'IMAGE_RECEIPT_READ_ONLY', 'Image receipts can only be written through image App actions');
    }
    if (keys.length === 0) {
      throw new CanvasStateError(400, 'CANVAS_INVALID_INPUT', 'state changes must be a non-empty object');
    }
    if (keys.some((key) => !key || key.startsWith('__'))) {
      throw new CanvasStateError(400, 'CANVAS_INVALID_INPUT', 'invalid state key');
    }

    return this.withDocumentChanges(projectId, async () => {
      const current = await this.persistence.load(projectId);
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
        // An absent collection is the same empty collection observed by a new canvas.
        // Do not turn a first insertion into a false conflict, but still reject
        // concurrent same-ID inserts once a remote collection actually exists.
        const base = options.base?.[key];
        const emptyDefault = base === null ? null : Array.isArray(base) ? [] : isRecord(base) && Object.keys(base).length === 0 ? {} : undefined;
        const remote = next[key] ?? (hasBase ? emptyDefault : undefined);
        if (hasBase && !sameJson(options.base?.[key], value)) assertCanvasMerge(options.base?.[key], value, remote, key);
        const merged = hasBase
          ? mergeCanvasValue(options.base?.[key], value, remote)
          : value;
        if (sameJson(next[key], merged)) continue;
        next[key] = merged;
        dirty = true;
      }
      if (!dirty) return { state: current.state, revision: current.revision };

      next = reconcileSketchFileReferences(next);
      if (keys.includes('workbenchBasicNodes')) {
        next.workbenchBasicNodes = applyCanvasTextCopyOnWrite(
          arrayRecords(current.state.workbenchBasicNodes),
          arrayRecords(next.workbenchBasicNodes),
        );
        await this.syncTextDocuments(projectId, arrayRecords(next.workbenchBasicNodes));
      }

      const revision = Math.max(current.revision + 1, Date.now());
      await this.commit(projectId, { ...current, state: next, revision });
      recordCanvasStateChanges(projectId, current.state, next, revision, await this.persistence.describe(projectId));
      return { state: next, revision };
    });
  }

  /** Attaches an immutable remote Image App asset as a native workbench image.
   * Canvas persists only layout, the verified reference metadata, an
   * authenticated preview URL and its own durable receipt; Image workspaces,
   * config, jobs, edits and bytes stay remotely authoritative. Remote
   * resolution happens inside the commit lock after local checks; a completed
   * receipt replays the original ack without recreating a deleted node. */
  async attachImageReference(
    projectId: string,
    input: ImageReferenceAttachInput,
    options: { resolve: () => Promise<ImageReferenceResolution> },
  ): Promise<ImageReferenceAttachResult> {
    if (!input || typeof input !== 'object' || Array.isArray(input))
      throw new CanvasStateError(400, 'CANVAS_INVALID_INPUT', 'image reference input must be an object');
    for (const key of Object.keys(input))
      if (!IMAGE_REFERENCE_INPUT_FIELDS.includes(key as never)) throw new CanvasStateError(400, 'CANVAS_INVALID_INPUT', 'image reference input carries unknown fields');
    if (typeof input.applicationInstanceId !== 'string' || !MA_ID_PATTERN.test(input.applicationInstanceId))
      throw new CanvasStateError(400, 'CANVAS_INVALID_INPUT', 'image application instance id is invalid');
    if (typeof input.workspaceId !== 'string' || !IMAGE_WORKSPACE_ID.test(input.workspaceId))
      throw new CanvasStateError(400, 'CANVAS_INVALID_INPUT', 'image workspace id is invalid');
    if (typeof input.assetId !== 'string' || !IMAGE_ASSET_ID.test(input.assetId))
      throw new CanvasStateError(400, 'CANVAS_INVALID_INPUT', 'image asset id is invalid');
    if (typeof input.x !== 'number' || !Number.isFinite(input.x) || typeof input.y !== 'number' || !Number.isFinite(input.y))
      throw new CanvasStateError(400, 'CANVAS_INVALID_INPUT', 'image reference coordinates must be finite numbers');
    if (input.name !== undefined && (typeof input.name !== 'string' || input.name.length > 500))
      throw new CanvasStateError(400, 'CANVAS_INVALID_INPUT', 'image reference name is invalid');
    if (typeof input.expectedRevision !== 'number' || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0)
      throw new CanvasStateError(400, 'CANVAS_INVALID_INPUT', 'image reference expectedRevision must be a safe integer');
    if (typeof input.idempotencyKey !== 'string' || !/^[^\x00-\x1f\x7f]{1,128}$/u.test(input.idempotencyKey))
      throw new CanvasStateError(400, 'CANVAS_INVALID_INPUT', 'image reference idempotency key must be 1-128 characters');
    if (typeof input.callerScope !== 'string' || !/^[0-9a-f]{64}$/.test(input.callerScope))
      throw new CanvasStateError(400, 'CANVAS_INVALID_INPUT', 'image reference callerScope must be a sha256 hex digest');
    if (!options || typeof options.resolve !== 'function')
      throw new CanvasStateError(400, 'CANVAS_INVALID_INPUT', 'an image reference resolver is required');
    const snapshot = await this.withDocumentChanges(projectId, async (): Promise<CanvasStateSnapshot & { imageReferenceResult?: ImageReferenceAttachResult }> => {
      const current = await this.persistence.load(projectId);
      const rawReferenceReceipts=current.state.workbenchImageReferenceReceipts;
      if(rawReferenceReceipts!==undefined&&(!rawReferenceReceipts||typeof rawReferenceReceipts!=='object'||Array.isArray(rawReferenceReceipts)))throw new CanvasStateError(503,'IMAGE_REFERENCE_JOURNAL_CORRUPT','Image reference receipts are invalid');
      const receipts = recordValue(current.state.workbenchImageReferenceReceipts);
      const journalKey = `${input.callerScope}:${input.idempotencyKey}`;
      const fingerprint = createHash('sha256').update(canonical({
        applicationInstanceId: input.applicationInstanceId, workspaceId: input.workspaceId, assetId: input.assetId,
        x: input.x, y: input.y, name: input.name ?? null, expectedRevision: input.expectedRevision,
        callerScope: input.callerScope, idempotencyKey: input.idempotencyKey, baseRevision: input.expectedRevision,
      })).digest('hex');
      const stored = recordValue(receipts[journalKey]);
      if (Object.hasOwn(receipts,journalKey)) {
        if(!/^[0-9a-f]{64}$/.test(String(stored.fingerprint??''))||!/^ir[0-9a-f]{32}$/.test(String(stored.receiptId??''))||!/^imref-[0-9a-f]{32}$/.test(String(stored.nodeId??''))||!Number.isSafeInteger(stored.revision)||Number(stored.revision)<0)throw new CanvasStateError(503,'IMAGE_REFERENCE_JOURNAL_CORRUPT','Image reference receipt is invalid');
        try{assertImageAssetReference(stored.reference);}catch{throw new CanvasStateError(503,'IMAGE_REFERENCE_JOURNAL_CORRUPT','Image reference receipt resource is invalid');}
        if (stored.fingerprint !== fingerprint)
          throw new CanvasStateError(409, 'IMAGE_REFERENCE_KEY_CONFLICT', 'idempotency key was used with a different image reference input');
        return {
          state: current.state, revision: current.revision,
          imageReferenceResult: {
            receiptId: String(stored.receiptId), nodeId: String(stored.nodeId),
            revision: Number(stored.revision),
            reference: recordValue(stored.reference) as unknown as ImageAssetReference,
            replayed: true,
          },
        };
      }
      if (input.expectedRevision !== current.revision)
        throw new CanvasStateError(409, 'CANVAS_REVISION_CONFLICT', 'canvas revision conflict', { expectedRevision: input.expectedRevision, actualRevision: current.revision });
      const nodeId = `imref-${createHash('sha256').update(canonical({projectId,key:input.idempotencyKey,callerScope: input.callerScope, applicationInstanceId: input.applicationInstanceId, workspaceId: input.workspaceId, assetId: input.assetId })).digest('hex').slice(0, 32)}`;
      const nodes = [...arrayRecords(current.state.workbenchImages), ...arrayRecords(current.state.workbenchBasicNodes), ...arrayRecords(current.state.workbenchInstances)];
      if (nodes.some(node => node.id === nodeId))
        throw new CanvasStateError(409, 'IMAGE_REFERENCE_COLLISION', 'deterministic image reference node id already exists');
      const resolved = await options.resolve();
      const reference = assertImageAssetReference(resolved?.reference);
      if (reference.applicationInstanceId !== input.applicationInstanceId || reference.workspaceId !== input.workspaceId || reference.assetId !== input.assetId)
        throw new CanvasStateError(409, 'IMAGE_REFERENCE_MISMATCH', 'resolved image reference does not match the requested asset');
      const preview = typeof resolved?.previewUrl === 'function' ? resolved.previewUrl(nodeId) : '';
      if (typeof preview !== 'string' || preview.length > 2000 || !preview.startsWith(`/api/projects/${encodeURIComponent(projectId)}/`))
        throw new CanvasStateError(502, 'IMAGE_REFERENCE_PREVIEW_INVALID', 'preview URL must stay on this project’s authenticated canvas route');
      if (Object.keys(receipts).length >= 256)
        throw new CanvasStateError(503, 'IMAGE_RECEIPT_CAPACITY', 'image reference receipt capacity reached');
      const revision = Math.max(current.revision + 1, Date.now());
      const receiptId = `ir${createHash('sha256').update(canonical({ projectId, journalKey, nodeId, reference })).digest('hex').slice(0, 32)}`;
      const entry = {
        id: nodeId, x: input.x, y: input.y, name: input.name ?? reference.assetId,
        src: preview, status: 'ready',
        naturalWidth: reference.width, naturalHeight: reference.height,
        imageReference: reference,
      };
      const next = {
        ...current.state,
        workbenchImages: [...arrayRecords(current.state.workbenchImages), entry],
        workbenchImageReferenceReceipts: {
          ...receipts,
          [journalKey]: { receiptId, nodeId, revision, fingerprint, reference, createdAt: new Date().toISOString() },
        },
      };
      await this.commit(projectId, { ...current, state: next, revision });
      recordCanvasStateChanges(projectId, current.state, next, revision, await this.persistence.describe(projectId));
      return { state: next, revision, imageReferenceResult: { receiptId, nodeId, revision, reference, replayed: false } };
    });
    return snapshot.imageReferenceResult as ImageReferenceAttachResult;
  }

  /** Receipts live in the canvas document so operation replay survives process restarts. */
  async operation(projectId: string, operationId: string): Promise<CanvasOperationReceipt> {
    const stored = (await this.persistence.load(projectId)).operations ?? {};
    const entry = Object.hasOwn(stored, operationId) ? stored[operationId] : undefined;
    if (!entry) throw new CanvasStateError(404, 'CANVAS_OPERATION_NOT_FOUND', 'Operation not found');
    return entry.receipt;
  }

  async applyOperations(projectId: string, input: unknown): Promise<CanvasOperationsResponse & Pick<CanvasStateSnapshot, 'syncWarnings'>> {
    const parsed = canvasOperationsRequestSchema.safeParse(input);
    if (!parsed.success) throw new CanvasStateError(400, 'CANVAS_INVALID_INPUT', 'Invalid canvas operation', { issues: parsed.error.issues });
    const request = parsed.data;
    const fingerprint = createHash('sha256').update(canonical(request)).digest('hex');
    // Card-kind gate: a `card.<team>.<name>` create must come from a mounted
    // pack the calling scope is entitled to. Unrestricted when no grant row
    // exists; an explicit grant (even []) is authoritative.
    const createdCardKinds = request.operations
      .filter(op => op.type === 'node.create')
      .map(op => (op as { node?: { kind?: string } }).node?.kind)
      .filter((kind): kind is string => typeof kind === 'string');
    if (createdCardKinds.length) {
      const unregistered = createdCardKinds.filter(kind => kind.startsWith('card.') && !isCardKindRegistered(kind));
      if (unregistered.length) throw new CanvasStateError(403, 'CARD_KIND_NOT_ALLOWED', `Card kind not provided by any mounted pack: ${unregistered.join(', ')}`);
      const allowed = this.cardEntitlement ? await this.cardEntitlement(projectId) : undefined;
      if (allowed && !allowed.includes('*')) {
        const denied = createdCardKinds.filter(kind => !allowed.includes(kind));
        if (denied.length) throw new CanvasStateError(403, 'CARD_KIND_NOT_ALLOWED', `Card kind not granted for this scope: ${denied.join(', ')}`);
      }
    }
    const effects = await this.effects(projectId, request.operationId);
    return this.withDocumentChanges(projectId, async () => {
      const current = await this.persistence.load(projectId);
      const journal = current.operations ?? {};
      const previous = Object.hasOwn(journal, request.operationId) ? journal[request.operationId] : undefined;
      if (previous) {
        if (previous.fingerprint !== fingerprint) throw new CanvasStateError(409, 'CANVAS_OPERATION_ID_CONFLICT', 'Operation ID was used with different input');
        return { ok: true, state: current.state, revision: current.revision, receipt: previous.receipt, replayed: true };
      }
      if (request.baseRevision !== current.revision && !request.expectedState) throw new CanvasStateError(409, 'CANVAS_REVISION_CONFLICT', 'Canvas revision changed', { actualRevision: current.revision });
      const granted=await this.cardEntitlement?.(projectId);
      if(granted&&!granted.includes('*')){
        const nodes=[...records(current.state.workbenchBasicNodes),...records(current.state.workbenchImages).map(node=>({...node,kind:'image'}))];
        for(const op of request.operations){
          const record=op as Record<string,unknown>;
          const target=nodes.find(node=>node.id===record.nodeId);
          const kind=typeof target?.kind==='string'?target.kind:op.type.startsWith('image.')?'image':op.type.startsWith('video.')?'video':op.type.startsWith('sketch.')?'sketch':op.type.startsWith('storyboard.')?'storyboard':op.type==='document.create'?(record.format==='presentation'?'presentation':'page'):undefined;
          if(kind&&!granted.includes(kind))throw new CanvasStateError(403,'CARD_KIND_NOT_ALLOWED',`Card kind not granted for this scope: ${kind}`);
        }
      }
      const draft = { ...current.state, ...request.expectedState };
      const applied = await applyCanvasOperations(draft, request.operations as (CanvasOperation | CanvasCardOperation)[], journal, effects.image, effects.document, effects.sketch, effects.video, effects.card);
      for (const key of applied.keys) {
        if (!request.expectedState || !Object.hasOwn(request.expectedState, key)) {
          if (request.baseRevision !== current.revision) throw new CanvasStateError(409, 'CANVAS_REVISION_CONFLICT', 'Missing base state for changed collection', { field: key, actualRevision: current.revision });
          continue;
        }
        const base = request.expectedState[key as keyof typeof request.expectedState];
        assertCanvasMerge(base, applied.state[key], current.state[key] ?? [], key);
        applied.state[key] = mergeOperationValue(base, applied.state[key], current.state[key] ?? []);
      }
      assertCanvasReferences(current.state, applied.state);
      const nodeIds = new Set([...records(applied.state.workbenchBasicNodes), ...records(applied.state.workbenchImages)].map(node => node.id));
      const oldEdges = records(current.state.workbenchEdges);
      for (const edge of records(applied.state.workbenchEdges)) {
        if (!oldEdges.some(old => equal(old, edge)) && (!nodeIds.has(String(edge.source)) || !nodeIds.has(String(edge.target)))) {
          throw new CanvasStateError(409, 'CANVAS_REVISION_CONFLICT', 'Connection target was removed', { edgeId: edge.id });
        }
      }
      const oldNodes = records(current.state.workbenchBasicNodes);
      if (applied.keys.includes('workbenchBasicNodes')) {
        applied.state.workbenchBasicNodes = records(applied.state.workbenchBasicNodes).map(node => {
          const old = oldNodes.find(item => item.id === node.id);
          return node.kind !== 'text' || (old && old.text === node.text)
            ? node : { ...node, projectFilePath: canvasTextPath(`${node.id}-op-${fingerprint.slice(0, 16)}`) };
        });
      }
      const reconciled = reconcileTextOperationReferences(reconcileSketchFileReferences(applied.state), current.state);
      if (!equal(reconciled.workbenchBasicNodes, applied.state.workbenchBasicNodes) && !applied.keys.includes('workbenchBasicNodes')) applied.keys.push('workbenchBasicNodes');
      applied.state = reconciled;
      // Compatibility aliases may also update edge-derived task draft paths.
      if (!equal(applied.state.workbenchTaskDrafts, current.state.workbenchTaskDrafts) && !applied.keys.includes('workbenchTaskDrafts')) applied.keys.push('workbenchTaskDrafts');
      const before = Object.fromEntries(applied.keys.map(key => [key, current.state[key] ?? []]));
      const after = Object.fromEntries(applied.keys.map(key => [key, applied.state[key] ?? []]));
      const revision = Math.max(current.revision + 1, Date.now());
      const receipt: CanvasOperationReceipt = { operationId: request.operationId, status: equal(before, after) ? 'noop' : 'applied', baseRevision: current.revision, revision, nodeIds: applied.nodeIds, createdAt: new Date().toISOString() };
      // Write immutable operation-specific text snapshots before publishing the canvas;
      // a failed batch can leave an orphan file but cannot alter the prior document.
      if (applied.keys.includes('workbenchBasicNodes')) {
        await this.syncTextDocuments(projectId, records(applied.state.workbenchBasicNodes).filter(node => !equal(node, oldNodes.find(item => item.id === node.id))));
      }
      await this.commit(projectId, { ...current, updatedAt: receipt.createdAt, state: applied.state, revision,
        operations: compactOperationJournal({ ...journal, [request.operationId]: { fingerprint, receipt, before, after } }) }, request.operationId);
      // The asset index is advisory; its immutable version binding is already in the canvas.
      for (const node of records(applied.state.workbenchImages)) {
        const source = node.sourceAsset as { assetId?: string; versionId?: string } | undefined;
        const assets = this.imageAssets;
        if (assets && source?.assetId && source.versionId && typeof node.path === 'string'
          && !equal(node, records(current.state.workbenchImages).find(item => item.id === node.id))) {
          try { await assets.recordUse(source.assetId, { projectId, filename: node.path, versionId: source.versionId, usedAt: Date.now() }); }
          catch { /* The authoritative version binding remains in the canvas document. */ }
        }
      }
      recordCanvasStateChanges(projectId, current.state, applied.state, revision, await this.persistence.describe(projectId));
      return { ok: true, state: applied.state, revision, receipt, replayed: false };
    });
  }

  /** Effect handlers bound to this canvas's backend. Default: project-filesystem
   * stores; the Appwrite backend injects bucket+index stores at construction. */
  private async effects(projectId: string, operationId: string): Promise<CanvasEffects> {
    const card = createCardEffect({ projectId, files: this.content });
    const remoteSketch = this.sketchStore ? await this.sketchStore(projectId) : null;
    const sketch = remoteSketch
      ? (op: SketchOperation, node?: CanvasItem) => prepareCanvasSketch(remoteSketch, operationId, op, node)
      : undefined;
    if (this.effectsFactory) return { ...await this.effectsFactory(projectId, operationId), card, ...(sketch ? { sketch } : {}) };
    const root = await this.requireRoot(projectId);
    return {
      image: (op, node) => prepareCanvasImage(root, projectId, operationId, op, node, this.imageAssets),
      document: (op, node) => prepareCanvasDocument(root, operationId, op, node),
      sketch: sketch ?? ((op, node) => prepareCanvasSketch(new ProjectSketchStore(root), operationId, op, node)),
      video: (op, node) => prepareCanvasVideo(new ProjectVideoStore(root), operationId, op, node),
      card,
    };
  }

  private async requireRoot(projectId: string): Promise<string> {
    const root = await this.resolveProjectRoot(projectId);
    if (!root) throw new CanvasStateError(404, 'CANVAS_PROJECT_NOT_FOUND', 'project not found', { projectId });
    if (!path.isAbsolute(root)) throw new CanvasStateError(500, 'CANVAS_STORAGE_ERROR', 'project resolver returned a non-absolute root');
    return path.resolve(root);
  }

  private async commit(projectId: string, blob: CanvasStoredBlob, changedOperationId?: string): Promise<void> {
    await this.assertAllowedChanges(projectId,(await this.persistence.load(projectId)).state,blob.state);
    if (this.textDocumentPrepared) {
      const previous = arrayRecords((await this.persistence.load(projectId)).state.workbenchBasicNodes);
      for (const node of arrayRecords(blob.state.workbenchBasicNodes)) {
        if (node.kind !== 'text' || typeof node.text !== 'string') continue;
        const old = previous.find(item => item.id === node.id && item.kind === 'text');
        if (old && old.text === node.text && canvasTextDocumentPath(old) === canvasTextDocumentPath(node)) continue;
        // Persist intent first. The worker will never deliver until this exact
        // committed content exists; a crash cannot turn an uncommitted draft
        // into a document write.
        await this.textDocumentPrepared(projectId, { ...node, projectFilePath: canvasTextDocumentPath(node) }, blob.revision,
          typeof old?.text === 'string' ? old.text : undefined);
      }
    }
    await this.persistence.commit(projectId, blob, changedOperationId);
  }

  private async assertAllowedChanges(projectId:string,previous:CanvasState,next:CanvasState):Promise<void>{
    const allowed=await this.cardEntitlement?.(projectId);
    if(!allowed||allowed.includes('*'))return;
    for(const [key,fallback] of [['workbenchBasicNodes',''],['workbenchImages','image']] as const){
      const old=records(previous[key]);
      for(const node of records(next[key])){
        const kind=typeof node.kind==='string'?node.kind:fallback;
        if(kind&&!allowed.includes(kind)&&!old.some(item=>item.id===node.id&&equal(item,node)))
          throw new CanvasStateError(403,'CARD_KIND_NOT_ALLOWED',`Card kind not granted for this scope: ${kind}`);
      }
    }
  }

  /** App callbacks run AFTER releasing the transaction lock: a doc write can
   * synchronously call the canvas file bridge back without deadlocking. */
  private async withDocumentChanges<T extends CanvasStateSnapshot>(projectId: string, write: () => Promise<T>): Promise<T> {
    let before: Record<string, unknown>[] = [];
    const result = await this.lock.run(projectId, async () => {
      before = arrayRecords((await this.persistence.load(projectId)).state.workbenchBasicNodes);
      return write();
    });
    const after = arrayRecords(result.state.workbenchBasicNodes);
    const syncWarnings: string[] = [];
    const pending = (this.documentQueues.get(projectId) ?? Promise.resolve()).then(async () => {
      const latestState = (await this.persistence.load(projectId)).state;
      const latest = arrayRecords(latestState.workbenchBasicNodes);
      await this.documentNodesChanged?.(projectId, [...latest, ...arrayRecords(latestState.workbenchImages)]);
      for (const node of after) {
        if (node.kind !== 'text' || typeof node.text !== 'string') continue;
        const previous = before.find(old => old.id === node.id && old.kind === 'text');
        if (previous && previous.text === node.text && canvasTextDocumentPath(previous) === canvasTextDocumentPath(node)) continue;
        const live = latest.find(current => current.id === node.id && current.kind === 'text');
        if (!live || live.text !== node.text || canvasTextDocumentPath(live) !== canvasTextDocumentPath(node)) continue;
        try { await this.textDocumentSynced?.(projectId, { ...node, projectFilePath: canvasTextDocumentPath(live) }, result.revision, typeof previous?.text === 'string' ? previous.text : undefined); }
        catch (error) {
          syncWarnings.push(`Card ${String(node.id)}: canvas saved, document synchronization failed: ${error instanceof Error ? error.message : String(error)}`);
          console.warn('[textDocumentSynced] canvas saved; App synchronization failed', error);
        }
      }
    });
    const settled = pending.catch(error => console.warn('[document-bindings] reconciliation failed', error));
    this.documentQueues.set(projectId, settled);
    try { await settled; }
    finally { if (this.documentQueues.get(projectId) === settled) this.documentQueues.delete(projectId); }
    return syncWarnings.length ? { ...result, syncWarnings } : result;
  }

  async readFileSnapshot(projectId: string, logicalPath: string): Promise<{ content: string | null; revision: number; path: string }> {
    const documentPath = normalizeSafeProjectFilePath(logicalPath);
    if (/\.(?:sketch\.json|excalidraw)$/i.test(documentPath) && this.sketchStore) {
      const sketch = await this.sketchStore(projectId);
      if (sketch) return {content:await sketch.readSketch(documentPath),revision:(await this.persistence.load(projectId)).revision,path:documentPath};
    }
    return this.lock.run(projectId, async () => ({ content: await this.content.read(projectId, documentPath),
      revision: (await this.persistence.load(projectId)).revision, path: documentPath }));
  }

  /** A mirror is an acknowledged document snapshot, not a blind file overwrite.
   * Generic file clients remain canvas edits and DO publish document intents. */
  async writeTextMirror(projectId: string, logicalPath: string, content: string, expectedRevision?: number,
    options: { nodeId?: string; docId?: string; documentRevision?: string; baseContent?: string; sourceRevision?: number } = {}): Promise<CanvasStateSnapshot> {
    const documentPath = normalizeSafeProjectFilePath(logicalPath);
    if (/\.(?:sketch\.json|excalidraw)$/i.test(documentPath) && this.sketchStore && await this.sketchStore(projectId)) {
      throw new CanvasStateError(428,'SKETCH_WRITE_CHANNEL_REQUIRED','Edit sketch content through the versioned sketch App action; canvas files are a read projection');
    }
    const docOrigin = !!(options.docId && options.documentRevision);
    if (options.documentRevision && options.documentRevision !== createHash('sha256').update(content).digest('hex')) throw new CanvasStateError(400, 'CANVAS_BAD_DOCUMENT_VERSION', 'Document revision does not match its body');
    const write = async () => {
      const current = await this.persistence.load(projectId);
      if ((expectedRevision !== undefined && expectedRevision !== current.revision)
        || (options.sourceRevision !== undefined && options.sourceRevision !== current.revision)) {
        throw new CanvasStateError(409, 'CANVAS_REVISION_CONFLICT', 'Canvas changed before the document mirror was saved');
      }
      const nodes = arrayRecords(current.state.workbenchBasicNodes);
      const targets = nodes.filter(node => node.kind === 'text' && canvasTextDocumentPath(node) === documentPath && (!options.nodeId || node.id === options.nodeId));
      if (options.nodeId && targets.length !== 1) throw new CanvasStateError(409, 'CANVAS_MIRROR_TARGET_CHANGED', 'Bound card or its file changed');
      if (targets.length > 1) throw new CanvasStateError(409, 'CANVAS_AMBIGUOUS_MIRROR', 'Shared legacy path requires an explicit target card');
      const oldContent = targets[0] && typeof targets[0].text === 'string' ? targets[0].text : await this.content.read(projectId, documentPath);
      if (oldContent !== null && oldContent !== content && expectedRevision === undefined && options.baseContent === undefined) throw new CanvasStateError(428, 'CANVAS_PRECONDITION_REQUIRED', 'Read the file and supply its version before changing it');
      if (options.sourceRevision === undefined && options.baseContent !== undefined && oldContent !== options.baseContent && oldContent !== content) {
        throw new CanvasStateError(409, 'CANVAS_CONTENT_CONFLICT', 'Canvas contains independent edits; neither side was overwritten', { currentContent: oldContent, draftContent: content, baseContent: options.baseContent });
      }
      if (docOrigin && options.sourceRevision === undefined && options.baseContent === undefined && oldContent !== content) throw new CanvasStateError(428, 'CANVAS_BASE_CONTENT_REQUIRED', 'Document mirror needs a common baseline');
      let actualPath = documentPath;
      if (targets[0] && oldContent !== content && nodes.some(node => node.kind === 'text' && node.id !== targets[0]!.id && canvasTextDocumentPath(node) === documentPath)) {
        actualPath = canvasTextForkPath(nodes, targets[0], `${current.revision}:${content}`);
      }
      const fileBefore = await this.content.read(projectId, actualPath);
      await this.content.write(projectId, actualPath, content);
      const changed = oldContent !== content || actualPath !== documentPath || fileBefore !== content;
      const next = { ...current.state, ...(targets.length ? { workbenchBasicNodes: nodes.map(node => node.id === targets[0]!.id ? { ...node, text: content, projectFilePath: actualPath } : node) } : {}) };
      const revision = changed ? Math.max(current.revision + 1, Date.now()) : current.revision;
      if (changed) {
        if (docOrigin) {await this.assertAllowedChanges(projectId,current.state,next);await this.persistence.commit(projectId, { ...current, state: next, revision });}
        else await this.commit(projectId, { ...current, state: next, revision });
        recordCanvasStateChanges(projectId, current.state, next, revision, await this.persistence.describe(projectId));
      }
      if (docOrigin && targets[0]) this.documentMirrorSaved?.(projectId, String(targets[0].id), options.docId!, options.documentRevision!, content, actualPath, revision);
      return { state: next, revision, mirrorPath: actualPath };
    };
    return docOrigin ? this.lock.run(projectId, write) : this.withDocumentChanges(projectId, write);
  }

  private async syncTextDocuments(projectId: string, nodes: readonly Record<string, unknown>[]): Promise<void> {
    for (const node of nodes) {
      if (node.kind !== 'text' || typeof node.text !== 'string') continue;
      const id = typeof node.id === 'string' ? node.id : '';
      if (!/^[A-Za-z0-9_-]+$/u.test(id)) continue;
      const documentPath = canvasTextDocumentPath(node);
      const current = await this.content.read(projectId, documentPath);
      if (current === node.text) continue;
      await this.content.write(projectId, documentPath, node.text);

    }
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
    if (node.kind !== 'text' || current?.kind !== 'text') return node;
    const currentPath = canvasTextDocumentPath(current);
    const requestedPath = canvasTextDocumentPath(node);
    // Optimistic UI copies can send their source path again AFTER the server
    // has assigned an independent file. Never let that stale whole-state PATCH
    // re-alias two previously independent documents.
    const reusesAnotherCard = requestedPath !== currentPath && nextNodes.some(other =>
      other.id !== node.id && other.kind === 'text' && canvasTextDocumentPath(other) === requestedPath);
    return !node.projectFilePath || reusesAnotherCard ? { ...node, projectFilePath: currentPath } : node;
  });
  const nextById = new Map(boundNodes.map(node => [node.id, node]));
  return boundNodes.map(node => {
    const current = currentById.get(node.id);
    if (node.kind === 'text' && !current && boundNodes.some(other => other.id !== node.id && other.kind === 'text' && canvasTextDocumentPath(other) === canvasTextDocumentPath(node))) {
      return { ...node, projectFilePath: canvasTextForkPath(boundNodes, node, `copy:${String(node.id)}`) };
    }
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

async function readCanvasDocument(file: string): Promise<StoredCanvasState | null> {
  let raw: string;
  try { raw = await readFile(file, 'utf8'); }
  catch (error) { if (isMissing(error)) return null; throw error; }
  let document: unknown;
  try { document = JSON.parse(raw); }
  catch { throw new CanvasStateError(500, 'CANVAS_STORAGE_ERROR', 'Canvas document is unreadable; existing file was preserved'); }
  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    throw new CanvasStateError(500, 'CANVAS_STORAGE_ERROR', 'Canvas document is invalid; existing file was preserved');
  }
  const stored = document as StoredCanvasState;
  if (!stored.state || typeof stored.state !== 'object' || Array.isArray(stored.state)
    || (stored.revision !== undefined && (!Number.isSafeInteger(stored.revision) || stored.revision < 0))
    || (stored.operations !== undefined && (!stored.operations || typeof stored.operations !== 'object' || Array.isArray(stored.operations)))) {
    throw new CanvasStateError(500, 'CANVAS_STORAGE_ERROR', 'Canvas document is invalid; existing file was preserved');
  }
  return stored;
}

async function legacyCanvasRevision(file: string): Promise<number> {
  return Math.trunc((await stat(file)).mtimeMs);
}

async function atomicWrite(target: string, content: string): Promise<void> {
  // Legacy PATCH, media delivery and workflow writes must not discard operation receipts.
  // Keep their original state/side-effect path but advance the shared document revision.
  if (target.endsWith('/canvas-state.json')) {
    let incoming: StoredCanvasState;
    try { incoming = JSON.parse(content) as StoredCanvasState; }
    catch { throw new CanvasStateError(500, 'CANVAS_STORAGE_ERROR', 'Invalid canvas write payload'); }
    if (incoming?.version === 1 && incoming.projectId && incoming.state && typeof incoming.state === 'object') {
      const previous = await readCanvasDocument(target);
      if (previous?.projectId && previous.projectId !== incoming.projectId) {
        throw new CanvasStateError(500, 'CANVAS_STORAGE_ERROR', 'Canvas document project does not match; existing file was preserved');
      }
      // A newer/legacy writer can omit operation metadata entirely. Preserve its
      // receipts, revision, and unknown envelope fields before committing state.
      if (previous) incoming = { ...previous, ...incoming };
      if (previous?.operations) incoming.operations = { ...previous.operations, ...incoming.operations };
      // Carry forward receipts and unknown envelope fields, then issue the first
      // explicit revision from the legacy file's last observed mtime. Later
      // writes compare against that stored number, not filesystem timestamp
      // resolution, so even back-to-back writes remain distinguishable.
      const priorRevision = previous ? previous.revision ?? await legacyCanvasRevision(target) : 0;
      // The operation path already allocated a revision for its receipt. Keep
      // that exact value; legacy writers supply none and allocate it here.
      incoming.revision = incoming.revision !== undefined && incoming.revision > priorRevision
        ? incoming.revision
        : Math.max(priorRevision + 1, Date.now());
      content = `${JSON.stringify(incoming, null, 2)}\n`;
    }
  }
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

/** MA-published identifier rule for scope fields on image references. */
const MA_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,160}$/;
const IMAGE_WORKSPACE_ID = /^iw[0-9a-f]{32}$/;
const IMAGE_ASSET_ID = /^ia[0-9a-f]{34}$/;
const IMAGE_REFERENCE_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const IMAGE_REFERENCE_INPUT_FIELDS = ['applicationInstanceId', 'workspaceId', 'assetId', 'x', 'y', 'name', 'expectedRevision', 'idempotencyKey', 'callerScope'] as const;
const IMAGE_REFERENCE_FIELDS = ['applicationId', 'applicationInstanceId', 'providerInstanceId', 'teamId', 'bizId', 'workspaceId', 'assetId', 'mime', 'sha256', 'width', 'height'] as const;

/** Strict remote Image asset reference; verified metadata only, never bytes. */
export type ImageAssetReference = import('@bezier/contracts').CanvasImageReference;
export interface ImageReferenceResolution {
  reference: ImageAssetReference;
  previewUrl: (nodeId: string) => string;
}
export interface ImageReferenceAttachInput {
  applicationInstanceId: string;
  workspaceId: string;
  assetId: string;
  x: number;
  y: number;
  name?: string;
  expectedRevision: number;
  idempotencyKey: string;
  /** Opaque trusted sha256 of the FULL verified source identity; supplied only
   * by the server route, never by the browser. */
  callerScope: string;
}
export interface ImageReferenceAttachResult {
  receiptId: string;
  nodeId: string;
  revision: number;
  reference: ImageAssetReference;
  replayed: boolean;
}

function assertImageAssetReference(value: unknown): ImageAssetReference {
  const fail = () => { throw new CanvasStateError(502, 'IMAGE_REFERENCE_INVALID', 'resolved image reference metadata is invalid'); };
  const record = recordValue(value);
  if (!Object.keys(record).length) fail();
  for (const key of Object.keys(record)) if (!(IMAGE_REFERENCE_FIELDS as readonly string[]).includes(key)) fail();
  for (const key of ['applicationId', 'applicationInstanceId', 'providerInstanceId', 'teamId', 'bizId'] as const)
    if (typeof record[key] !== 'string' || !MA_ID_PATTERN.test(record[key] as string)) fail();
  if (typeof record.workspaceId !== 'string' || !IMAGE_WORKSPACE_ID.test(record.workspaceId)) fail();
  if (typeof record.assetId !== 'string' || !IMAGE_ASSET_ID.test(record.assetId)) fail();
  if (typeof record.mime !== 'string' || !IMAGE_REFERENCE_MIMES.has(record.mime)) fail();
  if (typeof record.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(record.sha256)) fail();
  const { width, height } = record as { width?: unknown; height?: unknown };
  if (typeof width !== 'number' || typeof height !== 'number' || !Number.isSafeInteger(width) || !Number.isSafeInteger(height)
    || width < 1 || height < 1 || width * height > 32_000_000) fail();
  return record as unknown as ImageAssetReference;
}
