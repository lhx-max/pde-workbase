import { afterEach } from 'vitest';
import { Database as SqliteDatabase } from '../../src/storage/database.js';
const databases = new Set<Database>();
/** Original SQLite workflow tests use explicit in-memory databases, with cleanup. */
export default class Database extends SqliteDatabase {
  constructor(file: string) { super(file); databases.add(this); }
  override close(): void { if (databases.delete(this)) super.close(); }
}
afterEach(() => { for (const database of databases) database.close(); });
