import { createHash } from 'node:crypto';
import type { JsonStatePort } from '@ks-designai/app-cloud-state';
import { CanvasStateError } from '../canvas/errors.js';
import { canonical } from '../canvas/merge.js';

/** Durable lifecycle receipts for the COI actions canvas.create / canvas.rename
 * / canvas.delete. A pending record is persisted BEFORE the registry mutation
 * and completed only after the mutation flushed, so a crash mid-flight leaves
 * an explicit uncertain marker instead of an invisible retry. No credentials,
 * headers or free-form input are persisted — only the verified actor tuple,
 * the action fingerprint and the sanitized business result. */

export type CanvasLifecycleAction = 'canvas.create' | 'canvas.rename' | 'canvas.delete';
export type CanvasActionScope = 'app' | 'instance';

export interface CanvasActionActor {
  teamId: string;
  userId: string;
  bizId?: string;
  applicationId?: string;
  applicationInstanceId?: string;
}

export interface CanvasActionReceipt {
  /** Caller-visible id: the supplied idempotency key or a generated operation id. */
  receiptId: string;
  /** sha256 of the exact identity+scope+key JSON tuple. Never a colon string. */
  key: string;
  /** sha256 of canonical({action,input}) — explicit validated input only. */
  fingerprint: string;
  action: CanvasLifecycleAction;
  scope: CanvasActionScope;
  /** Resolved instance id (the explicit or generated create target). */
  targetId: string;
  identity: CanvasActionActor;
  status: 'pending' | 'succeeded';
  result?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export type CanvasActionReplay =
  | { kind: 'none' }
  | { kind: 'pending' }
  | { kind: 'conflict' }
  | { kind: 'replay'; receipt: CanvasActionReceipt };

const SLOT = 'canvas-action-receipts';
const MAX_RECEIPTS = 4096;
const MAX_RESULT_BYTES = 8192;
const MAX_TEXT = 256;
const ACTIONS = new Set<string>(['canvas.create', 'canvas.rename', 'canvas.delete']);
const SCOPES = new Set<string>(['app', 'instance']);
const FIELDS = new Set(['receiptId', 'key', 'fingerprint', 'action', 'scope', 'targetId', 'identity', 'status', 'result', 'createdAt', 'updatedAt']);
const ACTOR_FIELDS = new Set(['teamId', 'userId', 'bizId', 'applicationId', 'applicationInstanceId']);

const cloneJson = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const boundedText = (value: unknown, max = MAX_TEXT): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f/]/.test(value);
const corrupt = (): never => { throw new CanvasStateError(503, 'CANVAS_ACTION_RECEIPTS_CORRUPT', 'Canvas action receipt journal is damaged or has an unsupported schema'); };
const unavailable = (): never => { throw new CanvasStateError(503, 'CANVAS_ACTION_RECEIPTS_UNAVAILABLE', 'Canvas action receipt journal is unavailable'); };

/** The dedupe key hashes an exact JSON tuple — identities cannot collide into
 * each other through separator ambiguity, and app/instance scopes stay apart. */
export function canvasActionKey(actor: CanvasActionActor, scope: CanvasActionScope, targetId: string, idempotencyKey: string): string {
  const scoped = scope === 'app' ? ['app'] : ['instance', targetId];
  return createHash('sha256').update(JSON.stringify([
    actor.teamId, actor.bizId ?? '', actor.userId, actor.applicationId ?? '', actor.applicationInstanceId ?? '', ...scoped, idempotencyKey,
  ])).digest('hex');
}

export function canvasActionFingerprint(action: CanvasLifecycleAction, input: Record<string, unknown>): string {
  return createHash('sha256').update(canonical({ action, input })).digest('hex');
}

export function sameCanvasActionActor(a: CanvasActionActor, b: CanvasActionActor): boolean {
  return a.teamId === b.teamId && a.userId === b.userId
    && (a.bizId ?? '') === (b.bizId ?? '')
    && (a.applicationId ?? '') === (b.applicationId ?? '')
    && (a.applicationInstanceId ?? '') === (b.applicationInstanceId ?? '');
}

function validateIdentity(value: unknown): CanvasActionActor {
  if (!isObject(value) || Object.keys(value).some(key => !ACTOR_FIELDS.has(key))) return corrupt();
  if (!boundedText(value.teamId) || !boundedText(value.userId)) return corrupt();
  for (const field of ['bizId', 'applicationId', 'applicationInstanceId'] as const) {
    if (value[field] !== undefined && !boundedText(value[field])) return corrupt();
  }
  return cloneJson(value) as unknown as CanvasActionActor;
}

function validateReceipt(value: unknown): CanvasActionReceipt {
  if (!isObject(value) || Object.keys(value).some(key => !FIELDS.has(key))) return corrupt();
  const receipt = value as unknown as CanvasActionReceipt;
  if (!boundedText(receipt.receiptId, 1024)
    || typeof receipt.key !== 'string' || !/^[a-f0-9]{64}$/.test(receipt.key)
    || typeof receipt.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(receipt.fingerprint)
    || !ACTIONS.has(receipt.action) || !SCOPES.has(receipt.scope)
    || !boundedText(receipt.targetId, 1024)) return corrupt();
  receipt.identity = validateIdentity(receipt.identity);
  if (receipt.status === 'succeeded') {
    if (!isObject(receipt.result) || JSON.stringify(receipt.result).length > MAX_RESULT_BYTES) return corrupt();
  } else if (receipt.status === 'pending') {
    if (receipt.result !== undefined) return corrupt();
  } else return corrupt();
  if (!Number.isFinite(receipt.createdAt) || !Number.isFinite(receipt.updatedAt) || receipt.createdAt <= 0 || receipt.updatedAt < receipt.createdAt) return corrupt();
  return cloneJson(receipt);
}

/** Only whitelisted fields ever reach durable storage. */
function persistReceipt(receipt: CanvasActionReceipt): CanvasActionReceipt {
  const clone: Record<string, unknown> = {};
  for (const key of FIELDS) {
    const value = (receipt as unknown as Record<string, unknown>)[key];
    if (value !== undefined) clone[key] = key === 'identity' ? validateIdentity(value) : cloneJson(value);
  }
  return clone as unknown as CanvasActionReceipt;
}

function validateSlot(value: unknown): CanvasActionReceipt[] {
  if (!isObject(value) || value.version !== 1 || !Array.isArray(value.receipts) || value.receipts.length > MAX_RECEIPTS) return corrupt();
  const seen = new Set<string>();
  return value.receipts.map(raw => {
    const receipt = validateReceipt(raw);
    if (seen.has(receipt.key)) return corrupt();
    seen.add(receipt.key);
    return receipt;
  });
}

export class CanvasActionReceipts {
  private local: CanvasActionReceipt[] = [];
  private hydrated?: Promise<void>;
  private readonly locks = new Map<string, Promise<unknown>>();
  /** Keys whose last durability flush failed; treated as pending forever so an
   * uncertain attempt is never replayed as success nor silently re-executed. */
  private readonly uncertain = new Set<string>();

  constructor(private readonly state?: JsonStatePort) {}

  private hydrate(): Promise<void> {
    if (!this.state) return Promise.resolve();
    this.hydrated ??= (async () => {
      try {
        await this.state!.ready;
        this.readAll();
      } catch (error) {
        if (error instanceof CanvasStateError) throw error;
        unavailable();
      }
    })();
    return this.hydrated;
  }

  private readAll(): CanvasActionReceipt[] {
    if (!this.state) return this.local.map(cloneJson);
    let raw: unknown;
    try { raw = this.state.read(SLOT); }
    catch { unavailable(); }
    return raw === undefined ? [] : validateSlot(raw);
  }

  /** Write the whole validated slot and flush BEFORE returning — callers rely
   * on durability, not on the in-memory stage. */
  private async writeAll(receipts: CanvasActionReceipt[], key: string): Promise<void> {
    const persisted = receipts.map(persistReceipt);
    try {
      if (this.state) {
        this.state.write(SLOT, { version: 1, receipts: persisted });
        await this.state.flush();
      } else this.local = persisted;
    } catch (error) {
      this.uncertain.add(key);
      if (error instanceof CanvasStateError) throw error;
      unavailable();
    }
  }

  /** Serializes all work under the same dedupe key: a concurrent replay waits
   * for the in-flight attempt to reach a durable outcome, then replays it. */
  async serialized<T>(key: string, run: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(key) ?? Promise.resolve();
    const next = previous.then(run, run);
    this.locks.set(key, next);
    try { return await next; }
    finally { if (this.locks.get(key) === next) this.locks.delete(key); }
  }

  async decide(key: string, fingerprint: string): Promise<CanvasActionReplay> {
    await this.hydrate();
    const receipt = this.readAll().find(row => row.key === key);
    if(receipt&&receipt.fingerprint!==fingerprint)return {kind:'conflict'};
    if (this.uncertain.has(key) || receipt?.status === 'pending') return { kind: 'pending' };
    if (!receipt) return { kind: 'none' };
    if (receipt.fingerprint !== fingerprint) return { kind: 'conflict' };
    return { kind: 'replay', receipt };
  }

  /** Reserves the dedupe key with a durable pending marker BEFORE any side
   * effect. Throws unless the pending record actually flushed. */
  async reserve(input: {
    receiptId: string; key: string; fingerprint: string;
    action: CanvasLifecycleAction; scope: CanvasActionScope; targetId: string;
    identity: CanvasActionActor;
  }): Promise<CanvasActionReceipt> {
    await this.hydrate();
    const receipts = this.readAll();
    if (this.uncertain.has(input.key) || receipts.some(row => row.key === input.key)) {
      throw new CanvasStateError(503, 'CANVAS_OPERATION_UNCERTAIN', 'A previous attempt with this idempotency key did not reach a durable result; blind retry is unsafe');
    }
    if (receipts.length >= MAX_RECEIPTS) throw new CanvasStateError(503, 'CANVAS_ACTION_RECEIPTS_FULL', 'Canvas action receipt journal reached its bound');
    const now = Date.now();
    const receipt: CanvasActionReceipt = {
      receiptId: input.receiptId, key: input.key, fingerprint: input.fingerprint,
      action: input.action, scope: input.scope, targetId: input.targetId,
      identity: cloneJson(input.identity), status: 'pending', createdAt: now, updatedAt: now,
    };
    await this.writeAll([...receipts, receipt], input.key);
    return cloneJson(receipt);
  }

  /** Completes a reserved pending record with the exact business result. The
   * pending marker stays when this flush fails — never a fake success. */
  async succeed(key: string, result: Record<string, unknown>): Promise<CanvasActionReceipt> {
    await this.hydrate();
    if (!isObject(result) || JSON.stringify(result).length > MAX_RESULT_BYTES) {
      throw new CanvasStateError(400, 'CANVAS_ACTION_RECEIPT_TOO_LARGE', 'Canvas action result exceeds the receipt payload bound');
    }
    const receipts = this.readAll();
    const index = receipts.findIndex(row => row.key === key);
    if (index < 0 || receipts[index]!.status !== 'pending') return corrupt();
    receipts[index] = { ...receipts[index]!, status: 'succeeded', result: cloneJson(result), updatedAt: Date.now() };
    await this.writeAll(receipts, key);
    return cloneJson(receipts[index]!);
  }

  /** Receipt lookup is scoped to the exact caller identity: another team's or
   * another MA business/application-instance's receipt is simply absent. */
  async findVisible(identity: CanvasActionActor, scope: CanvasActionScope, receiptId: string): Promise<CanvasActionReceipt | undefined> {
    await this.hydrate();
    const receipt = this.readAll().find(row => row.scope === scope && row.receiptId === receiptId && sameCanvasActionActor(row.identity, identity));
    if (!receipt) return undefined;
    if (!this.uncertain.has(receipt.key)) return receipt;
    const { result: _dropped, ...pending } = receipt;
    return { ...pending, status: 'pending' };
  }
}
