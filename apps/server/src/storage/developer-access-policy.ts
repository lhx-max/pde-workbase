/** Permission plan only. Credentials and cloud mutations belong to the admin tool. */
const identifier = (value: string): string => {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,35}$/.test(value)) throw new Error('Invalid Appwrite role identifier');
  return value;
};
export function writerExecuteRoles(writers: string[]): string[] {
  if (!writers.length) throw new Error('At least one verified service/maintenance writer is required');
  return [...new Set(writers.map(identifier))].sort().map(id => `user:${id}`);
}
export function readerPermissions(readerTeam: string, writers: string[]): string[] {
  const roles = writerExecuteRoles(writers);
  const readRole = readerTeam === 'users' ? 'users' : `team:${identifier(readerTeam)}`;
  return [`read("${readRole}")`, ...roles.flatMap(role =>
    ['read', 'create', 'update', 'delete'].map(action => `${action}("${role}")`))].sort();
}
export function validateRestrictedResource(actual: string[], expected: string[], perItemSecurity: boolean): void {
  if (perItemSecurity) throw new Error('Individual row/file permissions could bypass the restricted resource ACL');
  if (JSON.stringify([...actual].sort()) !== JSON.stringify([...expected].sort())) throw new Error('Cloud permissions differ from the approved policy');
}
