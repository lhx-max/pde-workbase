import { useEffect, useId, useRef, useState } from 'react';
import { PERSONAL_ASSET_CHANGED_EVENT, type PersonalAsset, type WorkspaceCollabContext } from '@bezier/contracts';
import {
  AnimatedDialogDescription, AnimatedDialogTitle, Button, DialogRoot, DialogSurface,
  Input, Select, SettingsDisclosure, Switch,
} from '../components/ui';
import { Icon } from '../components/Icon';
import { usePickerSpaces } from '../components/asset-library/use-picker-spaces';
import { useAssetLibraryCapabilities } from '../components/asset-library/use-asset-library-capabilities';
import { DEFAULT_PROJECT_FOLDER_ID } from '../state/project-folders';
import { personalAssets } from '../providers/asset-library';
import { useT } from '../i18n';
import type { ResourceBatchMetadata } from './client';
import styles from './ResourceBatchConfirm.module.css';

export interface ResourceBatchConfirmProps {
  count: number;
  imageCount: number;
  projectId: string;
  workspaceContext?: WorkspaceCollabContext | null;
  onCancel(): void;
  onConfirm(metadata: ResourceBatchMetadata): void;
}

/** Only traverse live folders in the selected space; malformed cycles stop once. */
function folderPath(folder: PersonalAsset, folders: ReadonlyMap<string, PersonalAsset>): string {
  const names: string[] = [];
  const visited = new Set<string>();
  let current: PersonalAsset | undefined = folder;
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    names.push(current.name);
    current = current.parentId ? folders.get(current.parentId) : undefined;
  }
  return names.reverse().join(' / ');
}

export function ResourceBatchConfirm({ count, imageCount, projectId, workspaceContext, onCancel, onConfirm }: ResourceBatchConfirmProps) {
  const t = useT();
  const id = useId();
  const { space: defaultSpace, folders: spaces, projectSpaces, projectsReady } = usePickerSpaces(workspaceContext);
  // Keep explicit choices locally: the picker hook falls back to the default
  // when a space disappears, which must not silently redirect this save.
  const [chosenSpace, setSpace] = useState<string | null>(null);
  const space = chosenSpace ?? defaultSpace;
  const initialized = useRef(false);
  const [parent, setParent] = useState<{ id: string; spaceId: string } | null>(null);
  const [assets, setAssets] = useState<PersonalAsset[]>([]);
  const [folderStatus, setFolderStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [revision, setRevision] = useState(0);
  const [tags, setTags] = useState('');
  const [prefix, setPrefix] = useState('');
  const [aiFill, setAiFill] = useState(false);
  const { analysis } = useAssetLibraryCapabilities();
  const canAnalyze = imageCount > 0 && analysis;

  useEffect(() => {
    if (initialized.current || !projectsReady) return;
    initialized.current = true;
    const projectSpace = projectSpaces[projectId];
    if (projectSpace && spaces.some(item => item.id === projectSpace)) setSpace(projectSpace);
  }, [projectId, projectSpaces, projectsReady, setSpace, spaces]);

  useEffect(() => { setParent(null); }, [space]);
  useEffect(() => {
    const refresh = () => setRevision(value => value + 1);
    window.addEventListener(PERSONAL_ASSET_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(PERSONAL_ASSET_CHANGED_EVENT, refresh);
  }, []);
  useEffect(() => {
    let current = true;
    setFolderStatus('loading');
    void personalAssets.list().then(result => {
      if (!current) return;
      setAssets(result.assets.filter(asset => asset.kind === 'folder' && !asset.deletedAt));
      setFolderStatus('ready');
    }).catch(() => { if (current) setFolderStatus('error'); });
    return () => { current = false; };
  }, [revision]);

  // Match the library's legacy space fallback, but never guess a project-owned
  // folder's space before the project mapping has arrived.
  const folders = assets.filter(asset => {
    if (!asset.spaceId && asset.source.projectId && !projectsReady) return false;
    return (asset.spaceId || (asset.source.projectId && projectSpaces[asset.source.projectId]) || DEFAULT_PROJECT_FOLDER_ID) === space;
  });
  const foldersById = new Map(folders.map(folder => [folder.id, folder]));
  const validSpace = !!space && spaces.some(item => item.id === space);
  const validFolder = !parent || (folderStatus === 'ready' && parent.spaceId === space && folders.some(folder => folder.id === parent.id));
  const canSave = count > 0 && validSpace && validFolder;
  const changeSpace = (value: string) => {
    // A deliberate destination (including a folder choice) wins over late defaults.
    initialized.current = true;
    setParent(null);
    setSpace(value);
  };
  const confirm = () => {
    if (!canSave) return;
    onConfirm({
      spaceId: space, parentId: parent?.id ?? null,
      tags: Array.from(new Set(tags.split(/[,\n，]/).map(value => value.trim()).filter(Boolean))),
      prefix: prefix.trim(), aiFill: canAnalyze && aiFill,
    });
  };

  return <DialogRoot open onOpenChange={open => { if (!open) onCancel(); }}>
    <DialogSurface className={styles.dialog} showCloseButton={false} aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`}>
      <header className={styles.header}>
        <div className={styles.heading}>
          <AnimatedDialogTitle id={`${id}-title`} className={styles.title}>{t('browserResources.confirmTitle', { count })}</AnimatedDialogTitle>
          <AnimatedDialogDescription id={`${id}-description`} className={styles.description}>{t('browserResources.confirmHint')}</AnimatedDialogDescription>
        </div>
        <Button type="button" variant="ghost" size="icon" className={styles.close} aria-label={t('common.close')} onClick={onCancel}><Icon name="close" size={16} /></Button>
      </header>
      <div className={styles.body}>
        <section className={styles.destination} aria-labelledby={`${id}-destination`}>
          <h3 id={`${id}-destination`} className={styles.sectionTitle}><Icon name="folder" size={16} />{t('browserResources.destination')}</h3>
          <div className={styles.locationFields}>
            <label className={styles.field} htmlFor={`${id}-space`}><span>{t('asset.meta.space')}</span>
              <Select id={`${id}-space`} value={validSpace ? space : ''} disabled={!spaces.length} onChange={event => changeSpace(event.target.value)}>
                {!validSpace && <option value="" disabled>{t('asset.meta.chooseSpace')}</option>}
                {spaces.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
              </Select>
            </label>
            <label className={styles.field} htmlFor={`${id}-folder`}><span>{t('browserResources.folder')}</span>
              <Select id={`${id}-folder`} value={parent?.id ?? ''} disabled={!validSpace || folderStatus !== 'ready'} aria-invalid={!validFolder || undefined} onChange={event => {
                initialized.current = true;
                setParent(event.target.value ? { id: event.target.value, spaceId: space } : null);
              }}>
                <option value="">{t('browserResources.rootFolder')}</option>
                {parent && !folders.some(folder => folder.id === parent.id) && <option value={parent.id} disabled>{t('browserResources.invalidFolder')}</option>}
                {folders.map(folder => <option key={folder.id} value={folder.id}>{folderPath(folder, foldersById)}</option>)}
              </Select>
            </label>
          </div>
          {!validSpace && <p className={styles.error} role="alert">{t('browserResources.destinationUnavailable')}</p>}
          {!projectsReady && <p className={styles.hint} role="status">{t('browserResources.projectSpacePending')}</p>}
          {folderStatus === 'loading' && <p className={styles.hint} role="status">{t('browserResources.foldersLoading')}</p>}
          {folderStatus === 'error' && <div className={styles.folderError} role="alert"><p>{t('browserResources.foldersError')}</p><Button type="button" variant="ghost" size="sm" onClick={() => setRevision(value => value + 1)}>{t('common.retry')}</Button>{parent && <Button type="button" variant="ghost" size="sm" onClick={() => setParent(null)}>{t('browserResources.rootFolder')}</Button>}</div>}
          {folderStatus === 'ready' && !validFolder && <p className={styles.error} role="alert">{t('browserResources.invalidFolder')}</p>}
        </section>
        <div className={styles.aiRow}>
          <div className={styles.aiCopy}>
            <label htmlFor={`${id}-ai`} className={styles.aiLabel}><Icon name="sparkles" size={15} />{t('asset.meta.aiFill')}</label>
            <p id={`${id}-ai-hint`} className={styles.hint}>{t(canAnalyze ? 'browserResources.aiFillHint' : 'browserResources.aiFillUnavailable')}</p>
          </div>
          <Switch id={`${id}-ai`} aria-label={t('asset.meta.aiFill')} checked={canAnalyze && aiFill} disabled={!canAnalyze} aria-describedby={`${id}-ai-hint`} onCheckedChange={setAiFill} />
        </div>
        <SettingsDisclosure title={t('browserResources.optionalDetails')} className={styles.details} summaryClassName={styles.detailsSummary}>
          <div className={styles.metadata}>
            <label className={styles.field} htmlFor={`${id}-tags`}><span>{t('browserResources.tags')}</span><Input id={`${id}-tags`} value={tags} maxLength={512} placeholder={t('browserResources.tagsHint')} onChange={event => setTags(event.target.value)} /></label>
            <label className={styles.field} htmlFor={`${id}-prefix`}><span>{t('browserResources.filenamePrefix')}</span><Input id={`${id}-prefix`} value={prefix} maxLength={80} onChange={event => setPrefix(event.target.value)} /></label>
          </div>
        </SettingsDisclosure>
      </div>
      <footer className={styles.footer}>
        <Button type="button" variant="ghost" onClick={onCancel}>{t('browserResources.cancel')}</Button>
        <Button type="button" variant="primary" disabled={!canSave} onClick={confirm}>{t('browserResources.submit')}</Button>
      </footer>
    </DialogSurface>
  </DialogRoot>;
}
