/** Compatibility boundary for persisted plugin snapshots. Retired atom entries
 * are ignored without rewriting user data or disabling the remaining pipeline.
 * This does not replace normal catalog validation for unknown atom IDs. */
export function isRetiredPluginAtom(atomId: string): boolean {
  return atomId === 'critique-theater';
}
