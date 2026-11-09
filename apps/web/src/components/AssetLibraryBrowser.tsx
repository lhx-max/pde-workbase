import {Dialog,DialogHeader,DialogTitle,Button} from './ui';
import {Icon} from './Icon';
import {AssetLibraryPanel,type AssetLibraryPanelProps} from './AssetLibraryPanel';
import {useT} from '../i18n';
import styles from './AssetLibraryBrowser.module.css';
/** Expanded original catalogue: same controls, cards and operations as the sidebar. */
export function AssetLibraryBrowser({onClose,...props}:AssetLibraryPanelProps&{onClose:()=>void}){
 const t=useT();return <Dialog className={styles.dialog} onClose={onClose} closeOnEscape ariaLabel={t('assetLibrary.fullTitle')}>
 <DialogHeader className={styles.header}><DialogTitle>{t('assetLibrary.fullTitle')}</DialogTitle><Button variant="ghost" size="icon" onClick={onClose} aria-label={t('entry.canvasAssets.close')}><Icon name="close" size={17}/></Button></DialogHeader>
 <div className={styles.body}><AssetLibraryPanel {...props} compact={false}/></div>
 </Dialog>;
}
