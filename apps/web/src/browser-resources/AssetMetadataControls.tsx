import { Button, Checkbox, Textarea, DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem } from '@/src/components/ui';
import { Icon } from '../components/Icon';
import { AssetDetailSection, useAssetDetailPortalContainer } from './AssetDetailDialog';
import { useI18n } from '@/src/i18n';
import styles from './SaveAssetDialog.module.css';
import assetStyles from './PersonalAssetLibrary.module.css';

export function AssetRatingField({value=0,onChange,disabled=false}:{value?:number;onChange:(rating:number)=>void;disabled?:boolean}) {
  const { t } = useI18n();
  return <AssetDetailSection title={t('asset.meta.rating')}><div className={assetStyles.rating} role="group" aria-label={t('asset.meta.ratingAria')}>
    {[1,2,3,4,5].map(star=><Button key={star} type="button" variant="ghost" size="icon" aria-label={t('asset.meta.ratingStar', { n: star })} aria-pressed={value>=star} disabled={disabled} onClick={()=>onChange(value===star?0:star)}><Icon name="star" size={19}/></Button>)}
  </div></AssetDetailSection>;
}

export function AssetMetadataToolbar({yaml,onToggle,busy=false,aiFill,onAiFill,onReanalyze,reanalyzing=false,analysisLabel}:{yaml:boolean;onToggle:()=>void;busy?:boolean;aiFill?:boolean;onAiFill?:(value:boolean)=>void;onReanalyze?:()=>void;reanalyzing?:boolean;analysisLabel?:string}) {
  const { t } = useI18n();
  const label = analysisLabel ?? t('asset.meta.reanalyze');
  return <><div className={styles.aiRow}>{onAiFill ? <><Checkbox id="asset-ai-fill" aria-label={t('asset.meta.aiFill')} checked={aiFill} disabled={busy} onCheckedChange={value=>onAiFill(value===true)}/><label htmlFor="asset-ai-fill">{t('asset.meta.aiFill')}</label></> : <span>{t('asset.meta.info')}</span>}</div><div className={styles.toolbarActions}>{onReanalyze&&<Button variant="ghost" className={styles.reanalyze} disabled={busy||reanalyzing} onClick={onReanalyze}>{reanalyzing?t('asset.meta.analyzing'):label}</Button>}<Button variant="ghost" className={styles.mode} disabled={busy} onClick={onToggle}>{yaml?t('asset.meta.form'):t('asset.meta.yaml')}</Button></div></>;
}
export function AssetYamlEditor({value,onChange,busy=false,readOnly=false}:{value:string;onChange?:(value:string)=>void;busy?:boolean;readOnly?:boolean}) {
  const { t } = useI18n();
  return <AssetDetailSection title={t('asset.meta.yaml')}><Textarea aria-label={t('asset.meta.yamlAria')} rows={20} value={value} disabled={busy} readOnly={readOnly} onChange={onChange ? e=>onChange(e.target.value) : undefined} style={{fontFamily:'monospace',fontSize:12}}/></AssetDetailSection>;
}
export function AssetSpaceField({value,spaces,onChange,disabled=false}:{value:string;spaces:{id:string;name:string}[];onChange:(value:string)=>void;disabled?:boolean}) {
  const { t } = useI18n();
  const portalContainer = useAssetDetailPortalContainer();
  return <AssetDetailSection title={t('asset.meta.space')}><DropdownMenu><DropdownMenuTrigger asChild><Button className={styles.space} aria-label={t('asset.meta.space')} disabled={disabled}><Icon name="folder" size={16}/><span className={styles.spaceName}>{spaces.find(space=>space.id===value)?.name || t('asset.meta.chooseSpace')}</span><Icon name="chevron-down" size={14}/></Button></DropdownMenuTrigger><DropdownMenuContent container={portalContainer ?? undefined} className={styles.menu} align="start"><DropdownMenuRadioGroup value={value} onValueChange={onChange}>{spaces.map(space=><DropdownMenuRadioItem key={space.id} value={space.id}>{space.name}</DropdownMenuRadioItem>)}</DropdownMenuRadioGroup></DropdownMenuContent></DropdownMenu></AssetDetailSection>;
}
