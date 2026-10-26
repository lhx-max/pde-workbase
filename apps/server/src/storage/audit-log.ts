import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { JsonStatePort } from '@ks-designai/app-cloud-state';

/** Append-only audit log (data-model §二). One JSON line per governed action —
 * "who did what to which asset, when". Asset reads are not logged (too noisy);
 * writes/registrations/entitlement changes/bindings are. */
export interface AuditEntry {
  auditId: string;
  actor: { teamId: string; userId: string };
  action: string;                 // e.g. 'app.register', 'entitlement.put', 'canvas.create', 'binding.upsert'
  appId?: string;
  targetId?: string;              // affected asset id (instance/doc/rule/binding)
  status: 'succeeded' | 'failed';
  summary?: string;
  createdAt: string;
}

export class AuditLogError extends Error {
  constructor(readonly status: number, readonly code: string, message = code) { super(message); }
}

interface Slot { version: 1; entries: AuditEntry[] }

/** A single cloud slot cannot grow without bound. Exceeding the bound is an
 * explicit error — history is never silently dropped to make room. */
const ENTRY_LIMIT = 4096;
const entryFields = new Set(['auditId', 'actor', 'action', 'appId', 'targetId', 'status', 'summary', 'createdAt']);
const actorFields = new Set(['teamId', 'userId']);
const nonempty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const cloneJson = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const corrupt = (): never => { throw new AuditLogError(500, 'AUDIT_LOG_CORRUPT', 'Audit log is damaged or has an unsupported schema'); };

function validateEntry(value: unknown): AuditEntry {
  const entry = value as AuditEntry;
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)
    || Object.keys(entry).some(key => !entryFields.has(key))
    || ![entry.auditId, entry.action, entry.createdAt].every(nonempty)
    || !entry.actor || typeof entry.actor !== 'object' || Array.isArray(entry.actor)
    || Object.keys(entry.actor).some(key => !actorFields.has(key))
    || ![entry.actor.teamId, entry.actor.userId].every(nonempty)
    || !['succeeded', 'failed'].includes(entry.status)
    || ![entry.appId, entry.targetId, entry.summary].every(item => item === undefined || typeof item === 'string')) return corrupt();
  return entry;
}

function validateSlot(value: unknown): AuditEntry[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return corrupt();
  const slot = value as Slot;
  if (slot.version !== 1 || !Array.isArray(slot.entries)) return corrupt();
  return slot.entries.map(item => validateEntry(item));
}

export class AuditLog {
  private readonly file: string;
  private readonly state: JsonStatePort | undefined;
  constructor(dataRoot: string, state?: JsonStatePort) {
    this.state = state;
    // With an injected state port the 'audit' slot is authoritative: no local
    // file or directory is created, read, or imported.
    if (!state) mkdirSync(dataRoot, { recursive: true });
    this.file = path.join(dataRoot, 'audit.jsonl');
  }

  record(entry: Omit<AuditEntry, 'auditId' | 'createdAt'>): void {
    if (!this.state) {
      try {
        appendFileSync(this.file, JSON.stringify({ ...entry, auditId: `audit-${randomUUID().slice(0, 8)}`, createdAt: new Date().toISOString() }) + '\n');
      } catch { /* audit must never break the operation it records */ }
      return;
    }
    // Cloud audits are authoritative: malformed history fails closed, an
    // invalid row never reaches the slot, the bounded slot refuses explicitly,
    // and read/write failures propagate instead of being swallowed.
    const row: AuditEntry = {
      auditId: `audit-${randomUUID().slice(0, 8)}`,
      actor: { teamId: entry.actor?.teamId as string, userId: entry.actor?.userId as string },
      action: entry.action,
      ...(entry.appId !== undefined ? { appId: entry.appId } : {}),
      ...(entry.targetId !== undefined ? { targetId: entry.targetId } : {}),
      status: entry.status,
      ...(entry.summary !== undefined ? { summary: entry.summary } : {}),
      createdAt: new Date().toISOString(),
    };
    try { validateEntry(row); }
    catch { throw new AuditLogError(400, 'AUDIT_LOG_INVALID', 'Invalid audit entry'); }
    const value = this.state.read('audit');
    const entries = value === undefined ? [] : cloneJson(validateSlot(value));
    if (entries.length >= ENTRY_LIMIT) throw new AuditLogError(500, 'AUDIT_LOG_LIMIT', 'Audit log reached its storage bound; refusing to drop history');
    this.state.write('audit', cloneJson<Slot>({ version: 1, entries: [...entries, row] }));
  }

  /** Tail-style read for governance views; most recent entries last. */
  list(filter?: { teamId?: string; appId?: string; limit?: number }): AuditEntry[] {
    if (this.state) {
      const value = this.state.read('audit');
      let entries = value === undefined ? [] : cloneJson(validateSlot(value));
      if (filter?.teamId) entries = entries.filter(e => e.actor.teamId === filter.teamId);
      if (filter?.appId) entries = entries.filter(e => e.appId === filter.appId);
      return entries.slice(-(filter?.limit ?? 200));
    }
    try {
      let lines = readFileSync(this.file, 'utf8').trim().split('\n').filter(Boolean)
        .map(line => JSON.parse(line) as AuditEntry);
      if (filter?.teamId) lines = lines.filter(e => e.actor.teamId === filter!.teamId);
      if (filter?.appId) lines = lines.filter(e => e.appId === filter!.appId);
      const limit = filter?.limit ?? 200;
      return lines.slice(-limit);
    } catch { return []; }
  }
}
