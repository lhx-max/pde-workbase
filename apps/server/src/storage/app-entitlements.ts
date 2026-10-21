import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

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

export class AppEntitlementStore {
  private readonly file: string;
  constructor(dataRoot: string) {
    mkdirSync(dataRoot, { recursive: true });
    this.file = path.join(dataRoot, 'app-entitlements.json');
  }

  private load(): State {
    try {
      const state = JSON.parse(readFileSync(this.file, 'utf8')) as State;
      return state.version === 1 && Array.isArray(state.rules) ? state : { version: 1, rules: [] };
    } catch { return { version: 1, rules: [] }; }
  }

  private save(state: State) {
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
