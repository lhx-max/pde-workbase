import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile, rename, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { canvasTextPath, type CanvasSavedSnapshot } from '@bezier/contracts';
import type { StoredCanvasOperation } from '@bezier/canvas-core';
import { CanvasStateError } from './errors.js';
import { canvasStateRelativePath, assertProjectPathHasNoSymlinks } from '../project-layout.js';

export function normalizeSafeProjectFilePath(value: string): string {
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

export type CanvasState = Record<string, unknown>;
export type ResolveCanvasProjectRoot = (projectId: string) => string | null | Promise<string | null>;

/** Whole state-document blob as persisted. `operations` is the receipt journal.
 * Unknown top-level fields are carried through loads and preserved on commit. */
export interface CanvasStoredBlob {
  version?: number;
  projectId?: string;
  updatedAt?: string;
  state: CanvasState;
  revision: number;
  operations?: Record<string, StoredCanvasOperation>;
  snapshots?: Record<string, CanvasSavedSnapshot>;
  [key: string]: unknown;
}

/** State-document persistence. `commit` replaces the blob under the host's
 * per-canvas write serialization; `changedOperationId` lets row-oriented
 * backends append only the new journal entry. */
export interface CanvasPersistence {
  load(projectId: string): Promise<CanvasStoredBlob>;
  commit(projectId: string, blob: CanvasStoredBlob, changedOperationId?: string): Promise<void>;
  /** Observability label for change records, not an access path. */
  describe(projectId: string): Promise<string>;
}

/** Canvas-owned text content (text-card documents, generated receipts).
 * Project-relative logical paths; backends decide where bytes live. */
export interface CanvasFileContent {
  read(projectId: string, relative: string): Promise<string | null>;
  write(projectId: string, relative: string, content: string): Promise<void>;
  /** 二进制媒体口：卡包 op 写/读音频等媒体字节；实现方未提供时调用方须显式失败。 */
  readBytes?(projectId: string, relative: string): Promise<Uint8Array | null>;
  writeBytes?(projectId: string, relative: string, bytes: Uint8Array): Promise<void>;
}

const isMissing = (error: unknown): boolean => error instanceof Error && 'code' in error
  && (error as NodeJS.ErrnoException).code === 'ENOENT';

async function readCanvasDocument(file: string): Promise<CanvasStoredBlob | null> {
  let raw: string;
  try { raw = await readFile(file, 'utf8'); }
  catch (error) { if (isMissing(error)) return null; throw error; }
  let document: unknown;
  try { document = JSON.parse(raw); }
  catch { throw new CanvasStateError(500, 'CANVAS_STORAGE_ERROR', 'Canvas document is unreadable; existing file was preserved'); }
  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    throw new CanvasStateError(500, 'CANVAS_STORAGE_ERROR', 'Canvas document is invalid; existing file was preserved');
  }
  const stored = document as CanvasStoredBlob;
  if (!stored.state || typeof stored.state !== 'object' || Array.isArray(stored.state)
    || (stored.revision !== undefined && (!Number.isSafeInteger(stored.revision) || stored.revision < 0))
    || (stored.operations !== undefined && (!stored.operations || typeof stored.operations !== 'object' || Array.isArray(stored.operations)))) {
    throw new CanvasStateError(500, 'CANVAS_STORAGE_ERROR', 'Canvas document is invalid; existing file was preserved');
  }
  return stored;
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

async function legacyCanvasRevision(file: string): Promise<number> {
  return Math.trunc((await stat(file)).mtimeMs);
}

/** Filesystem persistence: the state document under the project root.
 * Preserves the legacy behaviors: mtime-derived revision for first-class
 * revision migration, unknown envelope fields and the operation journal
 * carried forward across every writer. */
export class FileCanvasPersistence implements CanvasPersistence {
  constructor(private readonly resolveProjectRoot: ResolveCanvasProjectRoot) {}

  private async file(projectId: string): Promise<string> {
    const root = await this.resolveProjectRoot(projectId);
    if (!root) throw new CanvasStateError(404, 'CANVAS_PROJECT_NOT_FOUND', 'project not found', { projectId });
    if (!path.isAbsolute(root)) throw new CanvasStateError(500, 'CANVAS_STORAGE_ERROR', 'project resolver returned a non-absolute root');
    const relative = canvasStateRelativePath(root);
    assertProjectPathHasNoSymlinks(root, relative);
    return path.join(path.resolve(root), relative);
  }

  async load(projectId: string): Promise<CanvasStoredBlob> {
    const file = await this.file(projectId);
    const stored = await readCanvasDocument(file);
    if (!stored) return { state: {}, revision: 0 };
    const state = stored.state;
    if (Array.isArray(state.workbenchBasicNodes)) {
      const root = path.dirname(path.dirname(file));
      state.workbenchBasicNodes = state.workbenchBasicNodes.map((node) => {
        if (!node || node.kind !== 'text' || node.projectFilePath || typeof node.id !== 'string' || !/^[A-Za-z0-9_-]+$/.test(node.id)) return node;
        const legacy = `画布文本/${node.id}.md`;
        return { ...node, projectFilePath: existsSync(path.join(root, legacy)) ? legacy : canvasTextPath(node.id) };
      });
    }
    return { ...stored, revision: stored.revision ?? await legacyCanvasRevision(file) };
  }

  /** Merges like the legacy writers did: unknown envelope fields survive, the
   * journal accumulates, and the caller-supplied revision wins only when it
   * actually advances past the prior persisted value. */
  async commit(projectId: string, blob: CanvasStoredBlob): Promise<void> {
    const file = await this.file(projectId);
    await mkdir(path.dirname(file), { recursive: true });
    const previous = await readCanvasDocument(file);
    if (previous?.projectId && blob.projectId && previous.projectId !== blob.projectId)
      throw new CanvasStateError(500, 'CANVAS_STORAGE_ERROR', 'Canvas document project does not match; existing file was preserved');
    let incoming: CanvasStoredBlob = { ...(previous ?? {}), ...blob };
    if (previous?.operations) incoming.operations = { ...previous.operations, ...incoming.operations };
    const priorRevision = previous ? previous.revision ?? await legacyCanvasRevision(file) : 0;
    incoming.revision = incoming.revision > priorRevision ? incoming.revision : Math.max(priorRevision + 1, Date.now());
    await atomicWrite(file, `${JSON.stringify({ version: 1, projectId, updatedAt: new Date().toISOString(), ...incoming }, null, 2)}\n`);
  }

  async describe(projectId: string): Promise<string> {
    const file = await this.file(projectId);
    return path.relative(path.dirname(path.dirname(file)), file);
  }
}

/** Canvas text files on the project filesystem. */
export class FileCanvasContent implements CanvasFileContent {
  constructor(private readonly resolveProjectRoot: ResolveCanvasProjectRoot) {}

  private async file(projectId: string, relative: string): Promise<string> {
    const root = await this.resolveProjectRoot(projectId);
    if (!root) throw new CanvasStateError(404, 'CANVAS_PROJECT_NOT_FOUND', 'project not found', { projectId });
    const safe = normalizeSafeProjectFilePath(relative);
    assertProjectPathHasNoSymlinks(root, safe);
    return path.join(path.resolve(root), safe);
  }

  async read(projectId: string, relative: string): Promise<string | null> {
    try { return await readFile(await this.file(projectId, relative), 'utf8'); }
    catch (error) { if (isMissing(error)) return null; throw error; }
  }

  async write(projectId: string, relative: string, content: string): Promise<void> {
    const file = await this.file(projectId, relative);
    await mkdir(path.dirname(file), { recursive: true });
    await atomicWrite(file, content);
  }

  async readBytes(projectId: string, relative: string): Promise<Uint8Array | null> {
    try { return await readFile(await this.file(projectId, relative)); }
    catch (error) { if (isMissing(error)) return null; throw error; }
  }

  async writeBytes(projectId: string, relative: string, bytes: Uint8Array): Promise<void> {
    const file = await this.file(projectId, relative);
    await mkdir(path.dirname(file), { recursive: true });
    const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, bytes, { flag: 'wx' });
      await rename(temporary, file);
    } catch (error) {
      throw new CanvasStateError(500, 'CANVAS_STORAGE_ERROR', 'failed to persist canvas binary atomically', {
        cause: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
