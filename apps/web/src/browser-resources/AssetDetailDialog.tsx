import { createContext, useCallback, useContext, useId, useState, type ReactNode } from 'react';
import { Button, DialogRoot, DialogSurface, DialogBody, AnimatedDialogTitle } from '@/src/components/ui';
import { Icon } from '../components/Icon';
import { useI18n } from '../i18n';
import styles from './AssetDetailDialog.module.css';

const AssetDetailPortalContext = createContext<HTMLElement | null>(null);

/** Keeps nested menus/popovers inside the modal's scroll-lock boundary. */
export function useAssetDetailPortalContainer() {
  return useContext(AssetDetailPortalContext);
}

export function AssetDetailBody({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <DialogBody className={`${styles.body} ${className}`} data-asset-detail-body>{children}</DialogBody>;
}

export function AssetDetailInspector({ children, actions, toolbar }: { children: ReactNode; actions?: ReactNode; toolbar?: ReactNode }) {
  const { t } = useI18n();
  return <aside className={styles.inspector} aria-label={t('asset.detail.info')}>{toolbar && <div className={styles.inspectorToolbar}>{toolbar}</div>}<div className={`${styles.inspectorScroll} ${toolbar ? styles.withToolbar : ''}`}>{children}</div>{actions && <div className={styles.inspectorActions}>{actions}</div>}</aside>;
}
export function AssetDetailSection({ title, children }: { title: ReactNode; children: ReactNode }) {
  return <section className={styles.section}><h3>{title}</h3>{children}</section>;
}

/** Shared detail surface for personal assets and official templates. */
export function AssetDetailDialog({ title, closeLabel, onClose, children }: {
  title: string; meta?: ReactNode; closeLabel?: string; onClose: () => void; children: ReactNode;
}) {
  const { t } = useI18n();
  const resolvedCloseLabel = closeLabel ?? t('asset.detail.close');
  const titleId = useId();
  const [portalContainer, setPortalContainer] = useState<HTMLDivElement | null>(null);
  const portalRef = useCallback((node: HTMLDivElement | null) => setPortalContainer(node), []);
  return <DialogRoot open onOpenChange={open => { if (!open) onClose(); }}><DialogSurface unstyled overlayUnstyled className={styles.dialog} overlayClassName={styles.backdrop} aria-labelledby={titleId} aria-describedby={undefined} showCloseButton={false}
    >
    <AssetDetailPortalContext.Provider value={portalContainer}>
      <div className={styles.shell}>
        <AnimatedDialogTitle id={titleId} className={styles.srTitle}>{title}</AnimatedDialogTitle>
        <Button variant="ghost" size="icon" className={styles.close} aria-label={resolvedCloseLabel} onClick={onClose}><Icon name="close" size={17} /></Button>
        {children}
      </div>
      <div ref={portalRef} className={styles.portalHost} />
    </AssetDetailPortalContext.Provider>
  </DialogSurface></DialogRoot>;
}
