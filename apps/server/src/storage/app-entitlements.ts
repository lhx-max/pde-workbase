import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { JsonStatePort } from '@ks-designai/app-cloud-state';

/** App entitlement governance table (spec §3.0). Operators control which
 * teams/users can see and use each App. Resolution order is most-specific
 * first: `user:<id>` > `team:<id>` > `*`. A row absent means default allow —
 * the table only needs to hold overrides. */
export interface AppEntitlementRule {
  id: string;
  /** '*', 'team:<teamId>', or 'user:<userId>' — most specific wins. */
  scope: string;
  appId: string;
  effect: 'allow' | 'deny';
  updatedAt: string;
  updatedBy?: string;
}

interface State { version: 1; rules: AppEntitlementRule[] }

const fail = (code: string, message: string): never => {
  throw Object.assign(new Error(message), { status: 500, code });
};
const nonempty = (field: unknown): field is string => typeof field === 'string' && field.trim().length > 0;
const cloneJson = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function validateState(value: unknown): State {
  const state = value as State | null;
  if (!state || typeof state !== 'object' || Array.isArray(state) || state.version !== 1 || !Array.isArray(state.rules)
    || !state.rules.every(rule => rule && typeof rule === 'object' && !Array.isArray(rule)
      && [rule.id, rule.scope, rule.appId, rule.updatedAt].every(nonempty)
      && (rule.scope === '*' || /^(team|user):[A-Za-z0-9_-]+$/.test(rule.scope))
      && (rule.effect === 'allow' || rule.effect === 'deny')
      && (rule.updatedBy === undefined || typeof rule.updatedBy === 'string'))) {
    return fail('APP_ENTITLEMENTS_CORRUPT', 'App entitlement policy is damaged or has an unsupported schema');
  }
  return state;
}

export class AppEntitlementStore {
  private readonly file: string;
  private readonly state: JsonStatePort | undefined;
  constructor(dataRoot: string, state?: JsonStatePort) {
    this.state = state;
    // With an injected state port the 'app-entitlements' slot is authoritative:
    // no local file or directory is created, read, or imported.
    if (!state) mkdirSync(dataRoot, { recursive: true });
    this.file = path.join(dataRoot, 'app-entitlements.json');
  }

  private load(): State {
    if (this.state) {
      // An absent slot is a fresh namespace; present data must validate exactly.
      const value = this.state.read('app-entitlements');
      return value === undefined ? { version: 1, rules: [] } : cloneJson(validateState(value));
    }
    let serialized: string;
    try { serialized = readFileSync(this.file, 'utf8'); }
    catch (error) {
      // Only a genuinely absent table means no overrides. An unreadable deny
      // policy must never become the default-allow empty policy.
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, rules: [] };
      return fail('APP_ENTITLEMENTS_STORAGE_ERROR', 'App entitlement policy could not be read');
    }
    let value: unknown;
    try { value = JSON.parse(serialized); }
    catch { return fail('APP_ENTITLEMENTS_CORRUPT', 'App entitlement policy is damaged or has an unsupported schema'); }
    return validateState(value);
  }

  private save(state: State) {
    if (this.state) { this.state.write('app-entitlements', cloneJson(validateState(state))); return; }
    const tmp = `${this.file}.${randomUUID()}.tmp`;
    writeFileSync(tmp, JSON.stringify(state, null, 2), { flag: 'wx', mode: 0o600 });
    renameSync(tmp, this.file);
  }

  list(appId?: string): AppEntitlementRule[] {
    const rules = this.load().rules;
    return appId ? rules.filter(r => r.appId === appId) : rules;
  }

  /** Upsert one rule row (idempotent by scope+appId). */
  put(input: { scope: string; appId: string; effect: 'allow' | 'deny'; updatedBy?: string }): AppEntitlementRule {
    const state = this.load();
    const existing = state.rules.findIndex(r => r.scope === input.scope && r.appId === input.appId);
    const row: AppEntitlementRule = {
      id: existing >= 0 ? state.rules[existing]!.id : `ent-${randomUUID().slice(0, 8)}`,
      scope: input.scope, appId: input.appId, effect: input.effect,
      updatedAt: new Date().toISOString(),
      ...(input.updatedBy ? { updatedBy: input.updatedBy } : {}),
    };
    if (existing >= 0) state.rules[existing] = row; else state.rules.push(row);
    this.save(state);
    return row;
  }

  remove(scope: string, appId: string): boolean {
    const state = this.load();
    const index = state.rules.findIndex(r => r.scope === scope && r.appId === appId);
    if (index < 0) return false;
    state.rules.splice(index, 1);
    this.save(state);
    return true;
  }

  /** Resolve effective access: most specific scope wins; deny at that level
   * overrides; no rule = allow (default open, operators write overrides). */
  resolve(appId: string, tenant: { teamId: string; userId: string }): 'allow' | 'deny' {
    const rules = this.load().rules.filter(r => r.appId === appId);
    for (const scope of [`user:${tenant.userId}`, `team:${tenant.teamId}`, '*']) {
      const hit = rules.find(r => r.scope === scope);
      if (hit) return hit.effect;
    }
    return 'allow';
  }
}
