import { parseCanvasBrowserPreferences, type CanvasBrowserPreferencesSnapshot, type CanvasBrowserPreferencesUpdate } from '@bezier/contracts';
import type { Database } from '../storage/database.js';

/** One browser profile per explicit workspace database; no origin-local persistence. */
export class BrowserPreferencesService {
  constructor(private readonly db: Database) {
    db.exec('CREATE TABLE IF NOT EXISTS browser_preferences (id INTEGER PRIMARY KEY CHECK (id = 1), revision INTEGER NOT NULL, preferences TEXT NOT NULL)');
  }
  read(): CanvasBrowserPreferencesSnapshot {
    const row = this.db.prepare('SELECT revision, preferences FROM browser_preferences WHERE id = 1').get() as { revision: number; preferences: string } | undefined;
    if (!row) return { revision: 0, preferences: {} };
    try { return { revision: row.revision, preferences: parseCanvasBrowserPreferences(JSON.parse(row.preferences)) }; }
    catch { throw Object.assign(new Error('Stored browser preferences are invalid; refusing to overwrite them'), { status: 500, code: 'BROWSER_PREFERENCES_CORRUPT' }); }
  }
  update(input: CanvasBrowserPreferencesUpdate): CanvasBrowserPreferencesSnapshot {
    if (!input || !Number.isSafeInteger(input.revision) || input.revision < 0) throw Object.assign(new Error('A browser preference revision is required'), { status: 400, code: 'BROWSER_PREFERENCES_INVALID' });
    let patch;
    try { patch = parseCanvasBrowserPreferences(input.patch); }
    catch { throw Object.assign(new Error('Invalid browser preference update'), { status: 400, code: 'BROWSER_PREFERENCES_INVALID' }); }
    return this.db.transaction(() => {
      const current = this.read();
      if (current.revision !== input.revision) throw Object.assign(new Error('Browser preferences changed; reload before saving'), { status: 409, code: 'BROWSER_PREFERENCES_CONFLICT' });
      const next = { revision: current.revision + 1, preferences: { ...current.preferences, ...patch } };
      this.db.prepare('INSERT INTO browser_preferences (id, revision, preferences) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET revision = excluded.revision, preferences = excluded.preferences').run(next.revision, JSON.stringify(next.preferences));
      return next;
    }).immediate();
  }
}
