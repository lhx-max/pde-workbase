import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { ProjectLedgerEvent, ProjectLedgerEvidenceRef, ProjectLedgerListResponse } from '@bezier/contracts';
import type {JsonStatePort} from '@ks-designai/app-cloud-state';

/** File-backed extraction of the project ledger. No chat database or product tables. */
export interface RecordProjectLedgerEventInput {
  projectId: string; type: string; source: string; entityType: string; entityId: string;
  summary: string; idempotencyKey: string; occurredAt?: number;
  actorType?: ProjectLedgerEvent['actorType']; actorId?: string | null;
  entityVersion?: string | null; runId?: string | null; workflowRunId?: string | null;
  correlationId?: string | null; causationId?: string | null;
  payload?: Record<string, unknown>; evidenceRefs?: ProjectLedgerEvidenceRef[];
  sensitivity?: ProjectLedgerEvent['sensitivity']; visibility?: ProjectLedgerEvent['visibility']; origin?: ProjectLedgerEvent['origin'];
}
export class ProjectLedgerError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}
const sensitive = /(api.?key|authorization|cookie|secret|password|auth.?token|access.?token|refresh.?token|credential|private.?key|system.?prompt|stderr)/iu;
function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, sensitive.test(key) ? '[redacted]' : normalize(child)]));
}
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export class ProjectLedger {
  constructor(private readonly dataRoot: string,private readonly state?:JsonStatePort) {
    if (!path.isAbsolute(dataRoot)) throw new Error('ledger requires an absolute data root');
  }
  private file(projectId: string): string {
    if (!/^[A-Za-z0-9_-]+$/.test(projectId)) throw new Error('invalid project id');
    return path.join(this.dataRoot, 'project-ledger', `${projectId}.json`);
  }
  private events(projectId: string): ProjectLedgerEvent[] {
    const file = this.file(projectId);
    if(this.state){
      const raw=this.state.read(`ledger:${projectId}`);
      if(raw===undefined)return [];
      const value=raw as {version:unknown;events:ProjectLedgerEvent[]};
      if(!value||typeof value!=='object'||Array.isArray(value)||value.version!==1||!Array.isArray(value.events)
        ||value.events.some((event,index)=>!event||event.projectId!==projectId||event.sequence!==index+1
          ||typeof event.id!=='string'||typeof event.idempotencyKey!=='string'||hash(event.payload)!==event.payloadDigest))
        throw new ProjectLedgerError(503,'LEDGER_CORRUPT','Invalid cloud ledger or payload digest');
      return value.events;
    }
    if (!existsSync(file)) return [];
    const document = JSON.parse(readFileSync(file, 'utf8')) as {version: number; events: ProjectLedgerEvent[]};
    if (document.version !== 1 || !Array.isArray(document.events)) throw new Error('invalid ledger document');
    return document.events;
  }
  record(input: RecordProjectLedgerEventInput): {event: ProjectLedgerEvent; inserted: boolean} {
    for (const key of ['projectId','type','source','entityType','entityId','idempotencyKey','summary'] as const) {
      if (!input[key]?.trim()) throw new ProjectLedgerError(400, 'LEDGER_EVENT_INVALID', `${key} is required`);
    }
    const events = this.events(input.projectId);
    const idempotencyKey = input.idempotencyKey.slice(0, 1024);
    const existing = events.find(event => event.idempotencyKey === idempotencyKey);
    if (existing) return {event: existing, inserted: false};
    const payload = normalize(input.payload ?? {}) as Record<string, unknown>;
    if (Buffer.byteLength(JSON.stringify(payload)) > 8192) throw new ProjectLedgerError(400, 'LEDGER_PAYLOAD_TOO_LARGE', 'event payload exceeds 8192 bytes');
    const now = Date.now();
    const event: ProjectLedgerEvent = {
      id: randomUUID(), projectId: input.projectId, sequence: (events.at(-1)?.sequence ?? 0) + 1,
      type: input.type, source: input.source, entityType: input.entityType, entityId: input.entityId,
      occurredAt: input.occurredAt ?? now, recordedAt: now, actorType: input.actorType ?? 'system',
      summary: input.summary.trim().slice(0, 500), payload, payloadDigest: hash(payload),
      evidenceRefs: (input.evidenceRefs ?? []).slice(0, 32), sensitivity: input.sensitivity ?? 'normal',
      visibility: input.visibility ?? 'user', origin: input.origin ?? 'realtime', idempotencyKey, schemaVersion: 1,
    };
    for (const key of ['actorId','entityVersion','runId','workflowRunId','correlationId','causationId'] as const) {
      if (input[key]) event[key] = input[key];
    }
    events.push(event);
    if(this.state){this.state.write(`ledger:${input.projectId}`,{version:1,events});return {event,inserted:true};}
    const file = this.file(input.projectId);
    mkdirSync(path.dirname(file), {recursive: true});
    const temporary = `${file}.${randomUUID()}.tmp`;
    writeFileSync(temporary, JSON.stringify({version: 1, events}), {mode: 0o600, flush: true});
    renameSync(temporary, file);
    return {event, inserted: true};
  }
  list(projectId: string, options: {limit?: number; afterSequence?: number; cursor?: string; type?: string; visibility?: ProjectLedgerEvent['visibility']} = {}): ProjectLedgerListResponse {
    const all = this.events(projectId);
    const limit = Math.min(200, Math.max(1, Math.floor(options.limit ?? 50)));
    let filtered = all.filter(event => (!options.type || event.type === options.type) && (!options.visibility || event.visibility === options.visibility));
    if (options.afterSequence !== undefined) filtered = filtered.filter(event => (event.sequence ?? 0) > options.afterSequence!);
    else filtered.reverse();
    if (options.cursor) filtered = filtered.slice(Math.max(0, filtered.findIndex(event => event.id === options.cursor) + 1));
    const events = filtered.slice(0, limit);
    return {projectId, events, nextCursor: filtered.length > limit ? events.at(-1)!.id : null, hasMore: filtered.length > limit, highWaterMark: all.at(-1)?.sequence ?? 0};
  }
  listEntityHistory(projectId: string, entityType: string, entityId: string, limit = 100, related: {correlationIds?: readonly string[]; fileNames?: readonly string[]} = {}): ProjectLedgerEvent[] {
    const all = this.events(projectId);
    const direct = all.filter(event => event.entityType === entityType && event.entityId === entityId);
    const workflows = new Set(direct.flatMap(event => event.workflowRunId ?? []));
    const runs = new Set(direct.flatMap(event => event.runId ?? []));
    return all.filter(event => direct.includes(event)
      || (event.workflowRunId && workflows.has(event.workflowRunId)) || (event.runId && runs.has(event.runId))
      || (event.correlationId && related.correlationIds?.includes(event.correlationId))
      || (entityType === 'workflow_result' && event.payload.resultId === entityId)
      || (['usage.download_started','usage.asset_saved'].includes(event.type) && related.fileNames?.includes(String(event.payload.fileName))))
      .sort((a,b) => b.occurredAt-a.occurredAt || b.id.localeCompare(a.id)).slice(0, Math.min(200, Math.max(1, limit)));
  }
  verify(projectId: string) {
    const events = this.events(projectId);
    const issues = events.filter(event => hash(event.payload) !== event.payloadDigest).map(event => ({code: 'digest-mismatch', eventId: event.id, message: 'Event payload digest does not match'}));
    return {projectId, valid: issues.length === 0, eventCount: events.length, issues};
  }
}
