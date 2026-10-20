import { useId, type ReactNode } from 'react';
import type { CanvasDialogRenderer } from '@bezier/canvas-workbench';
import { Button } from '@/src/components/ui';
import { Icon } from '../Icon';
import { AssetSearchField } from '../AssetSearchField';
import { renderHomeWorkbenchDialog } from '../home-hero/WorkbenchOverlayShells';
import './WorkspaceAssetPicker.css';
import { useI18n } from '../../i18n';
import styles from './AssetPickerDialog.module.css';

/** One geometry contract for media, document and design-system selection. */
export function AssetPickerDialog({ title, onClose, controls, navigation, filters, query, onQueryChange,
  children, status, actions, error, onRetry, busy, className, searchLabel, searchPlaceholder, renderDialog = renderHomeWorkbenchDialog,
}: {
  title: string; onClose: () => void; controls?: ReactNode; navigation?: ReactNode; filters?: ReactNode;
  query: string; onQueryChange?: (value: string) => void; children: ReactNode;
  status?: ReactNode; actions: ReactNode; error?: string; onRetry?: () => void;
  busy?: boolean; className?: string; renderDialog?: CanvasDialogRenderer;
  searchLabel?: string; searchPlaceholder?: string;
}) {
  const { t } = useI18n();
  const resolvedSearchLabel = searchLabel ?? t('entry.picker.searchLabel');
  const resolvedSearchPlaceholder = searchPlaceholder ?? t('entry.picker.searchPlaceholder');
  const id = useId();
  return renderDialog({ open: true, onOpenChange: open => { if (!open) onClose(); },
    className: ['workspace-asset-picker', className].filter(Boolean).join(' '), surface: 'resource', canvasStyles: false, ariaLabelledBy: id,
    children: <>
      <header className={`wap-header ${styles.header}`}>
        <h2 id={id}>{title}</h2>
        <div className={styles.headerActions}>
          {controls && <div className={styles.controls}>{controls}</div>}
          <Button variant="ghost" size="icon" className={styles.closeButton} aria-label={t('entry.picker.closeAria')} onClick={onClose}><Icon name="close" size={16} /></Button>
        </div>
      </header>
      <div className="wap-toolbar">{navigation ?? filters}
        {onQueryChange && <AssetSearchField className="wap-search" label={resolvedSearchLabel} placeholder={resolvedSearchPlaceholder} clearLabel={t('entry.picker.clearSearch')} value={query} onChange={onQueryChange} />}
      </div>
      {navigation && filters ? <div className="wap-filters">{filters}</div> : null}
      <div className="wap-results" aria-busy={busy}>{children}</div>
      {error && <div className="wap-error" role="alert">{error}{onRetry && <Button variant="ghost" onClick={onRetry}>{t('entry.picker.retry')}</Button>}</div>}
      <footer className="wap-footer"><span aria-live="polite">{status}</span>{actions}</footer>
    </>,
  });
}
