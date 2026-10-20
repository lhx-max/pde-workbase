import { useId, useState } from 'react';
import { PROJECT_LAYOUT, type WorkspaceCollabContext } from '@bezier/contracts';
import {
  AnimatedDialogDescription, AnimatedDialogTitle, Button, DialogRoot, DialogSurface,
  Input, Select, SettingsDisclosure, Switch,
} from '../components/ui';
import { Icon } from '../components/Icon';
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

export function ResourceBatchConfirm({ count, imageCount, projectId, workspaceContext, onCancel, onConfirm }: ResourceBatchConfirmProps) {
  const t = useT();
  const id = useId();
  const space = projectId;
  const spaces = [{ id: projectId, name: projectId }];
  const validSpace = !!projectId;
  const [tags, setTags] = useState('');
  const [prefix, setPrefix] = useState('');

  const canSave = count > 0 && validSpace;
  const confirm = () => {
    if (!canSave) return;
    onConfirm({
      spaceId: space, parentId: null,
      tags: Array.from(new Set(tags.split(/[,\n，]/).map(value => value.trim()).filter(Boolean))),
      prefix: prefix.trim(), aiFill: false,
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
              <Select id={`${id}-space`} value={validSpace ? space : ''} disabled>
                {!validSpace && <option value="" disabled>{t('asset.meta.chooseSpace')}</option>}
                {spaces.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
              </Select>
            </label>
            <label className={styles.field} htmlFor={`${id}-folder`}><span>{t('browserResources.folder')}</span>
              <Select id={`${id}-folder`} value="" disabled>
                <option value="">{PROJECT_LAYOUT.collected}/browser</option>
              </Select>
            </label>
          </div>
          {!validSpace && <p className={styles.error} role="alert">{t('browserResources.destinationUnavailable')}</p>}
        </section>
        <div className={styles.aiRow}>
          <div className={styles.aiCopy}>
            <label htmlFor={`${id}-ai`} className={styles.aiLabel}><Icon name="sparkles" size={15} />{t('asset.meta.aiFill')}</label>
            <p id={`${id}-ai-hint`} className={styles.hint}>{t('browserResources.aiFillUnavailable')}</p>
          </div>
          <Switch id={`${id}-ai`} aria-label={t('asset.meta.aiFill')} checked={false} disabled aria-describedby={`${id}-ai-hint`} />
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
