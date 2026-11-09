import { readFileSync, writeFileSync } from 'node:fs';
import { AppwriteClient } from './appwrite-client.js';
import { CanvasStateError } from '../canvas/errors.js';
import type {JsonStatePort} from '@ks-designai/app-cloud-state';

/** One row in `apps`: a registered Design App the manage side can discover
 * and reach. Canvas registers itself implicitly; external Apps (doc/sketch/
 * browser) self-register via POST /api/apps/register. */
export interface RegisteredApp {
  appId: string;
  /** The App's own web page — opened when a host wants to show the App's
   * detail/home UI. Falls back to `endpoint` when unset. */
  webUrl?: string;
  name: string;
  /** Base URL of the App's protocol surface (e.g. https://…/api/apps/doc). */
  endpoint: string;
  /** Optional human/provider description surfaced in discovery. */
  description?: string | undefined;
  status: 'active' | 'disabled';
  /** platform = every tenant sees it; team = only its own team's catalogue. */
  scope?: 'platform' | 'team';
  teamId?: string;
  /** Capability manifest the app announced at registration — discovery
   * serves it verbatim so agents learn actions/kinds without probing. */
  manifest?: Record<string, unknown>;
  registeredAt: string;
}

const APPS = 'apps';

function isMissing(error: unknown): boolean {
  return error instanceof CanvasStateError && (error.status === 404 || error.code === 'CANVAS_NOT_FOUND');
}

/** Appwrite-backed app catalog mirrored into memory at read time. Falls back
 * to in-memory rows when the collection isn't provisioned yet. */
export class AppRegistryStore {
  private readonly memory = new Map<string, RegisteredApp>();
  private hydrated?:Promise<void>;

  constructor(private readonly client?: AppwriteClient, private readonly databaseId?: string, private readonly localPath?: string, private readonly persistManifest=true,private readonly state?:JsonStatePort) {
    // Without Appwrite the registry must still survive restarts — a dropped
    // catalogue silently disables every mounted App until it re-registers.
    if (this.localPath&&!this.state) {
      try {
        const rows = JSON.parse(readFileSync(this.localPath, 'utf8')) as RegisteredApp[];
        for (const row of Array.isArray(rows) ? rows : []) if (row?.appId && row.endpoint) this.memory.set(row.appId, row);
      } catch { /* missing/corrupt file → start empty */ }
    }
  }

  private persistLocal(): void {
    if(this.state){this.state.write('app-manifests',JSON.parse(JSON.stringify({version:1,apps:[...this.memory.values()]})));return;}
    if (!this.localPath) return;
    try { writeFileSync(this.localPath, JSON.stringify([...this.memory.values()], null, 1)); } catch { /* best-effort */ }
  }

  private path(): string { return this.client!.docsPath(this.databaseId!, APPS); }
  private async hydrate():Promise<void>{
    if(!this.state)return;
    this.hydrated??=(async()=>{
      await this.state!.ready;const raw=this.state!.read('app-manifests');if(raw===undefined)return;
      const value=raw as {version:number;apps:RegisteredApp[]};const ids=new Set<string>();
      if(!value||value.version!==1||!Array.isArray(value.apps))throw new CanvasStateError(503,'APP_CATALOG_CORRUPT','Invalid cloud App manifest catalog');
      for(const row of value.apps){
        if(!row||!row.appId||!row.name||!row.endpoint||!['active','disabled'].includes(row.status)||ids.has(row.appId)
          ||(row.scope==='team'&&!row.teamId))throw new CanvasStateError(503,'APP_CATALOG_CORRUPT','Invalid cloud App manifest row');
        ids.add(row.appId);this.memory.set(row.appId,row);
      }
    })();await this.hydrated;this.state.read('app-manifests');
  }

  async register(app: Omit<RegisteredApp, 'registeredAt'>): Promise<RegisteredApp> {
    await this.hydrate();
    const row: RegisteredApp = { ...app, registeredAt: new Date().toISOString() };
    if (this.client && this.databaseId) {
      // The apps collection is at Appwrite's attribute cap, so the manifest stays in memory and the local mirror.
      const data = { appId: row.appId, name: row.name, endpoint: row.endpoint, webUrl: row.webUrl ?? '', description: row.description ?? '', status: row.status, registeredAt: row.registeredAt, scope: row.scope ?? 'platform', teamId: row.teamId ?? '',...(this.persistManifest?{manifest:JSON.stringify(row.manifest??{})}:{}) };
      try {
        await this.client.call('PATCH', `${this.path()}/${row.appId}`, { data });
      } catch (error) {
        if (isMissing(error)) await this.client.call('POST', this.path(), { documentId: row.appId, data });
        else throw error;
      }
    }
    this.memory.set(row.appId, row);
    this.persistLocal();
    await this.state?.flush();
    return row;
  }

  async list(): Promise<RegisteredApp[]> {
    await this.hydrate();
    if (!this.client || !this.databaseId) return [...this.memory.values()];
    try {
      const body = await this.client.call<{ documents: Record<string, unknown>[] }>('GET', `${this.path()}?${AppwriteClient.query([AppwriteClient.limit(100)])}`);
      const rows = body.documents.map(doc => {
        const webUrl = String(doc.webUrl ?? '');
        const cached = this.memory.get(String(doc.appId ?? ''));
        // Older cloud schemas did not carry tenancy. Never downgrade a known
        // team registration to platform when refreshing that legacy row.
        const rawScope = doc.scope === 'platform' || doc.scope === 'team' ? doc.scope : undefined;
        const scope: RegisteredApp['scope'] = rawScope ?? cached?.scope ?? 'platform';
        const teamId = typeof doc.teamId === 'string' ? doc.teamId : cached?.teamId;
        let manifest: Record<string, unknown> | undefined = cached?.manifest;
        try {
          const value: unknown = typeof doc.manifest === 'string' ? JSON.parse(doc.manifest) : doc.manifest;
          if (value && typeof value === 'object' && !Array.isArray(value)) manifest = value as Record<string, unknown>;
        } catch { /* malformed optional manifest is not an identity fallback */ }
        return {
          scope, ...(teamId ? { teamId } : {}), ...(manifest ? { manifest } : {}),
          appId: String(doc.appId ?? ''), name: String(doc.name ?? ''), endpoint: String(doc.endpoint ?? ''),
          ...(webUrl ? { webUrl } : {}),
          description: String(doc.description ?? ''), status: (doc.status === 'disabled' ? 'disabled' : 'active') as RegisteredApp['status'],
          registeredAt: String(doc.registeredAt ?? ''),
        };
      }).filter(row => row.appId && row.endpoint);
      for (const row of rows) this.memory.set(row.appId, row);
      return rows;
    } catch (error) {
      if (isMissing(error)&&!this.state) return [...this.memory.values()];
      throw error;
    }
  }

  async get(appId: string): Promise<RegisteredApp | null> {
    await this.hydrate();
    const cached = this.memory.get(appId);
    if (cached) return cached;
    return (await this.list()).find(row => row.appId === appId) ?? null;
  }

  async unregister(appId: string): Promise<boolean> {
    const existed = Boolean(await this.get(appId));
    if (this.client && this.databaseId) {
      try { await this.client.call('DELETE', `${this.path()}/${appId}`); }
      catch (error) { if (!isMissing(error)) throw error; }
    }
    this.memory.delete(appId);
    this.persistLocal();
    await this.state?.flush();
    return existed;
  }
}
