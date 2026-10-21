import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

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

export class AuditLog {
  private readonly file: string;
  constructor(dataRoot: string) {
    mkdirSync(dataRoot, { recursive: true });
    this.file = path.join(dataRoot, 'audit.jsonl');
  }

  record(entry: Omit<AuditEntry, 'auditId' | 'createdAt'>): void {
    try {
      appendFileSync(this.file, JSON.stringify({ ...entry, auditId: `audit-${randomUUID().slice(0, 8)}`, createdAt: new Date().toISOString() }) + '\n');
    } catch { /* audit must never break the operation it records */ }
  }

  /** Tail-style read for governance views; most recent entries last. */
  list(filter?: { teamId?: string; appId?: string; limit?: number }): AuditEntry[] {
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
