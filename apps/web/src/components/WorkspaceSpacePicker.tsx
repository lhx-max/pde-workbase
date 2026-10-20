// Adapted from Bezier 319e5eee: pure original space editor dialogs only.
import { createPortal } from 'react-dom';
import { Button, Checkbox, Dialog, DialogTitle, DialogBody, DialogFooter, Input, DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuItem } from '@/src/components/ui';
import { useI18n } from '../i18n';
import { Icon } from './Icon';
import { DEFAULT_PROJECT_FOLDER_ID, type ProjectFolderGroup } from '../state/project-folders';
import styles from './WorkspaceSpacePicker.module.css';

export const DEFAULT_WORKSPACE_SPACE_COPY = {
  group: 'Spaces',
  item: 'space',
  defaultName: 'Default space',
  createTitle: 'New space',
  createPlaceholder: 'e.g. Brand ops',
  moveContents: 'Move assets to another space',
  moveDescription: 'Assets stay. Only this space is removed.',
  deleteDescription: 'All assets and folders in this space will be permanently deleted. This cannot be undone.',
};

export type WorkspaceSpaceCopy = typeof DEFAULT_WORKSPACE_SPACE_COPY;

export function useWorkspaceSpaceCopy(labels?: WorkspaceSpaceCopy): WorkspaceSpaceCopy {
  const { t } = useI18n();
  if (labels) return labels;
  return {
    group: t('entry.space.group'),
    item: t('entry.space.item'),
    defaultName: t('entry.space.defaultName'),
    createTitle: t('entry.space.createTitle'),
    createPlaceholder: t('entry.space.createPlaceholder'),
    moveContents: t('assetLibrary.spaces.moveContents'),
    moveDescription: t('assetLibrary.spaces.moveDescription'),
    deleteDescription: t('assetLibrary.spaces.deleteDescription'),
  };
}

export function WorkspaceSpaceEditorDialogs({
  copy,
  spaces,
  creating,
  editingId,
  submitLabel,
  name,
  onNameChange,
  onCreate,
  onCancelCreate,
  deleting,
  moveContents,
  onMoveContentsChange,
  targetId,
  onTargetIdChange,
  chooseMoveTarget,
  busy,
  error,
  onConfirmDelete,
  onCancelDelete,
}: {
  copy: WorkspaceSpaceCopy;
  spaces: ProjectFolderGroup[];
  creating: boolean;
  editingId?: string;
  submitLabel?: string;
  name: string;
  onNameChange: (value: string) => void;
  onCreate: (name: string) => void;
  onCancelCreate: () => void;
  deleting: ProjectFolderGroup | null;
  moveContents: boolean;
  onMoveContentsChange: (value: boolean) => void;
  targetId: string;
  onTargetIdChange: (value: string) => void;
  chooseMoveTarget: boolean;
  busy: boolean;
  error: string;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
}) {
  const { t } = useI18n();
  const duplicate = spaces.some((space) => space.id !== editingId && space.name === name.trim());
  const targets = spaces.filter((space) => space.id !== 'all' && space.id !== deleting?.id)
    .map(space => space.id === DEFAULT_PROJECT_FOLDER_ID ? { ...space, name: copy.defaultName } : space);
  const needsTarget = chooseMoveTarget && moveContents;
  return (
    <>
      {deleting && createPortal(
        <Dialog
          className={styles.deleteDialog}
          ariaLabel={t('entry.space.deleteNamedAria', { item: copy.item, name: deleting.name })}
          closeOnEscape={!busy}
          closeOnBackdrop={!busy}
          onClose={() => { if (!busy) onCancelDelete(); }}
        >
          <DialogTitle>{t('entry.space.deleteTitle', { name: deleting.name })}</DialogTitle>
          <DialogBody className={styles.deleteBody}>
            <p>{moveContents ? copy.moveDescription : copy.deleteDescription}</p>
            {error ? <p role="alert">{error}</p> : null}
          </DialogBody>
          <DialogFooter className={styles.deleteFooter}>
            <div className={styles.moveControls}>
              <label className={styles.moveOption}>
                <Checkbox
                  checked={moveContents}
                  disabled={busy}
                  onCheckedChange={(checked) => onMoveContentsChange(checked === true)}
                />
                {t('entry.space.transfer')}
              </label>
              {needsTarget ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button className={styles.targetPicker} disabled={busy} aria-label={t('entry.space.pickTargetAria', { item: copy.item })}>
                      <span>{targets.find((target) => target.id === targetId)?.name ?? t('entry.space.pickTarget', { item: copy.item })}</span>
                      <Icon name="chevron-down" size={12} />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className={styles.targetMenu}>
                    <DropdownMenuRadioGroup value={targetId} onValueChange={onTargetIdChange}>
                      {targets.map((target) => (
                        <DropdownMenuRadioItem key={target.id} value={target.id}>{target.name}</DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                    {!targets.length ? <DropdownMenuItem disabled>{t('entry.space.noTargets', { item: copy.item })}</DropdownMenuItem> : null}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
            </div>
            <div className={styles.deleteActions}>
              <Button disabled={busy} onClick={onCancelDelete}>{t('entry.space.cancel')}</Button>
              <Button
                variant="primary"
                disabled={busy || (needsTarget && !targets.some((target) => target.id === targetId))}
                onClick={onConfirmDelete}
              >
                {busy ? t('entry.space.deleting') : t('entry.space.delete')}
              </Button>
            </div>
          </DialogFooter>
        </Dialog>,
        document.body,
      )}
      {creating && createPortal(
        <Dialog ariaLabel={copy.createTitle} closeOnEscape={!busy} closeOnBackdrop={!busy} onClose={() => { if (!busy) onCancelCreate(); }}>
          <DialogTitle>{copy.createTitle}</DialogTitle>
          <DialogBody>
            <Input
              aria-label={t('entry.space.nameAria', { item: copy.item })}
              placeholder={copy.createPlaceholder}
              value={name}
              disabled={busy}
              onChange={(event) => onNameChange(event.target.value)}
            />
            {duplicate ? <p role="alert">{t('entry.space.duplicate', { item: copy.item })}</p> : null}
            {error ? <p role="alert">{error}</p> : null}
          </DialogBody>
          <DialogFooter>
            <Button disabled={busy} onClick={onCancelCreate}>{t('entry.space.cancel')}</Button>
            <Button
              variant="primary"
              disabled={busy || !name.trim() || duplicate}
              onClick={() => onCreate(name.trim())}
            >
              {submitLabel ?? t('entry.space.createAction', { item: copy.item })}
            </Button>
          </DialogFooter>
        </Dialog>,
        document.body,
      )}
    </>
  );
}
