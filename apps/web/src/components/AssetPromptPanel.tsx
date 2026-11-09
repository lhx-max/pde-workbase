import { useEffect, useState } from 'react';
import type { PersonalAsset, PersonalAssetPrompt, AssetAnalysisStatus } from '@bezier/contracts';
import { Button } from './ui';
import { Icon } from './Icon';
import { personalAssets, isTemporaryAssetRequestError } from '../providers/asset-library';
import { useI18n } from '../i18n';
import { assetInspectorCopy } from '../i18n/locales/asset-inspector-copy';
import styles from './AssetAnalysisFields.module.css';
import { useAssetLibraryCapabilities } from './asset-library/use-asset-library-capabilities';

export function AssetPromptPanel({ asset, onUpdate, actionsBlocked = false }: { asset: PersonalAsset; onUpdate: (asset: PersonalAsset) => void; actionsBlocked?: boolean }) {
  const { locale } = useI18n();
  const copy = assetInspectorCopy(locale);
  const template = Boolean(asset.source?.template);
  const version = asset.versions?.at(-1)?.id;
  const capabilities = useAssetLibraryCapabilities();
  const eligible = ['image', 'text', 'script', 'slides', 'webpage', 'motion'].includes(asset.kind);
  const supported = capabilities.analysis && eligible;
  const [savedPrompt, setSavedPrompt] = useState<string | null>(null);
  const [generated, setGenerated] = useState<PersonalAssetPrompt | null>(asset.prompt ?? null);
  const [status, setStatus] = useState<AssetAnalysisStatus>();
  const [error, setError] = useState('');
  const [errorAction, setErrorAction] = useState<'read' | 'submit'>('read');
  const [reconnecting, setReconnecting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [copyError, setCopyError] = useState('');
  const [copied, setCopied] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const busy = submitting || status?.status === 'queued' || status?.status === 'running';
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let readFailures = 0;
    setLoading(true); setError(''); setReconnecting(false);
    async function check() {
      try {
        if (template) {
          const response = await fetch(personalAssets.contentUrl(asset, version), { signal: controller.signal });
          if (!response.ok) throw new Error(copy.promptReadFailed);
          const text = await response.text();
          if (!controller.signal.aborted) setSavedPrompt(text);
          return;
        }
        const next = await personalAssets.promptStatus(asset.id);
        if (controller.signal.aborted) return;
        setStatus(next); setGenerated(next.prompt ?? null);
        if (next.status === 'queued' || next.status === 'running') timer = setTimeout(() => void check(), 2000);
        if (next.status === 'ready') {
          const { assets } = await personalAssets.list();
          const current = assets.find(item => item.id === asset.id);
          if (!controller.signal.aborted && current && current.revision !== asset.revision) onUpdate(current);
        }
        readFailures = 0; setReconnecting(false); setError('');
      } catch (reason) {
        if (controller.signal.aborted) return;
        if (!template && isTemporaryAssetRequestError(reason) && ++readFailures <= 15) {
          setReconnecting(true);
          timer = setTimeout(() => void check(), 2000);
        } else {
          setReconnecting(false); setErrorAction('read');
          setError(isTemporaryAssetRequestError(reason) ? copy.promptKept : reason instanceof Error ? reason.message : copy.promptReadFailed);
        }
      } finally { if (!controller.signal.aborted) setLoading(false); }
    }
    void check();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [asset.id, template, version, attempt]);
  const prompt = template ? savedPrompt || '' : generated?.text || '';
  useEffect(() => { setCopied(false); setCopyError(''); }, [prompt]);
  async function generate() {
    if (!supported || busy || actionsBlocked) return;
    setSubmitting(true); setError('');
    try { setStatus(await personalAssets.generatePrompt(asset.id)); setAttempt(value => value + 1); }
    catch (reason) {
      setErrorAction('submit');
      setError(isTemporaryAssetRequestError(reason) ? copy.promptUnconfirmed : reason instanceof Error ? reason.message : copy.promptFailed);
    }
    finally { setSubmitting(false); }
  }
  async function copyPromptText() {
    try { await navigator.clipboard.writeText(prompt); setCopied(true); setCopyError(''); }
    catch { setCopyError(copy.copyFailed); }
  }
  return <>
    <div className={styles.panelHeading}>
      <span>{template ? copy.templatePrompt : copy.creationPrompt}</span>
      <div className={styles.panelActions}>
        {prompt && <Button variant="ghost" size="sm" onClick={() => void copyPromptText()} aria-label={copy.copyPrompt}><Icon name={copied ? 'check' : 'copy'} size={14}/>{copied ? copy.copied : copy.copy}</Button>}
        {!template && eligible && <Button variant="ghost" size="sm" title={!capabilities.analysis ? copy.analysisUnavailable : undefined} disabled={!supported || busy || loading || reconnecting || actionsBlocked} onClick={() => void generate()}><Icon name="refresh" size={14}/>{busy ? copy.extracting : prompt ? copy.extractAgain : copy.extract}</Button>}
      </div>
    </div>
    <p className={styles.hint}>{template ? copy.templateHint : !capabilities.analysis ? copy.analysisUnavailable : copy.extractHint}</p>
    {reconnecting && <p className={styles.status} role="status">{copy.reconnecting}</p>}
    {loading && !busy && !reconnecting && <p className={styles.status} role="status">{copy.readingPrompt}</p>}
    {busy && !reconnecting && <p className={styles.status} role="status">{status?.status === 'queued' ? copy.queued : copy.extractingNow}{prompt ? copy.keptResult : ''}</p>}
    {!error && status?.status === 'failed' && <p className={styles.error} role="alert">{status.error || copy.promptFailedRetry}</p>}
    {error && <div className={styles.error}><p role="alert">{error}</p><Button variant="ghost" size="sm" onClick={() => errorAction === 'submit' ? void generate() : setAttempt(value => value + 1)} disabled={submitting || (errorAction === 'submit' && actionsBlocked)}>{errorAction === 'submit' ? copy.submitAgain : copy.retry}</Button></div>}
    {!loading && !busy && !prompt && <div className={styles.empty}><Icon name="file-text" size={26}/><h3>{copy.noPromptTitle}</h3><p>{template ? copy.noTemplatePrompt : supported ? copy.clickExtract : copy.unsupportedPrompt}</p></div>}
    {prompt && <>
      {!template && generated?.versionId !== version && <p className={styles.hint}>{copy.previousVersion}</p>}
      <div className={styles.prompt} role="region" aria-label={template ? copy.templatePrompt : copy.creationPrompt} tabIndex={0}>{prompt}</div>
      {!template && <p className={styles.hint}>{copy.savedPrompt}</p>}
    </>}
    {copied && <span className={styles.copyStatus} role="status">{copy.promptCopied}</span>}
    {copyError && <p className={styles.error} role="alert">{copyError}</p>}
  </>;
}
