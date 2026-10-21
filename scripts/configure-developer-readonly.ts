/** Explicit cloud ACL administration. Default audit; does not read business bodies or secrets. */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { readerPermissions, writerExecuteRoles, validateRestrictedResource } from '../apps/server/src/storage/developer-access-policy.js';

const exec = promisify(execFile);
const { values } = parseArgs({ options: {
  mode: { type: 'string', default: 'audit' }, 'config-dir': { type: 'string' }, 'backup-dir': { type: 'string' },
  cli: { type: 'string' }, writer: { type: 'string', multiple: true }, 'reader-team': { type: 'string', default: 'users' },
} });
if (!['audit', 'apply', 'restore'].includes(values.mode!)) throw new Error('mode must be audit/apply/restore');
for (const field of ['config-dir', 'backup-dir', 'cli'] as const) if (!values[field] || !path.isAbsolute(values[field]!)) throw new Error(`${field} must be absolute`);
const project = JSON.parse(await readFile(path.join(values['config-dir']!, 'appwrite-cf.config.json'), 'utf8'));
if (project.projectId !== 'grworkspace') throw new Error('This migration is restricted to grworkspace');
const expected = readerPermissions(values['reader-team']!, values.writer ?? []);
const executeRoles = writerExecuteRoles(values.writer ?? []);
async function call(args: string[]): Promise<Record<string, any>> {
  try {
    const { stdout } = await exec(process.execPath, ['--import', 'data:text/javascript,BigInt.prototype.toJSON=function(){return%20String(this)}', values.cli!, ...args, '--json'], {
      cwd: values['config-dir'], timeout: 30000, maxBuffer: 8 * 1024 * 1024,
    });
    const start = stdout.indexOf('{');
    if (start < 0) throw new Error('CLI returned no JSON object');
    return JSON.parse(stdout.slice(start));
  } catch (error) {
    // Raw command errors could include credentials from unrelated CLI diagnostics.
    throw new Error(`Appwrite ${args[0]} ${args[1]} failed; no secret output recorded`, { cause: undefined });
  }
}
type Resource = { kind: 'collection' | 'bucket' | 'function'; id: string; databaseId?: string; name: string; permissions: string[]; perItemSecurity?: boolean; enabled: boolean };
async function inspect(): Promise<Resource[]> {
  const result: Resource[] = [];
  for (const databaseId of ['canvas_app_dev', 'doc_app_dev']) {
    const listing = await call(['databases', 'list-collections', '--database-id', databaseId]);
    if (listing.total !== listing.collections.length) throw new Error('Collection pagination requires review before mutation');
    for (const row of listing.collections) result.push({ kind: 'collection', databaseId, id: row.$id, name: row.name, permissions: row.$permissions, perItemSecurity: row.documentSecurity, enabled: row.enabled });
  }
  for (const id of ['canvas_assets_v2', 'doc_assets_v2']) {
    const row = await call(['storage', 'get-bucket', '--bucket-id', id]);
    result.push({ kind: 'bucket', id, name: row.name, permissions: row.$permissions, perItemSecurity: row.fileSecurity, enabled: row.enabled });
  }
  for (const id of ['canvas-coi', 'doc-api']) {
    const row = await call(['functions', 'get', '--function-id', id]);
    result.push({ kind: 'function', id, name: row.name, permissions: row.execute, enabled: row.enabled });
  }
  return result;
}
const backupFile = path.join(values['backup-dir']!, 'before.json');
await mkdir(values['backup-dir']!, { recursive: true, mode: 0o700 });
const before = await inspect();
console.log(JSON.stringify({ mode: values.mode, resources: before, proposedPermissions: expected, proposedExecute: executeRoles }));
if (values.mode === 'audit') {
  await writeFile(path.join(values['backup-dir']!, 'plan.json'), JSON.stringify({ projectId: project.projectId, readerTeam: values['reader-team'], writers: values.writer, resources: before, proposedPermissions: expected, proposedExecute: executeRoles }, null, 2), { mode: 0o600 });
  process.exit(0);
}
async function update(resource: Resource, permissions: string[]) {
  if (resource.kind === 'collection') await call(['databases', 'update-collection', '--database-id', resource.databaseId!, '--collection-id', resource.id, '--name', resource.name, '--permissions', ...permissions]);
  else if (resource.kind === 'bucket') await call(['storage', 'update-bucket', '--bucket-id', resource.id, '--name', resource.name, '--permissions', ...permissions]);
  else await call(['functions', 'update', '--function-id', resource.id, '--name', resource.name, '--execute', ...permissions]);
}
if (values.mode === 'restore') {
  const backup = JSON.parse(await readFile(backupFile, 'utf8')) as { resources: Resource[] };
  // Only restore ACL fields from this known resource inventory; no arbitrary targets.
  for (const row of backup.resources) {
    const current = before.find(x => x.kind === row.kind && x.id === row.id && x.databaseId === row.databaseId);
    if (!current) throw new Error('Backup contains an unexpected resource');
    await update(current, row.permissions);
  }
  await writeFile(path.join(values['backup-dir']!, 'restored.json'), JSON.stringify(await inspect(), null, 2), { mode: 0o600 });
  process.exit(0);
}
if (before.some(row => row.perItemSecurity === true)) throw new Error('Per-item ACLs need independent inspection; refusing to hide them by changing security flags');
// The company CLI permits /account but may forbid project-wide /users reads.
const account = await call(['account', 'get']);
for (const writer of values.writer!) {
  const user = account.$id === writer ? account : await call(['users', 'get', '--user-id', writer]);
  if (user.$id !== writer || user.status === false) throw new Error('Writer identity missing/disabled');
}
const teamId = values['reader-team']!;
if (teamId !== 'users') {
  const teams = await call(['teams', 'list', '--queries', JSON.stringify({ method: 'equal', attribute: '$id', values: [teamId] })]);
  if (!teams.teams.some((team: { $id: string }) => team.$id === teamId)) await call(['teams', 'create', '--team-id', teamId, '--name', 'Canvas and Doc Developer Readers']);
}
// Exclusive backup avoids replacing the pre-change state on reruns.
await writeFile(backupFile, JSON.stringify({ projectId: project.projectId, recordedAt: new Date().toISOString(), resources: before }, null, 2), { mode: 0o600, flag: 'wx' });
try {
  // Close writer-function bypass first; preserve function code/scopes/runtime.
  for (const row of [...before].sort((a, b) => Number(b.kind === 'function') - Number(a.kind === 'function'))) await update(row, row.kind === 'function' ? executeRoles : expected);
  const after = await inspect();
  for (const row of after) {
    if (row.kind === 'function') {
      if (JSON.stringify([...row.permissions].sort()) !== JSON.stringify([...executeRoles].sort())) throw new Error('Function writer restriction did not persist');
    } else validateRestrictedResource(row.permissions, expected, row.perItemSecurity ?? true);
  }
  await writeFile(path.join(values['backup-dir']!, 'after.json'), JSON.stringify({ verifiedAt: new Date().toISOString(), projectId: project.projectId, readerTeam: teamId, writers: values.writer, resources: after }, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ configured: true, resources: after.length, readerTeam: teamId, writers: values.writer, backupFile }));
} catch (error) {
  // Do not auto-reopen unsafe broad permissions after a partial restriction.
  await writeFile(path.join(values['backup-dir']!, 'failed.json'), JSON.stringify({ partial: true, rollbackCommand: 'rerun this tool with --mode restore and the same backup/config arguments' }, null, 2), { mode: 0o600 });
  throw error;
}
