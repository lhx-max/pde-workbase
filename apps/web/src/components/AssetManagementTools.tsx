import type { ReactNode } from 'react';
import { Button, Popover, PopoverTrigger, PopoverContent } from '@/src/components/ui';
import { Icon } from './Icon';
import { useI18n } from '@/src/i18n';
import styles from './PersonalAssetLibrary.module.css';

/** The asset library controls are shared by personal and team catalogues. */
export function AssetEditButton({ editing, busy, onClick }: { editing: boolean; busy: boolean; onClick: () => void }) {
  const { t } = useI18n();
  return <Button variant="ghost" size="icon" data-workspace-icon aria-label={t('asset.manage.edit')} aria-pressed={editing} className="bezier-tooltip" data-tooltip={editing ? t('asset.manage.exitEdit') : t('asset.manage.edit')} disabled={busy} onClick={onClick}>
    <Icon name={editing ? 'check' : 'edit'} size={16} />
  </Button>;
}

export function AssetDeleteSelection({ count, busy, onClick }: { count: number; busy: boolean; onClick: () => void }) {
  const { t } = useI18n();
  return <Button aria-label={t('asset.manage.deleteSelected')} className={`${styles.action} bezier-tooltip`} data-tooltip={t('asset.manage.deleteSelectedTooltip', { count })} disabled={busy || count === 0} onClick={onClick}>
    <Icon name="trash" size={15} /><span>{t('asset.manage.delete')}</span>
  </Button>;
}

export function AssetFilterPopover({ active, count, onReset, sort, onSortChange, children }: {
  active: boolean; count: number; onReset: () => void; sort: string; onSortChange: (value: string) => void; children: ReactNode;
}) {
  const { t } = useI18n();
  const sorts = [
    ['updated', t('asset.manage.sort.updated')],
    ['created', t('asset.manage.sort.created')],
    ['name', t('asset.manage.sort.name')],
  ] as const;
  return <Popover>
    <PopoverTrigger asChild>
      <Button variant="ghost" size="icon" aria-label={t('asset.manage.filterSort')} data-workspace-icon className={`${styles.filterTrigger} bezier-tooltip`}
        data-tooltip={count ? t('asset.manage.filterSortActive', { count }) : t('asset.manage.filterSort')} data-tooltip-placement="bottom" isSelected={active}>
        <Icon name="sliders" size={16} />
        {count > 0 && <span className={styles.filterCount} aria-label={t('asset.manage.filterCount', { count })}>{count}</span>}
      </Button>
    </PopoverTrigger>
    <PopoverContent align="end" aria-label={t('asset.manage.filterSort')} className={styles.filters}>
      <div className={styles.filterHeading}><strong>{t('asset.manage.filterSort')}</strong><Button variant="ghost" size="sm" onClick={onReset}>{t('asset.manage.reset')}</Button></div>
      {children}
      <div className={styles.filterRow} role="group" aria-label={t('asset.manage.sortAria')}>
        <span>{t('asset.manage.sort')}</span><div className={styles.filterChoices}>{sorts.map(([id, label]) =>
          <Button key={id} variant="ghost" size="xs" aria-pressed={sort === id} onClick={() => onSortChange(id)}>{label}</Button>)}</div>
      </div>
    </PopoverContent>
  </Popover>;
}
