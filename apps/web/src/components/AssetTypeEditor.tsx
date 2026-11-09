import { useEffect, useRef, useState } from 'react';
import { Button, Checkbox, Popover, PopoverContent, PopoverTrigger } from '@/src/components/ui';
import { Icon } from './Icon';
import { useI18n } from '@/src/i18n';
import styles from './AssetTypeEditor.module.css';

// The asset page and canvas sidebar share this default navigation order.
// Hidden types remain available in the editor and never delete stored assets.
export const ASSET_TYPE_IDS = ['Image','text','Prototype','Slides','script','HyperFrames','design-systems','audio'];
const DEFAULT_HIDDEN_ASSET_TYPES = ['audio'];
// v2 is the image-first layout revision. Leave v1 untouched as a backup;
// only preferences explicitly saved in this revision override its defaults.
export const ASSET_TYPE_SETTINGS_KEY = 'designai:asset-type-navigation:v2';
const ASSET_TYPE_SETTINGS_CHANGED = 'designai:asset-type-navigation-changed';export type AssetTypeSettings = { order:string[]; hidden:string[] };
export function normalizeAssetTypeSettings(value: unknown): AssetTypeSettings {
  const input = value && typeof value === 'object' ? value as Partial<AssetTypeSettings> : {};
  const order = [...new Set([...(Array.isArray(input.order) ? input.order.filter(id=>ASSET_TYPE_IDS.includes(id)) : []),...ASSET_TYPE_IDS])];
  const hidden = [...new Set(Array.isArray(input.hidden) ? input.hidden.filter(id=>ASSET_TYPE_IDS.includes(id)) : DEFAULT_HIDDEN_ASSET_TYPES)];
  return {order,hidden:hidden.length === order.length ? hidden.filter(id=>id!==order[0]) : hidden};
}
export function useAssetTypeSettings() {
  const [settings,setSettings]=useState<AssetTypeSettings>(()=>normalizeAssetTypeSettings(null));
  const [saveError,setSaveError]=useState(false);
  const [ready,setReady]=useState(false);
  useEffect(()=>{
    function load() { try { setSettings(normalizeAssetTypeSettings(JSON.parse(localStorage.getItem(ASSET_TYPE_SETTINGS_KEY) || 'null'))); } catch { setSettings(normalizeAssetTypeSettings(null)); } }
    load();
    setReady(true);
    function onStorage(event: StorageEvent) { if (event.key === null || event.key === ASSET_TYPE_SETTINGS_KEY) load(); }
    window.addEventListener('storage',onStorage);
    window.addEventListener(ASSET_TYPE_SETTINGS_CHANGED,load);
    return ()=>{
      window.removeEventListener('storage',onStorage);
      window.removeEventListener(ASSET_TYPE_SETTINGS_CHANGED,load);
    };
  },[]);
  function save(next: AssetTypeSettings) {
    const value=normalizeAssetTypeSettings(next);
    setSettings(value);
    try {
      localStorage.setItem(ASSET_TYPE_SETTINGS_KEY,JSON.stringify(value));
      setSaveError(false);
      window.dispatchEvent(new Event(ASSET_TYPE_SETTINGS_CHANGED));
    } catch {setSaveError(true);}
  }
  return {settings,save,saveError,ready};
}
export function AssetTypeEditor({items,settings,onChange,saveError}: {
  items:{id:string;label:string}[];settings:AssetTypeSettings;onChange:(next:AssetTypeSettings)=>void;saveError:boolean;
}) {
  const { t } = useI18n();
  const listRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const ordered=settings.order.flatMap(id=>items.filter(item=>item.id===id));
  const shown=ordered.filter(item=>!settings.hidden.includes(item.id)).length;
  function move(id:string,delta:number) {
    const target=ordered[ordered.findIndex(item=>item.id===id)+delta];
    if(target) moveTo(id,target.id);
  }
  function moveTo(id:string,target:string) {
    if(id===target) return;
    const order=[...settings.order];const from=order.indexOf(id);const to=order.indexOf(target);
    if(from<0 || to<0)return;
    order.splice(from,1);order.splice(to,0,id);onChange({...settings,order});
  }
  function targetAt(y:number) {
    const rows=Array.from(listRef.current?.querySelectorAll<HTMLElement>('[data-type-id]') || []);
    return rows.find(row=>{const r=row.getBoundingClientRect();return y>=r.top && y<=r.bottom;})?.dataset.typeId;
  }
  return <Popover onOpenChange={()=>{setDragging(null);setDropTarget(null);}}><PopoverTrigger asChild><Button variant="ghost" aria-label={t('asset.type.manage')}><Icon name="layout" size={16} />{t('asset.type.manage')}</Button></PopoverTrigger>
    <PopoverContent align="end" className={styles.panel}>
      <header className={styles.header}><strong>{t('asset.type.displaySort')}</strong><Button size="sm" variant="ghost" onClick={()=>onChange(normalizeAssetTypeSettings(null))}>{t('asset.type.restore')}</Button></header>
      <p className={styles.hint}>{t('asset.type.hint')}</p>
      <div className={styles.list} ref={listRef}>{ordered.map(item=>{
        const checked=!settings.hidden.includes(item.id);
        return <div className={styles.row} key={item.id} data-type-id={item.id} data-dragging={dragging===item.id} data-drop-target={dragging!==item.id && dropTarget===item.id}>
          <Button variant="ghost" size="icon" className={styles.dragHandle} aria-label={t('asset.type.dragAria', { label: item.label })} title={t('asset.type.dragTitle')} onKeyDown={e=>{if(e.key==='ArrowUp'||e.key==='ArrowDown'){e.preventDefault();move(item.id,e.key==='ArrowUp'?-1:1);}}}
            onPointerDown={e=>{if(e.button!==0)return;e.currentTarget.setPointerCapture(e.pointerId);setDragging(item.id);setDropTarget(item.id);}}
            onPointerMove={e=>{if(dragging===item.id){const target=targetAt(e.clientY);if(target)setDropTarget(target);}}}
            onPointerUp={e=>{if(dragging===item.id){const target=targetAt(e.clientY);if(target)moveTo(item.id,target);}setDragging(null);setDropTarget(null);}}
            onPointerCancel={()=>{setDragging(null);setDropTarget(null);}}
          ><Icon name="grip-vertical" size={14}/></Button>
          <label><Checkbox aria-label={t('asset.type.showAria', { label: item.label })} checked={checked} disabled={checked && shown===1} onCheckedChange={value=>onChange({...settings,hidden:value ? settings.hidden.filter(id=>id!==item.id) : [...settings.hidden,item.id]})} /><span>{item.label}</span></label>
        </div>;
      })}</div>
      {saveError && <p role="status" className={styles.hint}>{t('asset.type.saveLocalFailed')}</p>}
    </PopoverContent>
  </Popover>;
}
