// Original sidebar dropdown and space editor affordances, backed by acknowledged local CRUD.
import { useEffect, useRef, useState } from 'react';
import { PERSONAL_ASSET_CHANGED_EVENT, type AssetLibrarySpacesPatch } from '@bezier/contracts';
import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from './ui';
import { Icon } from './Icon';
import { useI18n } from '../i18n';
import { getActiveAssetLibraryAdapter, getAssetLibrarySourceId } from '../providers/asset-library';
import { DEFAULT_PROJECT_FOLDER_ID, syncProjectFolders, type ProjectFolderGroup } from '../state/project-folders';
import { useWorkspaceSpaceCopy, WorkspaceSpaceEditorDialogs } from './WorkspaceSpacePicker';
import styles from './CanvasAssetsSidebar.module.css';

type Action = { kind: 'create'; id: string; createdAt: number } | { kind: 'rename' | 'delete'; space: ProjectFolderGroup };
export interface AssetLibrarySpacePickerProps {
  scope: 'local';
  value: string;
  spaces: ProjectFolderGroup[];
  onChange: (id: string) => void;
  onRefresh: () => void | Promise<void>;
  viewerOnly?: boolean;
}

/** No optimistic outbox: success, selection and dialog closure follow the server acknowledgement. */
export function AssetLibrarySpacePicker({ scope, value, spaces, onChange, onRefresh, viewerOnly = false }: AssetLibrarySpacePickerProps) {
  const { t } = useI18n();
  const copy = useWorkspaceSpaceCopy();
  const [rows, setRows] = useState(spaces);
  const [action, setAction] = useState<Action | null>(null);
  const [name, setName] = useState('');
  const [moveContents, setMoveContents] = useState(true);
  const [targetId, setTargetId] = useState(DEFAULT_PROJECT_FOLDER_ID);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const saving = useRef(false);
  const generation = useRef(0);
  const mounted = useRef(false);
  const source = useRef({ adapter: getActiveAssetLibraryAdapter(), id: getAssetLibrarySourceId() });
  useEffect(() => { setRows(spaces); }, [spaces]);
  useEffect(() => {
    mounted.current = true;
    const changed = () => {
      const next = { adapter: getActiveAssetLibraryAdapter(), id: getAssetLibrarySourceId() };
      if (source.current.adapter === next.adapter && source.current.id === next.id) return;
      source.current = next; generation.current++;
      saving.current = false; setBusy(false); setAction(null); setName(''); setError('');
    };
    window.addEventListener(PERSONAL_ASSET_CHANGED_EVENT, changed);
    return () => { mounted.current = false; generation.current++; window.removeEventListener(PERSONAL_ASSET_CHANGED_EVENT, changed); };
  }, []);
  const current = rows.find(space => space.id === value);
  const protectedSpace = !current || current.id === DEFAULT_PROJECT_FOLDER_ID || current.id === 'all';
  function open(next: Action) {
    if (viewerOnly || saving.current) return;
    source.current = { adapter: getActiveAssetLibraryAdapter(), id: getAssetLibrarySourceId() };
    setError(''); setAction(next);
    setName(next.kind === 'rename' ? next.space.name : '');
    setMoveContents(true); setTargetId(DEFAULT_PROJECT_FOLDER_ID);
  }
  function completeRows(folders: ProjectFolderGroup[]) {
    const fallback = spaces.find(space => space.id === DEFAULT_PROJECT_FOLDER_ID)
      ?? { id: DEFAULT_PROJECT_FOLDER_ID, name: copy.defaultName, createdAt: 0 };
    return [fallback, ...folders.filter(space => space.id !== DEFAULT_PROJECT_FOLDER_ID && space.id !== 'all')];
  }
  async function submit() {
    if (!action || viewerOnly || saving.current) return;
    const selectedAction = action;
    const identity = source.current;
    const ticket = ++generation.current;
    const active = () => mounted.current && ticket === generation.current
      && identity.adapter === getActiveAssetLibraryAdapter() && identity.id === getAssetLibrarySourceId();
    saving.current = true; setBusy(true); setError('');
    try {
      const remote = await identity.adapter.spaces(scope);
      if (!active()) return;
      const authoritative = completeRows(remote.folders);
      setRows(authoritative);
      let patch: AssetLibrarySpacesPatch;
      let selection: string | undefined;
      if (selectedAction.kind === 'create') {
        if (!name.trim() || authoritative.some(space => space.id !== selectedAction.id && space.name === name.trim())) throw new Error(t('entry.space.duplicate', { item: copy.item }));
        patch = { upsert: [{ id: selectedAction.id, name: name.trim(), createdAt: selectedAction.createdAt }], remove: [] };
        selection = selectedAction.id;
      } else {
        const existing = authoritative.find(space => space.id === selectedAction.space.id);
        if (!existing || existing.id === DEFAULT_PROJECT_FOLDER_ID || existing.id === 'all') throw new Error(t('space.error.defaultLocked'));
        if (selectedAction.kind === 'rename') {
          if (!name.trim() || authoritative.some(space => space.id !== existing.id && space.name === name.trim())) throw new Error(t('entry.space.duplicate', { item: copy.item }));
          patch = { upsert: [{ ...existing, name: name.trim() }], remove: [] };
        } else {
          if (moveContents && !authoritative.some(space => space.id === targetId && space.id !== existing.id)) throw new Error(t('entry.space.pickTarget', { item: copy.item }));
          patch = { upsert: [], remove: [existing.id], removeContents: !moveContents, targetSpaceId: moveContents ? targetId : DEFAULT_PROJECT_FOLDER_ID };
          if (value === existing.id) selection = moveContents ? targetId : DEFAULT_PROJECT_FOLDER_ID;
        }
      }
      const result = await identity.adapter.patchSpaces(scope, patch);
      if (!active()) return;
      setRows(completeRows(result.folders)); setAction(null); setName('');
      // The existing cache owns source namespaces and its change event. Never queue
      // a second mutation through writeProjectFolders after an acknowledged patch.
      // Resolve its namespace before the host persists the new selected space.
      await syncProjectFolders(scope);
      if (active()) {
        if (selection) onChange(selection);
        await onRefresh();
      }
    } catch (reason) {
      if (active()) setError(reason instanceof Error ? reason.message : t('entry.space.actionFailed'));
    } finally {
      if (active()) { saving.current = false; setBusy(false); }
    }
  }
  const editing = action?.kind === 'rename' ? action.space : null;
  return <>
    <div className={styles.spacePicker}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className={styles.spaceSelect} aria-label={t('entry.canvasAssets.selectSpaceAria')} title={current?.name || copy.defaultName} disabled={busy}>
            <Icon className={styles.spacePickerIcon} name="folder" size={14}/>
            <span className={styles.spaceLabel}>{current?.name || copy.defaultName}</span>
            <Icon className={styles.spacePickerCaret} name="chevron-down" size={12}/>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className={styles.spaceMenu}>
          <DropdownMenuRadioGroup value={value} onValueChange={onChange}>
            {rows.map(space => <DropdownMenuRadioItem key={space.id} value={space.id} textValue={space.name}><span className={styles.spaceOptionLabel} title={space.name}>{space.name}</span></DropdownMenuRadioItem>)}
          </DropdownMenuRadioGroup>
          {!viewerOnly && <>
            <DropdownMenuItem onSelect={() => open({ kind: 'create', id: crypto.randomUUID(), createdAt: Date.now() })}>＋ {copy.createTitle}</DropdownMenuItem>
            {!protectedSpace && <DropdownMenuItem aria-label={t('entry.space.renameNamedAria', { item: copy.item, name: current.name })} onSelect={() => open({ kind: 'rename', space: current })}><Icon name="edit-simple" size={14}/>{t('entry.space.renameAria', { item: copy.item })}</DropdownMenuItem>}
            {!protectedSpace && <DropdownMenuItem aria-label={t('entry.space.deleteNamedAria', { item: copy.item, name: current.name })} onSelect={() => open({ kind: 'delete', space: current })}><Icon name="trash" size={14}/>{t('entry.space.delete')}</DropdownMenuItem>}
          </>}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
    {error && !action && <p role="alert">{error}</p>}
    <WorkspaceSpaceEditorDialogs copy={editing ? { ...copy, createTitle: t('entry.space.renameNamedAria', { item: copy.item, name: editing.name }) } : copy}
      spaces={rows} creating={action?.kind === 'create' || action?.kind === 'rename'} editingId={editing?.id ?? (action?.kind === 'create' ? action.id : undefined)} submitLabel={editing ? t('common.save') : undefined}
      name={name} onNameChange={setName} onCreate={() => void submit()} onCancelCreate={() => { if (!saving.current) setAction(null); }}
      deleting={action?.kind === 'delete' ? action.space : null} moveContents={moveContents} onMoveContentsChange={setMoveContents}
      targetId={targetId} onTargetIdChange={setTargetId} chooseMoveTarget busy={busy} error={error}
      onConfirmDelete={() => void submit()} onCancelDelete={() => { if (!saving.current) setAction(null); }}/>
  </>;
}
