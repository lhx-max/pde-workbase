import { AppwriteClient } from './appwrite-client.js';
import { CanvasStateError } from '../canvas/errors.js';

/** One row in `card_packs`: a mounted card pack's public registration. */
export interface CardPackRegistration {
  packId: string;
  team: string;
  name?: string | undefined;
  version?: string | undefined;
  /** Card kinds this pack provides (`card.<team>.<name>` or core overrides). */
  kinds: string[];
  /** Registered `card.<team>.<name>.<verb>` action ids. */
  ops: string[];
  /** How a host should render these kinds (module name now; bundle URL later). */
  renderEntry?: string;
  status: 'active' | 'disabled';
}

/** One row in `card_grants`: which card kinds a scope may use.
 * `scope` is `team:<id>`, `project:<id>` or `*` (default). */
export interface CardGrant {
  scope: string;
  /** Allowed kind list; `["*"]` means every registered kind. */
  allowedKinds: string[];
  /** Where this grant came from: `local` admin row or `ma` (upstream permission API). */
  source: 'local' | 'ma';
}

const PACKS = 'card_packs';
const GRANTS = 'card_grants';

function isMissing(error: unknown): boolean {
  return error instanceof CanvasStateError && (error.status === 404 || error.code === 'CANVAS_NOT_FOUND');
}

/** Appwrite-backed card-pack registry + per-scope card entitlements.
 * The mounted-pack list is the write source; the collection mirrors it so the
 * manage side and other services can discover card capabilities without
 * reaching this server. Grant rows are written by admins (local) or synced
 * from the upstream team-permission API (ma). */
export class CardRegistryStore {
  constructor(private readonly client: AppwriteClient, private readonly databaseId: string) {}

  private packsPath(): string { return this.client.docsPath(this.databaseId, PACKS); }
  private grantsPath(): string { return this.client.docsPath(this.databaseId, GRANTS); }

  /** Upsert one pack document keyed by packId. Best-effort: a missing
   * collection means provisioning hasn't run — log-shaped error propagates. */
  async upsertPack(pack: CardPackRegistration): Promise<void> {
    const data = {
      packId: pack.packId, team: pack.team, name: pack.name ?? pack.packId,
      version: pack.version ?? '', kinds: JSON.stringify(pack.kinds),
      ops: JSON.stringify(pack.ops), renderEntry: pack.renderEntry ?? '',
      status: pack.status, updatedAt: new Date().toISOString(),
    };
    try {
      await this.client.call('PATCH', `${this.packsPath()}/${pack.packId}`, { data });
    } catch (error) {
      if (!isMissing(error)) throw error;
      await this.client.call('POST', this.packsPath(), { documentId: pack.packId, data });
    }
  }

  async listPacks(): Promise<CardPackRegistration[]> {
    try {
      const body = await this.client.call<{ documents: Record<string, unknown>[] }>('GET', `${this.packsPath()}?${AppwriteClient.query([AppwriteClient.limit(100)])}`);
      return body.documents.map(doc => ({
        packId: String(doc.packId ?? ''), team: String(doc.team ?? ''), name: String(doc.name ?? ''),
        version: String(doc.version ?? ''), kinds: JSON.parse(String(doc.kinds ?? '[]')) as string[],
        ops: JSON.parse(String(doc.ops ?? '[]')) as string[], renderEntry: String(doc.renderEntry ?? ''),
        status: (doc.status === 'disabled' ? 'disabled' : 'active') as CardPackRegistration['status'],
      })).filter(pack => pack.packId);
    } catch (error) {
      if (isMissing(error)) return [];
      throw error;
    }
  }

  /** Appwrite document ids reject `:`/`*` — scope stays in the attribute. */
  private grantDocId(scope: string): string { return scope.replace(/[^a-zA-Z0-9._-]/g, '_'); }

  async getGrant(scope: string): Promise<CardGrant | null> {
    const doc = await this.client.getOrNull<Record<string, unknown>>(`${this.grantsPath()}/${this.grantDocId(scope)}`).catch(() => null);
    if (!doc) return null;
    return {
      scope: String(doc.scope ?? scope),
      allowedKinds: JSON.parse(String(doc.allowedKinds ?? '[]')) as string[],
      source: doc.source === 'ma' ? 'ma' : 'local',
    };
  }

  async upsertGrant(grant: CardGrant): Promise<void> {
    const data = { scope: grant.scope, allowedKinds: JSON.stringify(grant.allowedKinds), source: grant.source, updatedAt: new Date().toISOString() };
    try {
      await this.client.call('PATCH', `${this.grantsPath()}/${this.grantDocId(grant.scope)}`, { data });
    } catch (error) {
      if (!isMissing(error)) throw error;
      await this.client.call('POST', this.grantsPath(), { documentId: this.grantDocId(grant.scope), data });
    }
  }

  /** Resolve the allowed kind set for a canvas scope.
   * Order: `project:<id>` → `team:<id>` → `*` → undefined (unrestricted).
   * A grant row is authoritative for its scope: explicit `[]` = no cards. */
  async resolveAllowedKinds(scope: { projectId: string; teamId?: string }): Promise<string[] | undefined> {
    for (const key of [`project:${scope.projectId}`, ...(scope.teamId ? [`team:${scope.teamId}`] : []), '*']) {
      const grant = await this.getGrant(key);
      if (grant) return grant.allowedKinds;
    }
    return undefined;
  }
}
