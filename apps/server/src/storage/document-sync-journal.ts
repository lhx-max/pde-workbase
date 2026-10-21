import { createHash, randomUUID } from 'node:crypto';
import { closeSync, constants, fsyncSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export interface DocumentSyncEntry {
  projectId: string; nodeId: string; appId: string; teamId: string; userId: string;
  generation: number; canvasRevision: number; mirrorPath: string; title?: string;
  content: string; baseContent?: string; documentId?: string; documentRevision?: string;
  status: 'pending' | 'synced' | 'conflict' | 'blocked' | 'detached';
  attempts: number; nextAttemptAt: number; updatedAt: number; error?: string;
  remoteContent?: string;
}

export class DocumentSyncJournalError extends Error {
  constructor(readonly status: number, readonly code: string, message = code) { super(message); }
}

const fields = new Set(['projectId', 'nodeId', 'appId', 'teamId', 'userId', 'generation', 'canvasRevision',
  'mirrorPath', 'title', 'content', 'baseContent', 'documentId', 'documentRevision', 'status', 'attempts',
  'nextAttemptAt', 'updatedAt', 'error', 'remoteContent']);
const nonempty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const nonnegative = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const corrupt = (): never => { throw new DocumentSyncJournalError(500, 'DOCUMENT_SYNC_CORRUPT', 'Document sync journal is damaged or has an unsupported schema'); };
function validateEntry(value: unknown, stored = true): DocumentSyncEntry {
  const invalid = (): never => {
    if (stored) return corrupt();
    throw new DocumentSyncJournalError(400, 'DOCUMENT_SYNC_INVALID_INPUT', 'Invalid document sync entry');
  };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  const entry = value as DocumentSyncEntry;
  if (Object.keys(entry).some(key => !fields.has(key))
    || ![entry.projectId, entry.nodeId, entry.appId, entry.teamId, entry.userId, entry.mirrorPath].every(nonempty)
    || ![entry.documentId, entry.documentRevision].every(item => item === undefined || nonempty(item))
    || typeof entry.content !== 'string'
    || ![entry.title, entry.baseContent, entry.remoteContent, entry.error].every(item => item === undefined || typeof item === 'string')
    || !nonnegative(entry.generation) || entry.generation < 1
    || ![entry.canvasRevision, entry.attempts, entry.nextAttemptAt, entry.updatedAt].every(nonnegative)
    || !['pending', 'synced', 'conflict', 'blocked', 'detached'].includes(entry.status)) return invalid();
  return entry;
}

/** A durable intent per bound card. Payload is persisted BEFORE canvas commit;
 * delivery confirms that exact canvas revision/content exists before sending.
 * No credentials are persisted, only the authenticated actor identifiers. */
export class DocumentSyncJournal {
  private readonly root: string;
  private readonly directory: string;
  constructor(root: string) {
    if (!root || !path.isAbsolute(root)) throw new DocumentSyncJournalError(400, 'DOCUMENT_SYNC_STORAGE_INVALID', 'Document sync requires an explicit absolute data root');
    this.root = path.resolve(root);
    this.directory = path.join(this.root, 'document-sync');
    try {
      this.assertEntry(this.root, true, true);
      mkdirSync(this.root, { recursive: true });
      this.assertEntry(this.root, true);
      // Pin the configured directory; OS aliases such as /var remain usable,
      // but later changes to ancestor aliases cannot redirect journal writes.
      this.root = realpathSync(this.root);
      this.directory = path.join(this.root, 'document-sync');
      this.assertEntry(this.directory, true, true);
      mkdirSync(this.directory, { recursive: true, mode: 0o700 });
      this.assertEntry(this.directory, true);
      this.syncDirectory(this.root);
    } catch (error) { this.storageFailure(error); }
  }

  private storageFailure(error: unknown): never {
    if (error instanceof DocumentSyncJournalError) throw error;
    throw new DocumentSyncJournalError(500, 'DOCUMENT_SYNC_STORAGE_ERROR', 'Document sync journal storage could not be accessed');
  }

  private assertEntry(file: string, directory: boolean, allowMissing = false): void {
    if (file !== this.root && file !== this.directory && path.dirname(file) !== this.directory) {
      throw new DocumentSyncJournalError(500, 'DOCUMENT_SYNC_STORAGE_UNSAFE', 'Document sync path escaped its configured directory');
    }
    try {
      const info = lstatSync(file);
      if (info.isSymbolicLink() || !(directory ? info.isDirectory() : info.isFile())) {
        throw new DocumentSyncJournalError(500, 'DOCUMENT_SYNC_STORAGE_UNSAFE', 'Document sync storage must not use symlinks or special files');
      }
    } catch (error) {
      if (allowMissing && (error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
  }

  private assertDirectories(): void {
    this.assertEntry(this.root, true);
    this.assertEntry(this.directory, true);
  }

  private syncDirectory(directory: string): void {
    const fd = openSync(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try { fsyncSync(fd); } finally { closeSync(fd); }
  }

  private filename(projectId: string, nodeId: string): string {
    if (!nonempty(projectId) || !nonempty(nodeId)) throw new DocumentSyncJournalError(400, 'DOCUMENT_SYNC_INVALID_INPUT', 'Document sync identity must be non-empty strings');
    return createHash('sha256').update(JSON.stringify([projectId, nodeId])).digest('hex') + '.json';
  }

  private readEntry(name: string, allowMissing = false): DocumentSyncEntry | undefined {
    if (!/^[a-f0-9]{64}\.json$/.test(name)) return corrupt();
    let fd: number | undefined;
    let serialized: string;
    try {
      this.assertDirectories();
      const file = path.join(this.directory, name);
      this.assertEntry(file, false, allowMissing);
      try { fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW); }
      catch (error) {
        if (allowMissing && (error as NodeJS.ErrnoException).code === 'ENOENT') return;
        throw error;
      }
      serialized = readFileSync(fd, 'utf8');
    } catch (error) { return this.storageFailure(error); }
    finally { if (fd !== undefined) closeSync(fd); }
    let value: unknown;
    try { value = JSON.parse(serialized); } catch { return corrupt(); }
    const entry = validateEntry(value);
    if (this.filename(entry.projectId, entry.nodeId) !== name) return corrupt();
    return entry;
  }

  get(projectId: string, nodeId: string): DocumentSyncEntry | undefined {
    return this.readEntry(this.filename(projectId, nodeId), true);
  }

  put(entry: DocumentSyncEntry): void {
    validateEntry(entry, false);
    // A new write must not silently replace a damaged durable intent.
    this.get(entry.projectId, entry.nodeId);
    const file = path.join(this.directory, this.filename(entry.projectId, entry.nodeId));
    const tmp = `${file}.${randomUUID()}.tmp`;
    let fd: number | undefined;
    try {
      this.assertDirectories();
      this.assertEntry(file, false, true);
      this.assertEntry(tmp, false, true);
      fd = openSync(tmp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      writeFileSync(fd, JSON.stringify(entry), 'utf8');
      fsyncSync(fd);
      closeSync(fd); fd = undefined;
      // Exact source/destination are checked again before atomic publication.
      this.assertDirectories();
      this.assertEntry(tmp, false);
      this.assertEntry(file, false, true);
      renameSync(tmp, file);
      this.syncDirectory(this.directory);
    } catch (error) { this.storageFailure(error); }
    finally { if (fd !== undefined) closeSync(fd); }
  }

  list(projectId?: string): DocumentSyncEntry[] {
    let names: string[];
    try { this.assertDirectories(); names = readdirSync(this.directory); }
    catch (error) { return this.storageFailure(error); }
    // Failed publication may leave .tmp files. They are never treated as
    // committed intents, followed, or automatically deleted. All other
    // unknown/bad entries fail closed, even when filtering another project.
    return names.filter(name => !name.endsWith('.tmp')).map(name => this.readEntry(name)!)
      .filter(entry => !projectId || entry.projectId === projectId);
  }

  enqueue(input: Omit<DocumentSyncEntry, 'generation' | 'status' | 'attempts' | 'nextAttemptAt' | 'updatedAt'>): DocumentSyncEntry {
    const previous = this.get(input.projectId, input.nodeId);
    // A delayed callback must never replace an intent prepared by a newer
    // canvas commit, including its generation, content and authenticated actor.
    if (previous && previous.canvasRevision > input.canvasRevision) return previous;
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
