import { useEffect, useRef, useState } from 'react';
import type { PersonalAsset, PersonalAssetPatch, WorkspaceCollabContext } from '@bezier/contracts';
import { Button, ConfirmDialog, DialogFooter, Input, Textarea } from './ui';
import { createPortal } from 'react-dom';
import { AssetDetailBody, AssetDetailDialog, AssetDetailSection } from './AssetDetailDialog';
import { AssetContentPreview, personalAssetPreviewSource } from './AssetContentPreview';
import { AssetAnalysisFields } from './AssetAnalysisFields';
import { AssetRatingField, AssetSpaceField } from './AssetMetadataControls';
import { AssetTagPicker } from './AssetTagPicker';
import { Icon } from './Icon';
import { usePickerSpaces } from './asset-library/use-picker-spaces';
import { usePersonalAssetTags } from './asset-library/personal-asset-tags';
import { personalAssets, PersonalAssetRequestError } from '../providers/asset-library';
import { useI18n } from '../i18n';
import { assetInspectorCopy } from '../i18n/locales/asset-inspector-copy';
import styles from './PersonalAssetLibrary.module.css';
import inspector from './AssetAnalysisFields.module.css';
import layout from './SavedAssetDialog.module.css';

type Editable = Pick<PersonalAsset, 'name' | 'description' | 'style' | 'usage' | 'tags' | 'rating' | 'spaceId'>;
type Draft = { base: PersonalAsset; changes: Partial<Editable> };
type Props = { asset: PersonalAsset; onClose: () => void; workspaceContext?: WorkspaceCollabContext | null };

/** Product-owned saved details, usable from any save entry point without mounting the library. */
export function SavedAssetDialog(props: Props) {
  return <SavedAssetEditor key={props.asset.id} {...props}/>;
}

function SavedAssetEditor({ asset: initialAsset, onClose, workspaceContext }: Props) {
  const { t, locale } = useI18n();
  const copy = assetInspectorCopy(locale);
  const { folders, projectSpaces, projectsReady } = usePickerSpaces(workspaceContext ?? null);
  const availableTags = usePersonalAssetTags(true);
  const [asset, setAsset] = useState(initialAsset);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [tagDraft, setTagDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [yamlDirty, setYamlDirty] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const saving = useRef(false);
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  // Analysis/YAML/Prompt can complete in any order. Never regress server state, and
  // never rebase unsaved form edits onto a revision the user did not start editing.
  function receive(next: PersonalAsset) {
    if (!mounted.current) return;
    setAsset(current => next.id === current.id && next.revision > current.revision ? next : current);
  }
  useEffect(() => { receive(initialAsset); }, [initialAsset]);
  const value = { ...asset, ...draft?.changes };
  function change<K extends keyof Editable>(field: K, next: Editable[K]) {
    if (saving.current) return;
    setDraft(current => {
      const base = current?.base ?? asset;
      const changes = { ...current?.changes, [field]: next };
      if (JSON.stringify(next) === JSON.stringify(base[field])) delete changes[field];
      return Object.keys(changes).length ? { base, changes } : null;
    });
  }
  async function saveChanges() {
    if (!draft || saving.current || !value.name.trim()) return;
    saving.current = true; setBusy(true); setError('');
    const patch: PersonalAssetPatch = { ...draft.changes, revision: draft.base.revision };
    if (patch.name !== undefined) patch.name = patch.name.trim();
    if (patch.spaceId !== undefined) patch.parentId = null;
    try {
      const result = await personalAssets.patch(asset.id, patch);
      if (!mounted.current) return;
      receive(result.asset); setDraft(null);
    } catch (reason) {
      if (!mounted.current) return;
      const conflict = reason instanceof PersonalAssetRequestError && reason.status === 409;
      setError(conflict ? t('api.error.conflict') : reason instanceof Error ? reason.message : copy.saveFailed);
      // Refresh the server snapshot for Undo, but retain the draft AND its revision.
      // Retrying is never a silent last-write-wins overwrite of concurrent edits.
      if (conflict) {
        try {
          const { assets } = await personalAssets.list();
          const current = assets.find(item => item.id === asset.id);
          if (current) receive(current);
        } catch { /* The conflict stays visible and the draft remains recoverable. */ }
      }
    } finally {
      saving.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  const addTag = (input: string) => {
    const tag = input.trim().slice(0, 80);
    if (tag && !value.tags.includes(tag) && value.tags.length < 30) change('tags', [...value.tags, tag]);
    setTagDraft('');
  };
  const sourceUrl = asset.source.url && /^https?:\/\//i.test(asset.source.url) ? asset.source.url : undefined;
  const space = value.spaceId || (asset.source.projectId && projectSpaces[asset.source.projectId]) || 'default-project';
  const close = () => { if (saving.current) return; if (draft || yamlDirty) setConfirmDiscard(true); else onClose(); };
  return <><AssetDetailDialog title={asset.name} onClose={close}>
    <AssetDetailBody className={styles.detailBody}>
      <div className={styles.stage}><AssetContentPreview source={personalAssetPreviewSource(asset)}/></div>
      <AssetAnalysisFields asset={asset} onUpdate={receive} actionsBlocked={busy || !!draft} onDirtyChange={setYamlDirty} space={<AssetSpaceField value={space} spaces={folders} disabled={busy || yamlDirty || !projectsReady} onChange={next => change('spaceId', next)}/>}>
        <AssetDetailSection title={<label htmlFor="saved-asset-name">{t('asset.save.name')}</label>}>
          <Input id="saved-asset-name" value={value.name} maxLength={240} disabled={busy || yamlDirty} onChange={event => change('name', event.target.value)}/>
        </AssetDetailSection>
        <AssetDetailSection title={t('asset.save.tags')}>
          <div className={styles.tagList}>{value.tags.map(tag => <span className={styles.tag} key={tag}><span>{tag}</span><Button variant="ghost" size="xs" aria-label={t('entry.personalAssets.aria.removeTag', { tag })} disabled={busy || yamlDirty} onClick={() => change('tags', value.tags.filter(item => item !== tag))}><Icon name="close" size={12}/></Button></span>)}
            <AssetTagPicker tags={value.tags} availableTags={availableTags} busy={busy || yamlDirty} draft={tagDraft} onDraft={setTagDraft} onAdd={addTag} onToggle={tag => value.tags.includes(tag) ? change('tags', value.tags.filter(item => item !== tag)) : addTag(tag)}/>
          </div>
        </AssetDetailSection>
        <AssetDetailSection title={<label htmlFor="saved-asset-description">{t('asset.save.description')}</label>}>
          <Textarea id="saved-asset-description" rows={3} value={value.description} maxLength={4000} disabled={busy || yamlDirty} onChange={event => change('description', event.target.value)}/>
        </AssetDetailSection>
        <AssetDetailSection title={<label htmlFor="saved-asset-style">{t('asset.save.style')}</label>}>
          <Textarea id="saved-asset-style" rows={2} value={value.style || ''} maxLength={4000} disabled={busy || yamlDirty} onChange={event => change('style', event.target.value)}/>
        </AssetDetailSection>
        <AssetDetailSection title={<label htmlFor="saved-asset-usage">{t('asset.save.usage')}</label>}>
          <Textarea id="saved-asset-usage" rows={2} value={value.usage || ''} maxLength={4000} disabled={busy || yamlDirty} onChange={event => change('usage', event.target.value)}/>
        </AssetDetailSection>
        <AssetRatingField value={value.rating} disabled={busy || yamlDirty} onChange={next => change('rating', next)}/>
      </AssetAnalysisFields>
    </AssetDetailBody>
    <DialogFooter className={styles.previewFooter}>
      <div className={layout.summary}>
        <div className={styles.previewMeta}>
          <span>{asset.versions.at(-1)?.filename || asset.name}</span>
          {sourceUrl && <a href={sourceUrl} target="_blank" rel="noreferrer">{t('entry.personalAssets.viewSource')}</a>}
        </div>
        {draft && <p className={`${inspector.hint} ${layout.notice}`}>{copy.dirtyHint}</p>}
        {(error || (draft && draft.base.revision !== asset.revision)) && <p role="alert" className={`${inspector.error} ${layout.notice}`}>{error || t('api.error.conflict')}</p>}
      </div>
      <div className={styles.previewActions}>
        {draft && <Button variant="ghost" disabled={busy || yamlDirty} onClick={() => { setDraft(null); setTagDraft(''); setError(''); }}>{copy.undo}</Button>}
        <Button variant="ghost" disabled={busy} onClick={close}>{t('common.close')}</Button>
        <Button variant="primary" disabled={busy || !draft || !value.name.trim()} onClick={() => void saveChanges()}>{busy ? copy.saving : t('asset.detail.saveChanges')}</Button>
      </div>
    </DialogFooter>
  </AssetDetailDialog>{confirmDiscard && createPortal(<ConfirmDialog
    title={t('asset.detail.discardTitle')} description={t('asset.detail.discardDescription')}
    confirmLabel={t('asset.detail.discard')} cancelLabel={t('common.cancel')}
    onCancel={() => setConfirmDiscard(false)} onConfirm={onClose}
  />, document.body)}</>;
}
