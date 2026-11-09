// Original AssetReferenceChoices.tsx; host-neutral query/preview adaptation.
import { useEffect, useState } from 'react';
import type { FormOption, QuestionForm } from '../artifacts/question-form';
import { Button, RadioGroup, RadioGroupItem } from './ui';
import { AssetContentPreview, AssetPreviewDialog } from './AssetContentPreview';
import { Icon } from './Icon';
import { useT } from '../i18n';
import { queryQuestionReferences, type QuestionReferenceAdapter, type QuestionReferenceAsset } from './question-form-reference-adapter';
import styles from './AssetReferenceChoices.module.css';

export function useAssetReferenceLibrary(form: QuestionForm, adapter?: QuestionReferenceAdapter) {
  const t = useT();
  const active = form.questions.some(q => q.options?.some(o => o.asset));
  const [state, setState] = useState<{ assets: QuestionReferenceAsset[]; ready: boolean; loading: boolean; error: string; owner?: QuestionReferenceAdapter }>({ assets: [], ready: false, loading: false, error: '' });
  useEffect(() => {
    if (!active) return;
    let disposed = false;
    let controller: AbortController | undefined;
    const refresh = async () => {
      controller?.abort();
      const request = new AbortController();
      controller = request;
      setState({ assets: [], ready: false, loading: true, error: '', owner: adapter });
      try {
        const assets = await queryQuestionReferences(adapter, form, request.signal);
        if (!disposed && !request.signal.aborted) setState({ assets, ready: true, loading: false, error: '', owner: adapter });
      } catch (error) {
        if (!disposed && !request.signal.aborted) setState({ assets: [], ready: true, loading: false, error: adapter && error instanceof Error ? error.message : t('canvasTask.previewUnavailable'), owner: adapter });
      }
    };
    void refresh();
    const unsubscribe = adapter?.subscribe?.(() => { void refresh(); });
    return () => { disposed = true; controller?.abort(); unsubscribe?.(); };
  }, [active, form, adapter, t]);
  return active && state.owner === adapter ? state : { assets: [], ready: !active, loading: active, error: '' };
}

export function matchingReference(option: FormOption, assets: QuestionReferenceAsset[]) {
  const ref = option.asset;
  if (!ref) return undefined;
  return assets.find(a => a.id === ref.assetId && !a.deletedAt &&
    (a.spaceId || 'default-project') === ref.spaceId && a.versions.at(-1)?.id === ref.versionId);
}

export function selectedReferencesValid(form: QuestionForm, answers: Record<string, string | string[]>, assets: QuestionReferenceAsset[]) {
  return form.questions.every(q => {
    const values = Array.isArray(answers[q.id]) ? answers[q.id] : [answers[q.id]];
    return q.options?.every(o => !o.asset || !values?.includes(o.value) || !!matchingReference(o, assets)) ?? true;
  });
}

/** Original asset-backed radio cards, with host-owned references and previews. */
export function AssetReferenceChoices({ options, value, disabled, assets, loading, error, label, onChange, adapter }: {
  options: FormOption[]; value: string; disabled: boolean; assets: QuestionReferenceAsset[];
  loading: boolean; error: string; label: string; onChange: (value: string) => void; adapter?: QuestionReferenceAdapter;
}) {
  const t = useT();
  const [previewId, setPreviewId] = useState<string | null>(null);
  const previewAsset = assets.find(a => a.id === previewId && !a.deletedAt);
  return <div className={styles.root}>
    {error ? <p role="alert" className={styles.status}>{error}</p> : null}
    <RadioGroup orientation="horizontal" value={value} onValueChange={onChange} disabled={disabled} aria-label={label} className={styles.grid}>
      {options.map(option => {
        const asset = matchingReference(option, assets);
        const unavailable = !!option.asset && !asset;
        return <div key={option.value} className={styles.card} data-selected={value === option.value} data-unavailable={unavailable}>
          <RadioGroupItem className={styles.control} value={option.value} disabled={disabled || unavailable} aria-label={asset?.name || option.label} />
          {option.asset ? <div className={styles.preview} aria-hidden="true">
            {asset && adapter?.renderThumbnail ? adapter.renderThumbnail(asset) : asset?.preview ? <AssetContentPreview source={asset.preview} /> : <Icon name="file-text" size={24} />}
          </div> : null}
          <div className={styles.copy}>
            <strong>{asset?.name || option.label}</strong>
            <span>{unavailable ? (loading ? t('common.loading') : t('canvasTask.previewUnavailable')) : option.description}</span>
          </div>
          {asset ? <Button variant="subtle" size="sm" className={styles.previewButton}
            aria-label={`${t('common.preview')} ${asset.name}`} onClick={() => setPreviewId(asset.id)}>
            {t('common.preview')}
          </Button> : null}
        </div>;
      })}
    </RadioGroup>
    {previewAsset ? adapter?.renderPreview ? adapter.renderPreview(previewAsset, () => setPreviewId(null)) : previewAsset.preview ? <AssetPreviewDialog source={previewAsset.preview} onClose={() => setPreviewId(null)} /> : <p role="alert" className={styles.status}>{t('canvasTask.previewUnavailable')}</p> : null}
  </div>;
}
