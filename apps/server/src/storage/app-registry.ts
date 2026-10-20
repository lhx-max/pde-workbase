import { AppwriteClient } from './appwrite-client.js';
import { CanvasStateError } from '../canvas/errors.js';

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

  constructor(private readonly client?: AppwriteClient, private readonly databaseId?: string) {}

  private path(): string { return this.client!.docsPath(this.databaseId!, APPS); }

  async register(app: Omit<RegisteredApp, 'registeredAt'>): Promise<RegisteredApp> {
    const row: RegisteredApp = { ...app, registeredAt: new Date().toISOString() };
    this.memory.set(row.appId, row);
    if (this.client && this.databaseId) {
      const data = { appId: row.appId, name: row.name, endpoint: row.endpoint, webUrl: row.webUrl ?? '', description: row.description ?? '', status: row.status, registeredAt: row.registeredAt };
      try {
        await this.client.call('PATCH', `${this.path()}/${row.appId}`, { data });
      } catch (error) {
        if (isMissing(error)) await this.client.call('POST', this.path(), { documentId: row.appId, data }).catch(e => { if (!isMissing(e)) throw e; });
        else throw error;
      }
    }
    return row;
  }

  async list(): Promise<RegisteredApp[]> {
    if (!this.client || !this.databaseId) return [...this.memory.values()];
    try {
      const body = await this.client.call<{ documents: Record<string, unknown>[] }>('GET', `${this.path()}?${AppwriteClient.query([AppwriteClient.limit(100)])}`);
      const rows = body.documents.map(doc => {
        const webUrl = String(doc.webUrl ?? '');
        return {
          appId: String(doc.appId ?? ''), name: String(doc.name ?? ''), endpoint: String(doc.endpoint ?? ''),
          ...(webUrl ? { webUrl } : {}),
          description: String(doc.description ?? ''), status: (doc.status === 'disabled' ? 'disabled' : 'active') as RegisteredApp['status'],
          registeredAt: String(doc.registeredAt ?? ''),
        };
      }).filter(row => row.appId && row.endpoint);
      for (const row of rows) this.memory.set(row.appId, row);
      return rows;
    } catch (error) {
      if (isMissing(error)) return [...this.memory.values()];
      throw error;
    }
  }

  async get(appId: string): Promise<RegisteredApp | null> {
    const cached = this.memory.get(appId);
    if (cached) return cached;
    return (await this.list()).find(row => row.appId === appId) ?? null;
  }

  async unregister(appId: string): Promise<boolean> {
    const existed = this.memory.delete(appId) || Boolean(await this.list().then(rows => rows.find(r => r.appId === appId)));
    if (this.client && this.databaseId) {
      try { await this.client.call('DELETE', `${this.path()}/${appId}`); }
      catch (error) { if (!isMissing(error)) throw error; }
    }
    return existed;
  }
}
