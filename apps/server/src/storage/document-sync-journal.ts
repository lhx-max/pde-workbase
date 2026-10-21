import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { assertProjectPathHasNoSymlinks } from '../project-layout.js';

export interface DocumentSyncEntry {
  projectId: string; nodeId: string; appId: string; teamId: string; userId: string;
  generation: number; canvasRevision: number; mirrorPath: string; title?: string;
  content: string; baseContent?: string; documentId?: string; documentRevision?: string;
  status: 'pending' | 'synced' | 'conflict' | 'blocked' | 'detached';
  attempts: number; nextAttemptAt: number; updatedAt: number; error?: string;
  remoteContent?: string;
}

/** A durable intent per bound card. Payload is persisted BEFORE canvas commit;
 * delivery confirms that exact canvas revision/content exists before sending.
 * No credentials are persisted, only the authenticated actor identifiers. */
export class DocumentSyncJournal {
  private readonly directory: string;
  constructor(private readonly root: string) {
    if (!path.isAbsolute(root)) throw new Error('Document sync requires an absolute data root');
    this.directory = path.join(root, 'document-sync');
    assertProjectPathHasNoSymlinks(root, 'document-sync');
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
  }
  private file(projectId: string, nodeId: string): string {
    const name = createHash('sha256').update(JSON.stringify([projectId, nodeId])).digest('hex') + '.json';
    assertProjectPathHasNoSymlinks(this.root, `document-sync/${name}`);
    return path.join(this.directory, name);
  }
  get(projectId: string, nodeId: string): DocumentSyncEntry | undefined {
    const file = this.file(projectId, nodeId);
    if (!existsSync(file)) return;
    const value = JSON.parse(readFileSync(file, 'utf8')) as DocumentSyncEntry;
    if (value.projectId !== projectId || value.nodeId !== nodeId) throw new Error('Corrupt document sync identity');
    return value;
  }
  put(entry: DocumentSyncEntry): void {
    const file = this.file(entry.projectId, entry.nodeId);
    const tmp = `${file}.${randomUUID()}.tmp`;
    writeFileSync(tmp, JSON.stringify(entry), { mode: 0o600, flag: 'wx' });
    // Both paths are literal descendants of the checked, explicit data root.
    renameSync(tmp, file);
  }
  list(projectId?: string): DocumentSyncEntry[] {
    assertProjectPathHasNoSymlinks(this.root, 'document-sync');
    return readdirSync(this.directory).filter(name => /^[a-f0-9]{64}\.json$/.test(name)).map(name => {
      assertProjectPathHasNoSymlinks(this.root, `document-sync/${name}`);
      return JSON.parse(readFileSync(path.join(this.directory, name), 'utf8')) as DocumentSyncEntry;
    }).filter(entry => !projectId || entry.projectId === projectId);
  }
  enqueue(input: Omit<DocumentSyncEntry, 'generation' | 'status' | 'attempts' | 'nextAttemptAt' | 'updatedAt'>): DocumentSyncEntry {
    const previous = this.get(input.projectId, input.nodeId);
    if (previous && previous.canvasRevision === input.canvasRevision && previous.content === input.content
      && previous.mirrorPath === input.mirrorPath) return previous;
    const outstanding = previous && previous.status !== 'synced' && previous.status !== 'detached';
    const baseline = outstanding ? previous.baseContent : input.baseContent ?? previous?.content;
    const entry: DocumentSyncEntry = { ...input, ...(baseline !== undefined ? { baseContent: baseline } : {}),
      ...(previous?.documentId ? { documentId: previous.documentId } : {}),
      generation: (previous?.generation ?? 0) + 1, status: 'pending', attempts: 0, nextAttemptAt: 0, updatedAt: Date.now() };
    this.put(entry); return entry;
  }
  update(entry: DocumentSyncEntry, patch: Partial<DocumentSyncEntry>): boolean {
    const current = this.get(entry.projectId, entry.nodeId);
    if (!current || current.generation !== entry.generation) return false;
    this.put({ ...current, ...patch, updatedAt: Date.now() }); return true;
  }
}
