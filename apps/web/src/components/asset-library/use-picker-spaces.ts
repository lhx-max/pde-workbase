import { useEffect, useMemo, useState } from 'react';
import type { WorkspaceCollabContext } from '@bezier/contracts';
import { readProjectFolders, readSelectedProjectFolderId, PROJECT_FOLDERS_CHANGED_EVENT, DEFAULT_PROJECT_FOLDER_ID } from '../../state/project-folders';
import { personalAssets } from '../../providers/asset-library';

/** Compatibility projection; no installed design-system product is loaded. */
export function designSystemSpace(system: { projectId?: string }, projectSpaces: Readonly<Record<string, string>>): string {
  return (system.projectId && projectSpaces[system.projectId]) || DEFAULT_PROJECT_FOLDER_ID;
}

/** Local spaces retain the original picker shape without account/team directory state. */
export function usePickerSpaces(_context: WorkspaceCollabContext | null | undefined, enabled = true) {
  const scope = 'local';
  const [space, setSpace] = useState(() => readSelectedProjectFolderId(scope) ?? DEFAULT_PROJECT_FOLDER_ID);
  const [revision, setRevision] = useState(0);
  const [remote, setRemote] = useState<{ id: string; name: string; createdAt: number }[] | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let current = true;
    const refresh = () => {
      setRevision(value => value + 1);
      void personalAssets.spaces(scope).then(result => { if (current) setRemote(result.folders); }).catch(() => {});
    };
    refresh();
    window.addEventListener(PROJECT_FOLDERS_CHANGED_EVENT, refresh);
    window.addEventListener('storage', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      current = false;
      window.removeEventListener(PROJECT_FOLDERS_CHANGED_EVENT, refresh);
      window.removeEventListener('storage', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [enabled]);
  const folders = useMemo(() => {
    const cached = readProjectFolders(scope);
    if (!remote) return cached;
    return [cached.find(folder => folder.id === DEFAULT_PROJECT_FOLDER_ID)!, ...remote.filter(folder => folder.id !== DEFAULT_PROJECT_FOLDER_ID)];
  }, [remote, revision]);
  const projectSpaces: Record<string, string> = {};
  return { space: folders.some(folder => folder.id === space) ? space : DEFAULT_PROJECT_FOLDER_ID, setSpace, folders, projectSpaces, projectsReady: enabled };
}
