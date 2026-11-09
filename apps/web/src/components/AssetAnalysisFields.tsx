import { useEffect, useState, type ReactNode } from 'react';
import { assetMetadataYaml, parseAssetMetadataYaml, type PersonalAsset, type AssetAnalysisStatus } from '@bezier/contracts';
import { Button, Textarea } from './ui';
import { Icon } from './Icon';
import { AssetInspectorViews, type AssetInspectorView } from './AssetInspectorViews';
import { AssetPromptPanel } from './AssetPromptPanel';
import { personalAssets, PersonalAssetRequestError } from '../providers/asset-library';
import { useI18n } from '../i18n';
import { assetInspectorCopy } from '../i18n/locales/asset-inspector-copy';
import styles from './AssetAnalysisFields.module.css';
import { useAssetLibraryCapabilities } from './asset-library/use-asset-library-capabilities';

export function AssetAnalysisFields({ asset, onUpdate, children, space, actionsBlocked = false, onDirtyChange }: {
  asset: PersonalAsset; onUpdate: (asset: PersonalAsset) => void; children: ReactNode; space?: ReactNode;
  actionsBlocked?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const { locale } = useI18n();
  const copy = assetInspectorCopy(locale);
  const [view, setView] = useState<AssetInspectorView>('info');
  const [status, setStatus] = useState<AssetAnalysisStatus>();
  const [draft, setDraft] = useState<{ yaml: string; original: string; revision: number } | null>(null);
  const [error, setError] = useState('');
  const [retrying, setRetrying] = useState(false);
  const [saving, setSaving] = useState(false);
  const analyzing = retrying || status?.status === 'queued' || status?.status === 'running';
  const capabilities = useAssetLibraryCapabilities();
  const eligible = ['image', 'text', 'script', 'slides', 'webpage', 'motion'].includes(asset.kind);
  const supported = capabilities.analysis && eligible;
  const yaml = draft?.yaml ?? assetMetadataYaml(asset);
  const dirty = Boolean(draft && draft.yaml !== draft.original);
  useEffect(() => { onDirtyChange?.(dirty); return () => { onDirtyChange?.(false); }; }, [dirty, onDirtyChange]);
  async function reanalyze() {
    if (!supported || analyzing || dirty || saving || actionsBlocked) return;
    setRetrying(true); setError('');
    try { setStatus(await personalAssets.analyze(asset.id)); }
    catch (reason) { setError(reason instanceof PersonalAssetRequestError && reason.message.startsWith('Asset request failed') ? copy.requestFailed(reason.status) : reason instanceof Error ? reason.message : copy.retryFailed); }
    finally { setRetrying(false); }
  }
  useEffect(() => {
    if (!supported) { setStatus(undefined); return; }
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    async function check() {
      try {
        const next = await personalAssets.analysisStatus(asset.id);
        if (stopped) return;
        setStatus(next);
        if (next.status === 'queued' || next.status === 'running' || next.paused) timer = setTimeout(() => void check(), 2000);
        if (next.status === 'ready') {
          const { assets } = await personalAssets.list();
          const current = assets.find(item => item.id === asset.id);
          if (!stopped && current && current.revision !== asset.revision) onUpdate(current);
        }
      } catch { if (!stopped) setError(copy.statusFailed); }
    }
    void check();
    return () => { stopped = true; clearTimeout(timer); };
  }, [supported, asset.id, asset.revision, status?.status === 'queued' || status?.status === 'running']);
  async function apply() {
    if (!draft || saving || actionsBlocked) return;
    setSaving(true); setError('');
    try {
      const result = await personalAssets.patch(asset.id, { ...parseAssetMetadataYaml(draft.yaml), revision: draft.revision });
      onUpdate(result.asset); setDraft(null);
    } catch (reason) { setError(reason instanceof Error ? reason.message : copy.saveFailed); }
    finally { setSaving(false); }
  }
  const analysisStatus = status?.status === 'ready' ? copy.analysisReady
    : status?.status === 'queued' ? `${status.queue ? copy.queue(status.queue.running, status.queue.queued) : copy.queued}${status.error ? ` · ${copy.retryWait(status.error)}` : ''}`
    : status?.status === 'running' ? copy.analyzing : '';
  return <AssetInspectorViews view={view} onViewChange={setView} actions={view === 'analysis' && dirty ? <>
      <Button variant="ghost" disabled={saving} onClick={() => { setDraft(null); setError(''); }}>{copy.undo}</Button>
      <Button variant="primary" disabled={saving || actionsBlocked} onClick={() => void apply()}>{saving ? copy.saving : copy.saveYaml}</Button>
    </> : undefined} info={<>
        <div className={styles.panelHeading}><span>{copy.assetInfo}</span>{eligible && <Button variant="ghost" size="sm" title={!capabilities.analysis ? copy.analysisUnavailable : undefined} disabled={!supported || analyzing || saving || dirty || actionsBlocked} onClick={() => void reanalyze()}><Icon name="refresh" size={14}/>{analyzing ? copy.analysisRunning : copy.aiAnalyze}</Button>}</div>
        {eligible && !capabilities.analysis && <p className={styles.hint}>{copy.analysisUnavailable}</p>}
        {space}{children}
        {analysisStatus && <p className={styles.status} role="status">{analysisStatus}</p>}
        {!error && status?.status === 'failed' && <p className={styles.error} role="alert">{status.error || copy.analysisFailed}</p>}
      </>} yaml={<>
        <div className={styles.panelHeading}><span>{copy.yaml}</span>{eligible && <Button variant="ghost" size="sm" title={!capabilities.analysis ? copy.analysisUnavailable : undefined} disabled={!supported || analyzing || saving || dirty || actionsBlocked} onClick={() => void reanalyze()}><Icon name="refresh" size={14}/>{analyzing ? copy.analysisRunning : !status || status.status === 'idle' ? copy.aiAnalyze : copy.reanalyze}</Button>}</div>
        <p className={styles.hint}>{copy.yamlHint}</p>
        <Textarea className={styles.yaml} aria-label={copy.yamlAria} spellCheck={false} rows={16} value={yaml} disabled={saving || actionsBlocked} onChange={event => setDraft(current => ({ yaml: event.target.value, original: current?.original ?? assetMetadataYaml(asset), revision: current?.revision ?? asset.revision }))}/>
        {dirty && <p className={styles.hint}>{copy.dirtyHint}</p>}
        {analysisStatus && <p className={styles.status} role="status">{analysisStatus}</p>}
        {!error && status?.status === 'failed' && <p className={styles.error} role="alert">{status.error || copy.analysisFailed}</p>}
      </>} prompt={asset.kind === 'image' ? <AssetPromptPanel asset={asset} onUpdate={onUpdate} actionsBlocked={actionsBlocked || dirty || saving}/> : undefined}
      error={error && <p className={styles.error} role="alert">{error}</p>}
  />;
}
