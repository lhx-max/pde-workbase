import { useState, type ReactNode } from 'react';
import { assetMetadataYaml, type PersonalAsset, type PersonalAssetKind } from '@bezier/contracts';
import { AssetDetailInspector, AssetDetailSection } from './AssetDetailDialog';
import { AssetMetadataToolbar, AssetYamlEditor } from './AssetMetadataControls';
import { Icon } from './Icon';
import { useI18n, useT } from '../i18n';
import { formatAppDate } from '../utils/app-date';
import type { Dict } from '../i18n/types';
import styles from './PersonalAssetLibrary.module.css';

const KIND_KEYS: Record<PersonalAssetKind, keyof Dict> = {
  folder: 'entry.personalAssets.kind.folder',
  text: 'entry.personalAssets.kind.text',
  script: 'entry.personalAssets.kind.script',
  image: 'entry.personalAssets.kind.image',
  video: 'entry.personalAssets.kind.video',
  audio: 'entry.personalAssets.kind.audio',
  slides: 'entry.personalAssets.kind.slides',
  webpage: 'entry.personalAssets.kind.webpage',
  motion: 'entry.personalAssets.kind.motion',
  file: 'entry.personalAssets.kind.file',
};

export function assetKindLabel(kind: PersonalAssetKind, t: (key: keyof Dict, vars?: Record<string, string | number>) => string): string {
  return t(KIND_KEYS[kind]);
}

/** Same asset record, inspector sections and YAML as the library; no mutation capability. */
export function AssetMetadataReadOnly({ asset, spaceName, actions }: { asset: PersonalAsset; spaceName?: string; actions?: ReactNode }) {
  const t = useT();
  const { locale } = useI18n();
  const [yaml, setYaml] = useState(false);
  const version = asset.versions.at(-1);
  const metadata = version?.imageMetadata;
  return <AssetDetailInspector toolbar={<AssetMetadataToolbar yaml={yaml} onToggle={() => setYaml(value => !value)} />} actions={actions}>
    {yaml ? <AssetYamlEditor value={assetMetadataYaml(asset)} readOnly /> : <>
      <AssetDetailSection title={t('entry.personalAssets.meta.space')}><p>{spaceName || (asset.spaceId === 'default-project' ? t('entry.personalAssets.meta.defaultSpace') : t('entry.personalAssets.meta.noSpace'))}</p></AssetDetailSection>
      <AssetDetailSection title={t('entry.personalAssets.detail.name')}><p>{asset.name}</p></AssetDetailSection>
      <AssetDetailSection title={t('entry.personalAssets.detail.tags')}><div className={styles.tagList}>{asset.tags.length ? asset.tags.map(tag => <span className={styles.tag} key={tag}>{tag}</span>) : <p>{t('entry.personalAssets.meta.noTags')}</p>}</div></AssetDetailSection>
      <AssetDetailSection title={t('entry.personalAssets.detail.description')}><p>{asset.description || t('entry.personalAssets.meta.noDescription')}</p></AssetDetailSection>
      <AssetDetailSection title={t('entry.personalAssets.detail.style')}><p>{asset.style || t('entry.personalAssets.meta.blank')}</p></AssetDetailSection>
      <AssetDetailSection title={t('entry.personalAssets.detail.usage')}><p>{asset.usage || t('entry.personalAssets.meta.blank')}</p></AssetDetailSection>
      <AssetDetailSection title={t('entry.personalAssets.meta.rating')}><div className={styles.rating} role="img" aria-label={asset.rating ? t('entry.personalAssets.meta.rated', { rating: asset.rating }) : t('entry.personalAssets.meta.unrated')}>{[1,2,3,4,5].map(star => <span key={star} aria-hidden="true" style={{color: star <= (asset.rating || 0) ? 'var(--text-strong)' : 'var(--text-faint)'}}><Icon name="star" size={19}/></span>)}</div></AssetDetailSection>
      <AssetDetailSection title={t('entry.personalAssets.detail.fileInfo')}><dl className={styles.fileInfo}>
        {metadata?.width && <><dt>{t('entry.personalAssets.meta.dimensions')}</dt><dd>{metadata.width} × {metadata.height}</dd></>}
        <dt>{t('entry.personalAssets.meta.type')}</dt><dd>{assetKindLabel(asset.kind, t)}</dd>
        <dt>{t('entry.personalAssets.meta.size')}</dt><dd>{version ? `${(version.size / 1024 / 1024).toFixed(2)} MB` : t('entry.personalAssets.meta.noFile')}</dd>
        <dt>{t('entry.personalAssets.meta.added')}</dt><dd>{formatAppDate(asset.createdAt, locale)}</dd>
      </dl>
      {!!metadata?.colors?.length && <div className={styles.tagList} style={{marginTop:12}} aria-label={t('entry.personalAssets.meta.imageColors')}>{metadata.colors.map(color => <span key={color.hex} title={color.hex} aria-label={color.hex} style={{background:color.hex,width:22,height:22,borderRadius:4,border:'1px solid var(--border)'}}/>)}</div>}
      {asset.source.url && /^https?:\/\//i.test(asset.source.url) && <a href={asset.source.url} target="_blank" rel="noreferrer" className={styles.sourceLink}>{t('entry.personalAssets.viewSource')} <Icon name="external-link" size={14}/></a>}
      </AssetDetailSection>
    </>}
  </AssetDetailInspector>;
}
