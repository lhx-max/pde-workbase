import {useEffect,useState} from 'react';
import type {ChatAttachment,WorkspaceCollabContext} from '@bezier/contracts';
import {Button,Popover,PopoverTrigger,PopoverContent} from './ui';
import {Icon} from './Icon';
import {AssetPreviewDialog} from './AssetContentPreview';
import {projectFileUrl} from '../providers/registry';
import {useT} from '../i18n';
import styles from './WorkspaceReferenceTray.module.css';
/** Original ChatComposer.StagedRunContexts attachment chips (upstream 319e5eee),
 * extracted without chat/MCP/account state. The popover is only a host placement;
 * accepting or previewing references never executes an agent task. */
export function WorkspaceReferenceTray({projectId,workspaceContext,references,onRemove,onClear}:{projectId:string;workspaceContext?:WorkspaceCollabContext|null;references:ChatAttachment[];onRemove:(path:string)=>void;onClear:()=>void}){
 const t=useT();const [preview,setPreview]=useState<ChatAttachment|null>(null);
 useEffect(()=>{if(preview&&!references.some(item=>item.path===preview.path))setPreview(null);},[preview,references]);
 if(!references.length)return null;
 return <><Popover><PopoverTrigger asChild><Button variant="ghost" aria-label={t('assetLibrary.stagedReferences',{count:references.length})}><Icon name="image" size={14}/>{references.length}</Button></PopoverTrigger><PopoverContent align="end"><strong>{t('assetLibrary.stagedReferences',{count:references.length})}</strong>
 <div className={`${styles['staged-row']} ${styles['staged-context-row']}`} data-testid="staged-contexts">{references.map((a,index)=>{const canPreview=a.kind==='image';const imageUrl=canPreview?projectFileUrl(projectId,a.path,workspaceContext):null;return <div key={a.path} className={`${styles['staged-chip']} ${canPreview&&imageUrl?styles['staged-chip--image-file']:''}`}>
 <span className={styles['staged-order']}>{index+1}</span>
 {canPreview&&imageUrl?<Button type="button" className={styles['staged-preview-trigger']} onClick={()=>setPreview(a)} title={a.name} aria-label={t('chat.previewAttachmentAria',{name:a.name})}><img src={imageUrl} alt="" aria-hidden/></Button>:<><span className={styles['staged-icon']} aria-hidden><Icon name="file" size={13}/></span><Button variant="ghost" className={styles['staged-name']} title={a.path} aria-label={t('chat.previewAttachmentAria',{name:a.name})} onClick={()=>setPreview(a)}>{a.name}</Button></>}
 <Button type="button" className={`${styles['staged-remove']} bezier-tooltip`} onClick={()=>onRemove(a.path)} title={t('common.delete')} data-tooltip={t('common.delete')} aria-label={t('assetLibrary.removeReference',{name:a.name})}><Icon name="close" size={11}/></Button></div>;})}</div>
 <Button variant="ghost" onClick={onClear}>{t('assetLibrary.clearReferences')}</Button></PopoverContent></Popover>
 {preview?<AssetPreviewDialog source={{name:preview.name,kind:preview.kind==='image'?'image':'file',url:projectFileUrl(projectId,preview.path,workspaceContext)}} onClose={()=>setPreview(null)}/>:null}</>;
}
