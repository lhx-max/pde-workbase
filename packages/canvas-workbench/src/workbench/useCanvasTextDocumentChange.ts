import { useEffect, useRef } from 'react';
import type { TextDocumentChange } from '../platform/artifact-bridge';

// Notifications are one-shot, not retained document state. A host may keep the
// same notification while a project-keyed Workbench unmounts/remounts.
const consumedNotifications = new WeakSet<TextDocumentChange>();

/** Consume a save notification once, never because the state setter changed.
 * Producers should always tag projectId; legacy unscoped notifications are
 * accepted only in the initial project of this hook instance. */
export function useCanvasTextDocumentChange(
  projectId: string,
  change: TextDocumentChange | null | undefined,
  apply: (change: TextDocumentChange) => void,
): void {
  const applyRef = useRef(apply);
  applyRef.current = apply;
  const initialProjectRef = useRef(projectId);
  const scopeChangedRef = useRef(false);
  const versionsRef = useRef(new Map<string, { revision: number; contents: Set<string> }>());

  useEffect(() => {
    if (projectId !== initialProjectRef.current) scopeChangedRef.current = true;
    if (!change || consumedNotifications.has(change)) return;
    if (change.projectId ? change.projectId !== projectId : scopeChangedRef.current) return;
    const key = JSON.stringify([projectId, change.path]);
    const seen = versionsRef.current.get(key);
    // Also reject clones of the same notification and delayed older revisions.
    if (seen && (change.revision < seen.revision || (change.revision === seen.revision && seen.contents.has(change.content)))) return;
    const contents = seen?.revision === change.revision ? seen.contents : new Set<string>();
    contents.add(change.content);
    versionsRef.current.set(key, { revision: change.revision, contents });
    consumedNotifications.add(change);
    applyRef.current(change);
  }, [projectId, change]);
}
