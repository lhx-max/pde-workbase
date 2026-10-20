// Adapted from upstream 319e5eee: original picker geometry on neutral resource HTTP ports.
import { useEffect, useRef, useState } from 'react';
import type { DesignSystemDetail, DesignSystemSummary } from '@bezier/contracts';
import type { CanvasDialogRenderer } from '@bezier/canvas-workbench';
import { Button } from '@/src/components/ui';
import { useT } from '../../i18n';
import { requestJson } from '../../providers/registry';
import { AssetPickerDialog } from './AssetPickerDialog';
import { CollectionCard } from '../CollectionCard';
import { AssetDocumentPreview } from '../AssetDocumentPreview';
import styles from './DesignSystemAssetPicker.module.css';
import previewStyles from './DesignSystemPickerPreview.module.css';

export interface DesignSystemAssetPickerProps {
  selectedId?: string | null;
  onClose: () => void;
  onSelect: (system: DesignSystemSummary | null) => void | boolean | Promise<void | boolean>;
  renderDialog?: CanvasDialogRenderer;
}
const endpoint = (id: string) => `/api/design-systems/${encodeURIComponent(id)}`;
function isSummary(value: unknown): value is DesignSystemSummary {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<DesignSystemSummary>;
  return typeof item.id === 'string' && !!item.id && typeof item.title === 'string'
    && typeof item.category === 'string' && typeof item.summary === 'string'
    && (item.swatches === undefined || (Array.isArray(item.swatches) && item.swatches.every(color => typeof color === 'string')));
}
async function readDetail(id: string, signal: AbortSignal): Promise<DesignSystemDetail> {
  const payload = await requestJson<DesignSystemDetail & {designSystem?: DesignSystemDetail}>(endpoint(id), {signal, cache:'no-store'});
  signal.throwIfAborted();
  const value = payload?.designSystem ?? payload;
  if (!isSummary(value) || value.id !== id || (value.surface && value.surface !== 'web')) throw new Error('entry.designSystemPicker.deleted');
  return {...value, body:typeof payload.body === 'string' ? payload.body : typeof value.body === 'string' ? value.body : ''};
}
async function readShowcase(id: string, signal: AbortSignal): Promise<string> {
  const response = await fetch(`${endpoint(id)}/showcase`, {signal, cache:'no-store'});
  if (!response.ok) throw new Error('designSystemPicker.noPreview');
  // The independent resources adapter is JSON; upstream standalone hosts may return HTML.
  const value: unknown = response.headers.get('content-type')?.includes('json') ? await response.json() : await response.text();
  signal.throwIfAborted();
  const html = typeof value === 'string' ? value : value && typeof value === 'object' && 'html' in value ? value.html : undefined;
  if (typeof html !== 'string' || !html.trim()) throw new Error('designSystemPicker.noPreview');
  return html;
}
export function DesignSystemAssetPicker(props: DesignSystemAssetPickerProps) {
  const t = useT();
  const [systems, setSystems] = useState<DesignSystemSummary[]>([]);
  const [selected, setSelected] = useState<string | null>(props.selectedId ?? null);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [preview, setPreview] = useState<{id:string;detail?:DesignSystemDetail;html?:string;pending?:boolean;error?:string}>();
  const requests = useRef(new Set<AbortController>());
  const operation = useRef<AbortController | null>(null);
  const alive = useRef(true);
  const abortAll = () => { for (const request of requests.current) request.abort(); requests.current.clear(); operation.current = null; };
  const controller = () => { const request = new AbortController(); requests.current.add(request); return request; };
  const current = (request: AbortController) => alive.current && !request.signal.aborted;
  const message = (reason: unknown) => {
    const text = reason instanceof Error ? reason.message : 'entry.designSystemPicker.loadFailed';
    return /^(entry\.designSystemPicker\.|designSystemPicker\.)/.test(text) ? t(text as Parameters<typeof t>[0]) : text;
  };
  const close = () => { alive.current = false; abortAll(); props.onClose(); };
  useEffect(() => {
    alive.current = true;
    const refresh = () => { abortAll(); setBusy(false); setError(''); setRetry(value => value + 1); };
    window.addEventListener('design-systems-changed', refresh);
    return () => { alive.current = false; abortAll(); window.removeEventListener('design-systems-changed', refresh); };
  }, []);
  useEffect(() => { setSelected(props.selectedId ?? null); }, [props.selectedId]);
  useEffect(() => {
    const request = controller();
    setLoading(true); setLoadError(''); setSystems([]);
    void requestJson<{designSystems:DesignSystemSummary[]}>('/api/design-systems', {signal:request.signal, cache:'no-store'}).then(payload => {
      if (!current(request)) return;
      if (!Array.isArray(payload?.designSystems) || !payload.designSystems.every(isSummary)) throw new Error('entry.designSystemPicker.loadFailed');
      setSystems(payload.designSystems.filter(system => !system.surface || system.surface === 'web'));
    }).catch(reason => { if (current(request)) setLoadError(message(reason)); })
      .finally(() => { requests.current.delete(request); if (current(request)) setLoading(false); });
    return () => { request.abort(); requests.current.delete(request); };
  }, [retry, t]);
  const picked = systems.find(system => system.id === selected);
  useEffect(() => {
    if (!picked) { setPreview(undefined); return; }
    const request = controller(), id = picked.id;
    setPreview({id,pending:true});
    void Promise.allSettled([readDetail(id,request.signal),readShowcase(id,request.signal)]).then(([detail,showcase]) => {
      if (!current(request)) return;
      setPreview({id,detail:detail.status === 'fulfilled' ? detail.value : undefined,html:showcase.status === 'fulfilled' ? showcase.value : undefined,
        error:detail.status === 'rejected' ? message(detail.reason) : showcase.status === 'rejected' ? message(showcase.reason) : undefined});
    }).finally(() => requests.current.delete(request));
    return () => { request.abort(); requests.current.delete(request); };
  }, [picked?.id, retry, t]);
  const apply = async (clear = false) => {
    if (operation.current || (!clear && !picked)) return;
    const request = controller(); operation.current = request;
    setBusy(true); setError('');
    try {
      // Clear remains usable without a catalogue. Apply always re-authorizes the exact id.
      const latest = clear ? null : await readDetail(picked!.id,request.signal);
      if (!current(request)) return;
      const accepted = await props.onSelect(latest);
      if (!current(request)) return;
      if (accepted === false) throw new Error('entry.designSystemPicker.switchFailedRetry');
      close();
    } catch (reason) { if (current(request)) setError(message(reason)); }
    finally { requests.current.delete(request); if (operation.current === request) { operation.current = null; if (alive.current) setBusy(false); } }
  };
  const term = query.trim().toLocaleLowerCase();
  const items = systems.filter(system => !term || `${system.title} ${system.category} ${system.summary}`.toLocaleLowerCase().includes(term));
  const visiblePreview = preview?.id === picked?.id ? preview : undefined;
  return <AssetPickerDialog title={t('entry.designSystemPicker.title')} onClose={close} renderDialog={props.renderDialog} query={query} onQueryChange={setQuery} busy={loading || busy}
    error={error || loadError} onRetry={()=>{abortAll();setBusy(false);setError('');setRetry(value=>value+1);}}
    status={picked ? t('entry.designSystemPicker.selected',{title:picked.title}) : t('entry.designSystemPicker.pickHint')}
    actions={<><Button variant="ghost" disabled={busy} onClick={()=>void apply(true)}>{t('entry.designSystemPicker.clear')}</Button><Button variant="ghost" onClick={close}>{t('entry.designSystemPicker.cancel')}</Button><Button variant="primary" disabled={!picked || busy} onClick={()=>void apply()}>{t(busy ? 'entry.designSystemPicker.applying' : 'entry.designSystemPicker.use')}</Button></>}>
    {!items.length ? <div className="wap-empty">{t(loading ? 'entry.designSystemPicker.reading' : term ? 'entry.designSystemPicker.noMatch' : 'entry.designSystemPicker.emptySpace')}</div> : <div className={styles.layout}>
      <div className={styles.list} role="group" aria-label={t('entry.designSystemPicker.listAria')}>
        {items.map(system=><CollectionCard key={system.id} variant="compact" className={styles.card}><Button variant="ghost" className={styles.option} aria-pressed={selected === system.id} disabled={busy} onClick={()=>{setSelected(system.id);setError('');}}>
          <span className={styles.swatches} aria-hidden="true">{(system.swatches?.length ? system.swatches : ['#eeeeec','#969691','#30302e']).slice(0,5).map((color,index)=><i key={index} style={{backgroundColor:color}}/>)}</span>
          <strong>{system.title}</strong><span className={styles.summary}>{system.summary || system.category}</span>
        </Button></CollectionCard>)}
      </div>
      <div className={styles.preview} data-testid="design-system-picker-preview">{!picked ? <div className="wap-empty">{t('entry.designSystemPicker.previewHint')}</div> : <>
        <h3>{picked.title}</h3><p className={styles.summary}>{picked.summary || picked.category}</p>
        {visiblePreview?.pending ? <div role="status">{t('designSystemPicker.loadingPreview')}</div> : <>
          {visiblePreview?.html ? <iframe className={previewStyles.frame} title={t('designSystemPicker.previewFrameTitle',{title:picked.title})} sandbox="allow-scripts" srcDoc={visiblePreview.html}/>
            : visiblePreview?.detail?.body ? <AssetDocumentPreview kind="text" text={visiblePreview.detail.body}/>
            : <p>{t('designSystemPicker.noPreview')}</p>}
          {visiblePreview?.error && <p role="status">{visiblePreview.error}</p>}
        </>}
      </>}</div>
    </div>}
  </AssetPickerDialog>;
}
