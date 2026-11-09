import { expect, it, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Database } from '../../src/storage/database.js';
import { acceptMediaRequest, MediaRequestConflict } from '../../src/media/request-identity.js';
import { insertMediaTask, migrateMediaTasks } from '../../src/media/tasks.js';
import { hydrateMediaJournal, snapshotMediaJournal } from '../../src/media/cloud-task-journal.js';
import { runWithRequestTenant, type TenantContext } from '../../src/tenant.js';

const PROJECT = 'p1';
/** A fully populated verified MA caller; userVerified:true is what the trusted
 * authority marks, not something a client can claim. */
const VERIFIED = { teamId: 'team-a', bizId: 'biz-a', userId: 'user-a', applicationId: 'app-image', applicationInstanceId: 'inst-a', providerInstanceId: 'pid-a' };
const caller = (over: Record<string, unknown> = {}): TenantContext =>
    ({ ...VERIFIED, ...over, userVerified: true }) as unknown as TenantContext;

const open: Database[] = [];
afterEach(() => { for (const db of open.splice(0)) db.close(); });
function makeDb(): Database {
    const db = new Database(':memory:');
    db.exec('CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY)');
    migrateMediaTasks(db);
    db.exec('CREATE TABLE IF NOT EXISTS media_adapter_requests(task_id TEXT PRIMARY KEY REFERENCES media_tasks(id) ON DELETE CASCADE, request_json TEXT NOT NULL)');
    db.exec('CREATE TABLE IF NOT EXISTS media_canvas_deliveries(task_id TEXT PRIMARY KEY REFERENCES media_tasks(id) ON DELETE CASCADE, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, target_json TEXT NOT NULL, status TEXT NOT NULL DEFAULT \'pending\', error TEXT)');
    db.prepare('INSERT INTO projects(id) VALUES(?)').run(PROJECT);
    open.push(db);
    return db;
}
const claim = (db: Database, request: Record<string, unknown>, taskId: string) =>
    acceptMediaRequest(db, PROJECT, request, () => insertMediaTask(db, { id: taskId, projectId: PROJECT, surface: 'image', model: 'test-image' }), taskId);
function expectThrown(fn: () => unknown, match: { status?: number; code?: string }) {
    try { fn(); } catch (error) { expect(error).toMatchObject(match); return; }
    expect.unreachable('expected the call to throw');
}
const claimIds = (db: Database) => (db.prepare('SELECT request_id AS id FROM media_task_requests').all() as Array<{ id: string }>).map(row => row.id);

it('stores caller-scoped claim ids for verified callers and replays only within the same scope', () => {
    const db = makeDb();
    const request = { surface: 'image', model: 'test-image', prompt: 'red', clientRequestId: 'shared-key' };
    const first = runWithRequestTenant(caller(), () => claim(db, request, 'canvas-a1'));
    expect(first.created).not.toBeNull();
    const replay = runWithRequestTenant(caller(), () => claim(db, request, 'canvas-a1'));
    expect(replay).toMatchObject({ taskId: 'canvas-a1', created: null });
    const stored = claimIds(db);
    expect(stored).toHaveLength(1);
    expect(stored[0]).not.toBe('shared-key');
    expect(stored[0]).toMatch(/^mrq-[a-f0-9]{64}$/);
    // A different verified user with the same raw key gets an independent claim.
    const other = runWithRequestTenant(caller({ userId: 'user-b' }), () => claim(db, request, 'canvas-b1'));
    expect(other).toMatchObject({ taskId: 'canvas-b1' });
    expect(claimIds(db)).toHaveLength(2);
    expect(runWithRequestTenant(caller({ userId: 'user-b' }), () => claim(db, request, 'canvas-b1')))
        .toMatchObject({ taskId: 'canvas-b1', created: null });
    // The same actor with a changed request body conflicts against its own claim.
    let changed: unknown;
    try { runWithRequestTenant(caller(), () => claim(db, { ...request, prompt: 'changed' }, 'canvas-c1')); }
    catch (error) { changed = error; }
    expect(changed).toBeInstanceOf(MediaRequestConflict);
});

it('isolates the claim id when any single identity field changes', () => {
    const db = makeDb();
    const request = { surface: 'image', model: 'test-image', clientRequestId: 'k' };
    claim(db, request, 't-base');
    const before = claimIds(db);
    for (const field of ['teamId', 'bizId', 'userId', 'applicationId', 'applicationInstanceId', 'providerInstanceId'] as const) {
        runWithRequestTenant(caller({ [field]: `changed-${field}` }), () => claim(db, request, `t-${field}`));
    }
    const after = claimIds(db);
    expect(after).toHaveLength(before.length + 6);
    expect(new Set(after).size).toBe(after.length);
});

it('keeps raw claim keys for background and explicitly unverified callers', () => {
    const db = makeDb();
    const request = { surface: 'image', model: 'test-image', clientRequestId: 'raw-key' };
    // Background work (no request tenant) and local header identity stay legacy.
    claim(db, request, 'bg-1');
    runWithRequestTenant({ teamId: 't', userId: 'u' }, () => claim(db, { ...request, clientRequestId: 'local-key' }, 'bg-2'));
    runWithRequestTenant({ ...VERIFIED, userVerified: false } as unknown as TenantContext, () => claim(db, { ...request, clientRequestId: 'off-key' }, 'bg-3'));
    expect(claimIds(db).sort()).toEqual(['local-key', 'off-key', 'raw-key']);
    expect(claim(db, request, 'bg-1')).toMatchObject({ taskId: 'bg-1', created: null });
});

it('rejects a verified caller with incomplete identity before any claim or task write', () => {
    const db = makeDb();
    for (const field of ['teamId', 'bizId', 'userId', 'applicationId', 'applicationInstanceId', 'providerInstanceId'] as const) {
        const incomplete = { ...VERIFIED, [field]: '', userVerified: true } as unknown as TenantContext;
        let created = 0;
        expectThrown(() => runWithRequestTenant(incomplete, () =>
            acceptMediaRequest(db, PROJECT, { clientRequestId: `k-${field}` }, () => { created++; return { id: `t-${field}` }; }, `t-${field}`)),
            { status: 503, code: 'MEDIA_CALLER_SCOPE_UNAVAILABLE' });
        expect(created).toBe(0);
    }
    expect(claimIds(db)).toHaveLength(0);
    expect(db.prepare('SELECT count(*) AS n FROM media_tasks').get()).toMatchObject({ n: 0 });
});

it('fails a cross-caller delivery task-id collision before create instead of returning the other task', () => {
    const db = makeDb();
    const uuid = randomUUID();
    const request = { surface: 'image', model: 'test-image', prompt: 'x', clientRequestId: uuid };
    runWithRequestTenant(caller(), () => claim(db, request, `canvas-${uuid}`));
    let created = 0;
    expectThrown(() => runWithRequestTenant(caller({ userId: 'user-b' }), () =>
        acceptMediaRequest(db, PROJECT, request, () => { created++; return insertMediaTask(db, { id: `canvas-${uuid}`, projectId: PROJECT }); }, `canvas-${uuid}`)),
        { status: 409, code: 'MEDIA_REQUEST_ID_CONFLICT' });
    expect(created).toBe(0);
    expect(claimIds(db)).toHaveLength(1);
});

it('replays the scoped claim unchanged after a journal snapshot and restore', () => {
    const a = makeDb(), b = makeDb();
    const request = { surface: 'image', model: 'test-image', prompt: 'keep', clientRequestId: randomUUID() };
    const first = runWithRequestTenant(caller(), () => claim(a, request, 'canvas-restored'));
    hydrateMediaJournal(b, snapshotMediaJournal(a));
    const replay = runWithRequestTenant(caller(), () => claim(b, request, 'canvas-restored'));
    expect(replay).toMatchObject({ taskId: first.taskId, created: null });
    // A different verified caller still cannot adopt the restored claim or task.
    expectThrown(() => runWithRequestTenant(caller({ applicationInstanceId: 'inst-b' }), () => claim(b, request, 'canvas-restored')),
        { status: 409, code: 'MEDIA_REQUEST_ID_CONFLICT' });
});

it('requires an explicit key for a verified caller and rejects malformed identity without writes',()=>{
 const db=makeDb();let writes=0;
 expectThrown(()=>runWithRequestTenant(caller(),()=>acceptMediaRequest(db,PROJECT,{},()=>{writes++;return{id:'never'};})),{status:428,code:'MEDIA_IDEMPOTENCY_REQUIRED'});
 for(const value of [' ', 'bad\nidentity', 'x'.repeat(513)])expectThrown(()=>runWithRequestTenant(caller({userId:value}),()=>claim(db,{clientRequestId:'key'},'never')),{status:503,code:'MEDIA_CALLER_SCOPE_UNAVAILABLE'});
 expect(writes).toBe(0);expect(claimIds(db)).toHaveLength(0);
});
