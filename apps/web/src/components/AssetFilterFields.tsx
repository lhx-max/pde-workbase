import type { PersonalAsset } from '@bezier/contracts';
import { Button, Input, Select } from '@/src/components/ui';
import { Icon } from './Icon';
import { AssetColorPicker } from './AssetColorPicker';
import { assetFormat, type AssetFilters } from './asset-filters';
import { useI18n } from '@/src/i18n';
import styles from './PersonalAssetLibrary.module.css';

export function AssetFilterFields({ value, onChange, assets }: {
  value: AssetFilters; onChange: (value: AssetFilters) => void; assets: PersonalAsset[];
}) {
  const { t } = useI18n();
  const set = (key: keyof AssetFilters, v: string) => onChange({ ...value, [key]: v });
  const toggle = (key: keyof AssetFilters, v: string) => set(key, value[key] === v ? '' : v);
  const formats = [...new Set(assets.filter(a => !a.deletedAt && a.kind !== 'folder').map(assetFormat))].filter(Boolean).sort();
  const shapes = [
    ['landscape', t('asset.filter.shape.landscape')],
    ['portrait', t('asset.filter.shape.portrait')],
    ['square', t('asset.filter.shape.square')],
  ] as const;
  return <>
    <div className={styles.filterRow} role="group" aria-label={t('asset.filter.colorAria')}>
      <span>{t('asset.filter.color')}</span>
      <div className={styles.colorChoices}>
        {['#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#a855f7', '#ec4899', '#ffffff', '#808080', '#000000'].map(hex =>
          <Button key={hex} size="icon" aria-label={t('asset.filter.colorNamed', { hex })} aria-pressed={value.color === hex} style={{ background: hex }} onClick={() => toggle('color', hex)} />)}
        <AssetColorPicker value={value.color} onChange={color => set('color', color)} />
      </div>
    </div>
    <div className={styles.filterRow} role="group" aria-label={t('asset.filter.ratingAria')}>
      <span>{t('asset.filter.rating')}</span>
      <div className={styles.filterChoices}>
        {[1, 2, 3, 4, 5].map(n => <Button key={n} size="xs" variant="ghost" aria-label={t('asset.filter.ratingAtLeast', { n })} aria-pressed={value.rating === String(n)} onClick={() => toggle('rating', String(n))}>{n}<Icon name="star" size={12} /></Button>)}
        <Button size="xs" variant="ghost" aria-pressed={value.rating === 'unrated'} onClick={() => toggle('rating', 'unrated')}>{t('asset.filter.unrated')}</Button>
      </div>
    </div>
    <div className={styles.filterRow} role="group" aria-label={t('asset.filter.shapeAria')}>
      <span>{t('asset.filter.shape')}</span>
      <div className={styles.filterChoices}>
        {shapes.map(([id, label]) => <Button key={id} size="xs" variant="ghost" aria-pressed={value.shape === id} onClick={() => toggle('shape', id)}><i className={styles.shapeIcon} data-shape={id} />{label}</Button>)}
      </div>
    </div>
    {formats.length > 0 && <div className={styles.filterRow} role="group" aria-label={t('asset.filter.formatAria')}><span>{t('asset.filter.format')}</span><div className={styles.formatChoices}>{formats.map(format => <Button key={format} size="xs" variant="ghost" aria-pressed={value.format === format} onClick={() => toggle('format', format)}>{format.toUpperCase()}</Button>)}</div></div>}
    <label className={styles.filterRow}>{t('asset.filter.location')}<Select aria-label={t('asset.filter.locationAria')} value={value.location} onChange={e => set('location', e.target.value)}><option value="">{t('asset.filter.allLocations')}</option><option value="root">{t('asset.filter.root')}</option>{assets.filter(a => a.kind === 'folder' && !a.deletedAt).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></label>
    <details className={styles.filterDates}>
      <summary>{t('asset.filter.dateRange')}<span>{value.addedAfter || value.modifiedAfter ? t('asset.filter.dateSet') : t('asset.filter.dateAny')}</span></summary>
      <div><label>{t('asset.filter.addedAfter')}<Input aria-label={t('asset.filter.addedAfter')} type="date" value={value.addedAfter} onChange={e => set('addedAfter', e.target.value)} /></label><label>{t('asset.filter.modifiedAfter')}<Input aria-label={t('asset.filter.modifiedAfter')} type="date" value={value.modifiedAfter} onChange={e => set('modifiedAfter', e.target.value)} /></label></div>
    </details>
  </>;
}
