import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Input } from '@bezier/components';
import { BROWSER_RESOURCE_KINDS, BROWSER_RESOURCE_LIMITS, BROWSER_RESOURCE_SORTS, filterBrowserResources,
  type BrowserResourceItem, type BrowserResourceKind, type BrowserResourceSort, type WorkspaceCollabContext } from '@bezier/contracts';
import { Checkbox, DropdownMenu, DropdownMenuContent, DropdownMenuTrigger, DropdownMenuRadioGroup, DropdownMenuRadioItem } from '../components/ui';
import { BrowserSaveDialog as SaveAssetDialog } from './BrowserSaveDialog';
import type { BrowserSaveDraft as SaveAssetDraft } from './project-capture';
import { Icon, type IconName } from '../components/Icon';
import { AssetPreviewDialog } from '../components/AssetContentPreview';
import { FilterChipRail } from '../components/FilterChipRail';
import { ResourceBatchConfirm } from './ResourceBatchConfirm';
import { saveBrowserCaptureFile } from './project-capture';
import { useT } from '../i18n';
import type { ResourceCaptureNode } from './BrowserResourcePlugin';
import { resourceAssetKind, resourceBytesLabel, resourceErrorCode, resourceFile, saveResourceBatch,
  type ResourceBatchMetadata, type ResourceSaveProgress } from './client';
import { useResourceSession } from './use-resource-session';
import { ResourceThumbnail } from './ResourceThumbnail';
import styles from './BrowserResources.module.css';

const KIND_ICONS: Record<BrowserResourceKind, IconName> = { image: 'image', svg: 'file-code', video: 'play', audio: 'volume', font: 'heading-1', stream: 'link' };
export default function BrowserResourcePanel({ node, projectId, tabId, workspaceContext, onClose }: {
  node: ResourceCaptureNode; projectId: string; tabId: string; workspaceContext?: WorkspaceCollabContext | null; onClose(): void;
}) {
  const t = useT();
  const session = useResourceSession(node, projectId, tabId, workspaceContext);
  const [kind, setKind] = useState<BrowserResourceKind | 'all'>('all');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<BrowserResourceSort>('resolution');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmation, setConfirmation] = useState<{ items: BrowserResourceItem[]; navigationId: number } | null>(null);
  const [preview, setPreview] = useState<{ item: BrowserResourceItem; url?: string; mime?: string; draft?: SaveAssetDraft; loading: boolean; error?: ReturnType<typeof resourceErrorCode> } | null>(null);
  const [progress, setProgress] = useState<Record<string, ResourceSaveProgress>>({});
  const [saving, setSaving] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [localError, setLocalError] = useState<ReturnType<typeof resourceErrorCode> | null>(null);
  const captureIds = useRef(new Map<string, string>());
  const stopRequested = useRef(false);
  const saveLock = useRef(false);
  const alive = useRef(true);
  const previewSequence = useRef(0);
  const latestSnapshot = useRef(session.snapshot);
  latestSnapshot.current = session.snapshot;
  useEffect(() => { alive.current = true; return () => { alive.current = false; stopRequested.current = true; previewSequence.current++; }; }, []);
  useEffect(() => { const url = preview?.url; return () => { if (url) URL.revokeObjectURL(url); }; }, [preview?.url]);
  useEffect(() => {
    setSelected(new Set()); setConfirmation(null); setPreview(null); previewSequence.current++;
    stopRequested.current = true;
    setLocalError(null);
  }, [session.epoch]);
  useEffect(() => {
    if (!session.snapshot?.enabled) { setSelected(new Set()); setPreview(null); setConfirmation(null); previewSequence.current++; }
  }, [session.snapshot?.enabled]);

  const rows = session.snapshot?.items ?? [];
  const filtered = useMemo(() => filterBrowserResources(rows, { kind, query, sort }), [rows, kind, query, sort]);
  const selectable = filtered.filter(item => item.readable && progress[item.id]?.state !== 'saved').slice(0, BROWSER_RESOURCE_LIMITS.batch);
  const allSelected = selected.size >= BROWSER_RESOURCE_LIMITS.batch || (selectable.length > 0 && selectable.every(item => selected.has(item.id)));
  const savedCount = Object.values(progress).filter(value => value.state === 'saved').length;
  const failedCount = Object.values(progress).filter(value => value.state === 'failed').length;
  const selectedRows = filterBrowserResources(rows.filter(item => selected.has(item.id) && item.readable && progress[item.id]?.state !== 'saved'), { sort });
  const error = localError ?? session.error;
  const disabled = saving || session.busy || !session.snapshot?.enabled;
  const toggle = (item: BrowserResourceItem, checked: boolean) => setSelected(current => {
    const next = new Set(current);
    if (!checked) next.delete(item.id);
    else if (next.size < BROWSER_RESOURCE_LIMITS.batch) next.add(item.id);
    return next;
  });
  async function showPreview(item: BrowserResourceItem) {
    if (!item.readable || item.kind === 'font' || !session.snapshot) return;
    const request = ++previewSequence.current;
    const navigationId = session.snapshot.navigationId;
    setPreview({ item, loading: true }); setLocalError(null);
    try {
      const result = await session.read(item.id, navigationId);
      if (!alive.current || request !== previewSequence.current || latestSnapshot.current?.navigationId !== navigationId) return;
      if (result.resourceId !== item.id || result.navigationId !== navigationId) throw new Error('Resource identity changed');
      const file = resourceFile(result);
      const url = URL.createObjectURL(file);
      setPreview({ item, url, mime: result.mime, loading: false, draft: {
        name: item.name, filename: file.name, url, mime: result.mime, kind: resourceAssetKind(item),
        source: { url: result.pageUrl, projectId }, workspaceContext, aiFill: false,
        allowAiFill: item.kind === 'image' && result.mime.startsWith('image/'),
        // Saving is a fresh native read, not an upload of potentially stale preview bytes.
        readContent: async signal => {
          try {
            signal.throwIfAborted();
            const fresh = await session.read(item.id, navigationId);
            signal.throwIfAborted();
            if (request !== previewSequence.current || fresh.resourceId !== item.id || fresh.navigationId !== navigationId || fresh.mime !== result.mime) {
              throw new Error('Resource identity changed');
            }
            return resourceFile(fresh);
          } catch (error) { throw new Error(t(`browserResources.error.${resourceErrorCode(error)}`)); }
        },
      } });
    } catch (error) {
      if (alive.current && request === previewSequence.current) setPreview({ item, loading: false, error: resourceErrorCode(error) });
    }
  }
  async function save(metadata: ResourceBatchMetadata) {
    const input = confirmation;
    if (!input || saveLock.current) return;
    if (latestSnapshot.current?.navigationId !== input.navigationId || !latestSnapshot.current?.enabled) {
      setConfirmation(null); setLocalError('stale-document'); return;
    }
    saveLock.current = true; stopRequested.current = false; setSaving(true); setStopping(false);
    setConfirmation(null); setLocalError(null);
    try {
      await saveResourceBatch({ ...input, projectId, metadata,
        shouldStop: () => stopRequested.current || !alive.current,
        captureId: item => {
          const key = `${input.navigationId}:${item.id}`;
          const id = captureIds.current.get(key) ?? crypto.randomUUID();
          captureIds.current.set(key, id);
          return id;
        },
        read: item => session.read(item.id, input.navigationId), upload: (file, parentId, source, spaceId, metadata) => saveBrowserCaptureFile(file, source, metadata, workspaceContext, { parentId, spaceId }),
        onProgress: update => {
          if (!alive.current) return;
          setProgress(current => ({ ...current, [update.id]: update }));
          if (update.state === 'saved') setSelected(current => { const next = new Set(current); next.delete(update.id); return next; });
        },
      });
    } catch (error) { if (alive.current) setLocalError(resourceErrorCode(error)); }
    finally {
      saveLock.current = false;
      if (alive.current) { setSaving(false); setStopping(false); }
    }
  }

  return <aside className={styles.panel} aria-label={t('browserResources.title')} data-browser-resource-panel>
    <header className={styles.header}>
      <div><h2><Icon name="puzzle" size={16} />{t('browserResources.title')}</h2><p>{t('browserResources.subtitle')}</p></div>
      <div className={styles.actions}>
        <Button type="button" variant="ghost" className={styles.iconButton} aria-label={t('browserResources.close')} onClick={onClose}><Icon name="close" size={16} /></Button>
      </div>
    </header>
    <div className={styles.controls}>
      <div className={styles.statusRow}>
        <span className={styles.state} data-enabled={!!session.snapshot?.enabled}><i />{t(session.recovering ? 'browserResources.refreshing' : session.snapshot?.enabled ? 'browserResources.live' : 'browserResources.paused')}</span>
        <div className={styles.actions}>
          {saving ? <Button type="button" variant="ghost" className={styles.iconButton} disabled={stopping} aria-label={t(stopping ? 'browserResources.stopping' : 'browserResources.stopQueue')} title={t(stopping ? 'browserResources.stopping' : 'browserResources.stopQueue')} onClick={() => { stopRequested.current = true; setStopping(true); }}><Icon name="close" size={14} /></Button>
            : <Button type="button" variant="ghost" className={styles.saveButton} aria-label={t('browserResources.save')} title={t('browserResources.selection', { count: selectedRows.length })} disabled={disabled || selectedRows.length === 0} onClick={() => session.snapshot && setConfirmation({ items: selectedRows, navigationId: session.snapshot.navigationId })}><Icon name="download" size={14} />{t('browserResources.saveCount', { count: selectedRows.length })}</Button>}
          <Button type="button" variant="ghost" className={styles.iconButton} disabled={saving || session.busy || !session.grant} title={t(session.snapshot?.enabled ? 'browserResources.pause' : 'browserResources.resume')} aria-label={t(session.snapshot?.enabled ? 'browserResources.pause' : 'browserResources.resume')} onClick={() => { setLocalError(null); void session.control(session.snapshot?.enabled ? 'stop' : 'start'); }}><Icon name={session.snapshot?.enabled ? 'pause' : 'play'} size={14} /></Button>
        </div>
      </div>
      <Input aria-label={t('browserResources.search')} placeholder={t('browserResources.search')} value={query} onChange={event => setQuery(event.target.value)} />
      <FilterChipRail className={styles.kinds} ariaLabel={t('browserResources.title')} value={kind} scrollControls
        onValueChange={value => setKind(value as BrowserResourceKind | 'all')}
        items={(['all', ...BROWSER_RESOURCE_KINDS] as const).map(value => ({ id: value,
          label: <>{t(`browserResources.kind.${value}`)}<span className={styles.kindCount}>{value === 'all' ? rows.length : rows.filter(item => item.kind === value).length}</span></>,
        }))} />
      <div className={styles.selectionRow}>
        <span>{t('browserResources.selection', { count: selectedRows.length })}</span>
        <div className={styles.selectionActions}>
          <Button type="button" variant="ghost" className={styles.selectAll} disabled={disabled || (!selected.size && !selectable.length)} onClick={() => setSelected(allSelected || !selectable.length ? new Set() : new Set(selectable.map(item => item.id)))}>
            {t(allSelected || (!selectable.length && selected.size > 0) ? 'browserResources.deselectAll' : 'browserResources.selectAll')}
          </Button>
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="ghost" className={`${styles.iconButton} ${styles.sortTrigger}`} aria-label={t('browserResources.sort')} title={t(`browserResources.sort.${sort}`)}>
                <Icon name="sort" size={15} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" sideOffset={8} className={styles.sortMenu} aria-label={t('browserResources.sort')}>
              <DropdownMenuRadioGroup value={sort} onValueChange={value => setSort(value as BrowserResourceSort)}>
                {BROWSER_RESOURCE_SORTS.map(value => <DropdownMenuRadioItem key={value} value={value}>{t(`browserResources.sort.${value}`)}</DropdownMenuRadioItem>)}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
    {error && error !== 'stale-document' && <div className={styles.message} role="alert">{t(`browserResources.error.${error}`)}<Button type="button" variant="ghost" disabled={saving || session.busy} onClick={() => { setLocalError(null); session.retry(); }}>{t('common.retry')}</Button></div>}
    {session.snapshot?.limitReached && <p className={styles.message}>{t('browserResources.limit')}</p>}
    {(savedCount > 0 || failedCount > 0) && <p role="status" className={styles.summary}>{t('browserResources.summary', { saved: savedCount, failed: failedCount })}</p>}
    <div className={styles.list} data-browser-resource-list aria-busy={session.busy || session.recovering}>
      {!session.snapshot && session.busy ? <p className={styles.empty} role="status">{t('browserResources.loading')}</p> : filtered.length === 0 ? <div className={styles.empty}><Icon name="search" size={28} /><p>{t(rows.length ? 'browserResources.noMatch' : 'browserResources.empty')}</p></div> : filtered.map(item => {
        const outcome = progress[item.id];
        const reason = item.unavailableReason === 'too-large' ? t('browserResources.tooLarge') : !item.readable ? t('browserResources.unsupported') : undefined;
        return <div key={item.id} className={styles.resource} data-selected={selected.has(item.id)}>
          <Checkbox checked={selected.has(item.id)} disabled={disabled || !item.readable || outcome?.state === 'saved' || (!selected.has(item.id) && selected.size >= BROWSER_RESOURCE_LIMITS.batch)} aria-label={t('browserResources.select', { name: item.name })} onCheckedChange={value => toggle(item, value === true)} />
          <ResourceThumbnail item={item} navigationId={session.snapshot?.navigationId ?? 0} epoch={session.epoch} read={session.read} enabled={!!session.snapshot?.enabled && !session.recovering} className={styles.resourceIcon} fallback={<Icon name={KIND_ICONS[item.kind]} size={19} />} />
          <div className={styles.resourceInfo}>
            <strong title={item.name}>{item.name}</strong>
            <span className={styles.url} title={item.url}>{item.url}</span>
            <div className={styles.meta}><span>{item.size === undefined ? t('browserResources.unknownSize') : resourceBytesLabel(item.size)}</span>{item.width !== undefined && item.height !== undefined && <span>{item.width} × {item.height}</span>}<span>{t(`browserResources.source.${item.source}`)}</span></div>
            {reason && <span className={styles.reason}>{reason}</span>}
            {outcome && <span className={styles.outcome} data-state={outcome.state} role="status" title={outcome.error ? t(`browserResources.error.${outcome.error}`) : undefined}>{t(`browserResources.${outcome.state}`)}</span>}
          </div>
          {item.readable && item.kind !== 'font' && <Button type="button" variant="ghost" className={styles.iconButton} disabled={disabled || outcome?.state === 'saved'} aria-label={t('browserResources.preview', { name: item.name })} title={t('browserResources.preview', { name: item.name })} onClick={() => { void showPreview(item); }}><Icon name="eye" size={15} /></Button>}
        </div>;
      })}
    </div>
    {preview?.draft ? <SaveAssetDialog key={preview.item.id} draft={preview.draft} onFinish={asset => {
      if (asset) {
        const id = preview.item.id;
        setProgress(current => ({ ...current, [id]: { id, state: 'saved', assetId: asset.id } }));
        setSelected(current => { const next = new Set(current); next.delete(id); return next; });
      }
      previewSequence.current++; setPreview(null);
    }} /> : preview && <AssetPreviewDialog source={{ name: preview.item.name, kind: resourceAssetKind(preview.item) }} loading={preview.loading} error={preview.error ? t(`browserResources.error.${preview.error}`) : undefined} onRetry={() => { void showPreview(preview.item); }} onClose={() => { previewSequence.current++; setPreview(null); }} />}
    {confirmation && <ResourceBatchConfirm count={confirmation.items.length} imageCount={confirmation.items.filter(item => item.kind === 'image').length} projectId={projectId} workspaceContext={workspaceContext} onCancel={() => setConfirmation(null)} onConfirm={metadata => { void save(metadata); }} />}
  </aside>;
}
