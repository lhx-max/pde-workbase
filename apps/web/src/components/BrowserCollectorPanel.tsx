import { isCollectedPath } from '@bezier/contracts';
import { useEffect, useState } from 'react';
import { PROJECT_FILE_ADD_TO_CANVAS_EVENT, PROJECT_FILE_DRAG_MIME, type ProjectFile } from '@bezier/contracts';
import { isBezierHostAvailable } from '@bezier/host';
import { Button } from '@/src/components/ui';
import type { WorkspaceCollabContext } from '@bezier/contracts';
import { projectFileUrl, writeProjectTextFile } from '../providers/registry';
import { DesignBrowserPanel } from './DesignBrowserPanel';
import { Icon } from './Icon';
import styles from './BrowserCollectorPanel.module.css';
import { useI18n } from '../i18n';
import type { BrowserPageExtractionRequest } from './browser-page-extraction';

/** Project collection uses real project files, not a parallel asset database. */
export function BrowserCollectorPanel({ projectId, files, onRefreshFiles, onExtractPage, extractPageDisabled, workspaceContext, onSaveToAssetSource }: {
  projectId: string;
  workspaceContext?: WorkspaceCollabContext | null;
  onSaveToAssetSource?: (file: ProjectFile) => Promise<void>;
  files: ProjectFile[];
  onRefreshFiles: () => Promise<void> | void;
  onExtractPage?: (request: BrowserPageExtractionRequest) => Promise<void>;
  extractPageDisabled?: boolean;
}) {
  const { t } = useI18n();
  const [notice, setNotice] = useState<{ message: string; error: boolean } | null>(null);
  const [trayOpen, setTrayOpen] = useState(false);
  useEffect(() => {
    if (!notice || notice.error) return;
    const timer = window.setTimeout(() => setNotice(null), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);
  const [initialUrl] = useState(() => {
    try { return localStorage.getItem(`bezier-design:collector:${projectId}:url`) || undefined; }
    catch { return undefined; }
  });
  const collected = files.filter(file => isCollectedPath(file.name) && file.kind === 'image')
    .sort((a, b) => b.mtime - a.mtime);
  const payload = (file: ProjectFile) => ({ projectId, name: file.name, kind: file.kind, mime: file.mime, size: file.size, mtime: file.mtime });

  if (!isBezierHostAvailable()) return <div className={styles.unavailable}>
    <Icon name="globe" size={28} /><strong>{t('browserCollector.unavailableTitle')}</strong>
    <p>{t('browserCollector.unavailableBody')}</p>
  </div>;

  return <div className={styles.root} data-testid="browser-collector">
    <div className={styles.browser}>
      <DesignBrowserPanel
        variant="collector"
        projectId={projectId}
        workspaceContext={workspaceContext}
        initialUrl={initialUrl}
        onRefreshFiles={onRefreshFiles}
        onExtractPage={onExtractPage}
        sendDisabled={extractPageDisabled}
        onOpenFile={() => undefined}
        onPageInfoChange={({ url }) => {
          if (!/^https?:\/\//i.test(url)) return;
          try { localStorage.setItem(`bezier-design:collector:${projectId}:url`, url); } catch { /* optional navigation cache */ }
        }}
        onCollectedFile={async (file, source) => {
          const metadata = await writeProjectTextFile(projectId, `${file.name}.source.json`, JSON.stringify({
            schema: 'bezier-design.browser-capture.v1', file: file.name, captureMode: source.captureMode || 'visible-snapshot', ...source,
          }, null, 2), undefined, workspaceContext);
          setNotice(metadata
            ? { message: t('browserCollector.savedOk'), error: false }
            : { message: t('browserCollector.savedMetaFail'), error: true });
        }}
      />
    </div>
    <section className={styles.tray} aria-label={t('browserCollector.trayAria')}>
      <Button variant="ghost" className={styles.trayHeading} aria-label={t('browserCollector.trayAria')} aria-expanded={trayOpen} onClick={() => setTrayOpen(open => !open)}>
        <span className={styles.trayTitle}>{t('browserCollector.trayTitle')}</span>
        <span className={styles.hint} role="status">{notice && !notice.error ? notice.message : t('browserCollector.trayHint')}</span>
        <span className={styles.chevron} data-open={trayOpen}><Icon name="chevron-down" size={13} /></span>
      </Button>
      {notice?.error ? <p className={styles.notice} role="alert">{notice.message}</p> : null}
      {trayOpen ? <>
        {collected.length ? <div className={styles.grid}>
          {collected.map(file => <article key={file.name} className={styles.card} draggable
            aria-label={t('browserCollector.dragAria', { name: file.name })}
            onDragStart={event => {
              event.dataTransfer.effectAllowed = 'copy';
              event.dataTransfer.setData(PROJECT_FILE_DRAG_MIME, JSON.stringify(payload(file)));
              event.dataTransfer.setData('text/plain', file.name);
            }}>
            <img src={projectFileUrl(projectId, file.name, workspaceContext)} alt={t('browserCollector.imageAlt')} loading="lazy" draggable={false} />
            <Button variant="default" className={`${styles.add} bezier-tooltip`} aria-label={t('browserCollector.addAria', { name: file.name })} data-tooltip={t('browserCollector.addTooltip')}
              onClick={() => window.dispatchEvent(new CustomEvent(PROJECT_FILE_ADD_TO_CANVAS_EVENT, { detail: payload(file) }))}>
              <Icon name="plus" size={13} /><span>{t('browserCollector.add')}</span>
            </Button>
            <Button variant="ghost" size="sm" disabled={!onSaveToAssetSource} aria-label={t('browserCollector.saveAssetAria', { name: file.name })} onClick={() => {
              setNotice({message:t('browserCollector.savingAsset'),error:false});
              void onSaveToAssetSource?.(file).then(()=>setNotice({message:t('browserCollector.savedAsset'),error:false})).catch(error=>setNotice({message:error instanceof Error?error.message:t('browserCollector.saveFail'),error:true}));
            }}>{t('browserCollector.saveAsAsset')}</Button>
          </article>)}
        </div> : <p className={styles.empty}>{t('browserCollector.emptyLine1')}<br />{t('browserCollector.emptyLine2')}</p>}
        <p className={styles.disclaimer}>{t('browserCollector.disclaimer')}</p>
      </> : null}
    </section>
  </div>;
}
