// Adapted from Bezier 319e5eee; original save/inspect lifecycle with capability-gated AI.
import { assetInspectorCopy } from '../i18n/locales/asset-inspector-copy';
import { useEffect, useRef, useState } from 'react';
import type { PersonalAsset } from '@bezier/contracts';
import { assetMetadataYaml, parseAssetMetadataYaml } from '@bezier/contracts';
import { Button, Checkbox, DialogFooter, Input, Textarea } from '@/src/components/ui';
import layout from './SaveAssetDialog.module.css';
import { AssetSpaceField, AssetRatingField } from './AssetMetadataControls';
import { AssetDetailDialog, AssetDetailBody, AssetDetailSection } from './AssetDetailDialog';
import { AssetInspectorViews, type AssetInspectorView } from './AssetInspectorViews';
import { Icon } from './Icon';
import inspector from './AssetAnalysisFields.module.css';
import { AssetTagPicker } from './AssetTagPicker';
import { AssetContentPreview } from './AssetContentPreview';
import { personalAssets } from '../providers/asset-library';
import { usePersonalAssetTags } from './asset-library/personal-asset-tags';
import { registerSaveAssetHandler, type SaveAssetDraft } from '../state/save-asset';
import { usePickerSpaces } from './asset-library/use-picker-spaces';
import { useI18n } from '@/src/i18n';
import styles from './PersonalAssetLibrary.module.css';
import { SavedAssetDialog } from './SavedAssetDialog';
import { useAssetLibraryCapabilities } from './asset-library/use-asset-library-capabilities';

type Pending = {draft: SaveAssetDraft; resolve: (asset: PersonalAsset | null) => void};
type ActiveDialog = { kind: 'save'; request: Pending; id: number } | { kind: 'saved'; asset: PersonalAsset; draft: SaveAssetDraft };
export function SaveAssetDialogHost() {
  const [dialog, setDialog] = useState<ActiveDialog | null>(null);
  // Reserve the slot synchronously, including the saved-details phase and React's next render.
  const active = useRef<ActiveDialog | null>(null);
  const sequence = useRef(0);
  useEffect(() => {
    const unregister = registerSaveAssetHandler(request => {
      if (active.current) { request.resolve(null); return; }
      const next: ActiveDialog = { kind: 'save', request, id: ++sequence.current };
      active.current = next; setDialog(next);
    });
    return () => {
      unregister();
      if (active.current?.kind === 'save') active.current.request.resolve(null);
      active.current = null;
    };
  }, []);
  if (!dialog) return null;
  if (dialog.kind === 'saved') return <SavedAssetDialog asset={dialog.asset} workspaceContext={dialog.draft.workspaceContext} onClose={() => {
    if (active.current !== dialog) return;
    active.current = null; setDialog(null);
  }}/>;
  return <SaveAssetDialog key={dialog.id} draft={dialog.request.draft} onFinish={asset => {
    // A late upload completion must not reopen an unmounted host or settle a newer request.
    if (active.current !== dialog) return;
    const next: ActiveDialog | null = asset && dialog.request.draft.inspectAfterSave
      ? { kind: 'saved', asset, draft: dialog.request.draft } : null;
    active.current = next; setDialog(next);
    dialog.request.resolve(asset);
  }}/>;
}
export function SaveAssetDialog({draft,onFinish}:{draft:SaveAssetDraft;onFinish:(asset:PersonalAsset|null)=>void}) {
  const { t, locale } = useI18n();
  const copy = assetInspectorCopy(locale);
  const context=draft.workspaceContext ?? null;
  const source=draft.projectId ? {...draft.source,projectId:draft.source?.projectId??draft.projectId} : draft.source;
  const {space,setSpace,folders,projectSpaces,projectsReady}=usePickerSpaces(context);
  // Reserve one save identity per mounted draft; retries must not create duplicates.
  const captureId=useRef<string>();
  if(captureId.current===undefined)captureId.current=draft.captureId??crypto.randomUUID();
  const initialized=useRef(false);
  useEffect(()=>{if(!initialized.current&&projectsReady){initialized.current=true;const id=source?.projectId;if(id&&projectSpaces[id])setSpace(projectSpaces[id]);}},[projectsReady,projectSpaces]);
  const [name,setName]=useState(draft.name);
  const [description,setDescription]=useState('');
  const [style,setStyle]=useState('');
  const [usage,setUsage]=useState('');
  const [rating,setRating]=useState(0);
  const [aiFill,setAiFill]=useState(draft.aiFill??true);
  const capabilities=useAssetLibraryCapabilities();
  const allowAiFill=draft.allowAiFill!==false && capabilities.analysis;
  const [yaml,setYaml]=useState<string|null>(null);
  const [view,setView]=useState<AssetInspectorView>('info');
  function changeView(next:AssetInspectorView) {
    if(next===view || busy)return;
    try {
      if(next==='analysis' && yaml===null) setYaml(assetMetadataYaml({name,description,tags,style,usage}));
      else if(view==='analysis' && yaml!==null) {const value=parseAssetMetadataYaml(yaml);setName(value.name);setDescription(value.description);setTags(value.tags);setStyle(value.style||'');setUsage(value.usage||'');setYaml(null);}
      setError('');setView(next);
    } catch(e){setError(e instanceof Error?e.message:copy.yamlInvalid);}
  }
  const availableTags=usePersonalAssetTags(true);
  const [tags,setTags]=useState<string[]>([]);
  const [tagDraft,setTagDraft]=useState('');
  const [busy,setBusy]=useState(false);
  const saving=useRef(false);
  const mounted=useRef(false);
  const readController=useRef<AbortController | null>(null);
  useEffect(()=>{
    mounted.current=true;
    return ()=>{mounted.current=false;readController.current?.abort();};
  },[]);
  const [error,setError]=useState('');
  let yamlError='';
  if(yaml!==null){try{parseAssetMetadataYaml(yaml);}catch(reason){yamlError=reason instanceof Error?reason.message:copy.yamlInvalid;}}
  const mime=draft.mime||'';
  const image=mime.startsWith('image/')||/\.(png|jpe?g|webp|gif|svg)$/i.test(draft.filename);
  const video=mime.startsWith('video/')||/\.(mp4|webm|mov)$/i.test(draft.filename);
  const audio=mime.startsWith('audio/')||/\.(mp3|wav|m4a|ogg)$/i.test(draft.filename);
  const html=/\.html?$/i.test(draft.filename)||mime==='text/html';
  const kind=draft.kind || (image?'image':video?'video':audio?'audio':html?'webpage':'text');
  const hints:Record<string,string>={
    image:t('asset.save.hint.image'),text:t('asset.save.hint.text'),script:t('asset.save.hint.script'),
    slides:t('asset.save.hint.slides'),webpage:t('asset.save.hint.webpage'),motion:t('asset.save.hint.motion'),
    video:t('asset.save.hint.video'),audio:t('asset.save.hint.audio'),file:t('asset.save.hint.file'),folder:t('asset.save.hint.folder'),
  };
  async function save(){
    if(saving.current||!name.trim())return;
    saving.current=true;setBusy(true);setError('');
    try {
      const metadata=yaml===null?{name:name.trim(),description,tags,style,usage}:parseAssetMetadataYaml(yaml);
      let readSignal:AbortSignal|undefined;
      const blob=draft.text!==undefined ? new Blob([draft.text],{type:mime||'text/plain'}) : await (async()=>{
        readController.current=new AbortController();
        readSignal=AbortSignal.any([readController.current.signal,AbortSignal.timeout(30000)]);
        if(draft.readContent)return draft.readContent(readSignal);
        if(!draft.url)throw new Error(t('asset.save.noContent'));
        const response=await fetch(draft.url,{signal:readSignal});
        if(!response.ok)throw new Error(t('asset.save.readFailed'));
        return response.blob();
      })();
      // Content readers may ignore cancellation; late bytes must never start an upload.
      readSignal?.throwIfAborted();
      if(!mounted.current)return;
      const result=await personalAssets.upload(new File([blob],draft.filename.replace(/[\\/]/g,'_'),{type:blob.type||mime}),null,source,space,{...metadata,rating,aiFill:allowAiFill&&aiFill,kind:draft.kind,captureId:captureId.current});
      if(mounted.current)onFinish(result.asset);
    }catch(reason){if(mounted.current)setError(reason instanceof Error?reason.message:t('asset.save.failed'));}
    finally{saving.current=false;if(mounted.current)setBusy(false);}
  }
  const addTag=(value:string)=>{const tag=value.trim();if(tag&&!tags.includes(tag)&&tags.length<30)setTags([...tags,tag.slice(0,80)]);setTagDraft('');};
  return <AssetDetailDialog title={t('asset.save.title')} onClose={()=>{if(!saving.current)onFinish(null);}}>
    <AssetDetailBody className={styles.detailBody}>
      <div className={styles.stage}><AssetContentPreview source={{ name, kind, text: draft.text, url: draft.url, mime: html ? 'text/html' : mime }} /></div>
      <AssetInspectorViews view={view} onViewChange={changeView} navigationDisabled={busy||!!yamlError} info={<>
        <div className={inspector.panelHeading}><span>{copy.assetInfo}</span><div className={layout.aiRow}><Checkbox id="asset-ai-fill" aria-label={t('asset.meta.aiFill')} checked={allowAiFill&&aiFill} disabled={busy||!allowAiFill} onCheckedChange={value=>setAiFill(value===true)}/><label htmlFor="asset-ai-fill" title={!capabilities.analysis ? copy.analysisUnavailable : undefined}>{t('asset.meta.aiFill')}</label></div></div>
        {!capabilities.analysis && <p className={layout.hint}>{copy.analysisUnavailable}</p>}
        <AssetSpaceField value={space} spaces={folders} disabled={busy || !projectsReady} onChange={value=>{initialized.current=true;setSpace(value);}}/>
        <AssetDetailSection title={<label htmlFor="save-asset-name">{t('asset.save.name')}</label>}><Input id="save-asset-name" value={name} maxLength={240} disabled={busy} onChange={e=>setName(e.target.value)}/></AssetDetailSection>
        <AssetDetailSection title={t('asset.save.tags')}><div className={styles.tagList}>{tags.map(tag=><span className={styles.tag} key={tag}><span>{tag}</span><Button variant="ghost" size="xs" aria-label={t('entry.personalAssets.aria.removeTag', { tag })} disabled={busy} onClick={()=>setTags(tags.filter(item=>item!==tag))}><Icon name="close" size={12}/></Button></span>)}<AssetTagPicker tags={tags} availableTags={availableTags} busy={busy} draft={tagDraft} onDraft={setTagDraft} onAdd={addTag} onToggle={tag=>tags.includes(tag)?setTags(tags.filter(item=>item!==tag)):addTag(tag)}/></div></AssetDetailSection>
        <AssetDetailSection title={<label htmlFor="save-asset-description">{t('asset.save.description')}</label>}><Textarea id="save-asset-description" rows={3} value={description} maxLength={4000} disabled={busy} onChange={e=>setDescription(e.target.value)}/></AssetDetailSection>
        <AssetDetailSection title={<label htmlFor="save-asset-style">{t('asset.save.style')}</label>}><Textarea id="save-asset-style" rows={2} value={style} maxLength={4000} disabled={busy} placeholder={hints[kind] || hints.file} onChange={e=>setStyle(e.target.value)}/></AssetDetailSection>
        <AssetDetailSection title={<label htmlFor="save-asset-usage">{t('asset.save.usage')}</label>}><Textarea id="save-asset-usage" rows={2} value={usage} maxLength={4000} disabled={busy} placeholder={t('asset.save.usagePlaceholder')} onChange={e=>setUsage(e.target.value)}/></AssetDetailSection>
        <AssetRatingField value={rating} onChange={setRating} disabled={busy}/>
        {allowAiFill && aiFill && (video || audio || (!image && !html && draft.text===undefined && !/\.(md|txt|json)$/i.test(draft.filename))) && <p className={layout.hint}>{copy.unsupportedAnalysis}</p>}
      </>} yaml={<>
        <div className={inspector.panelHeading}><span>{copy.yaml}</span></div>
        <p className={inspector.hint}>{copy.yamlEditHint}</p>
        <Textarea className={inspector.yaml} aria-label={copy.yamlAria} spellCheck={false} rows={16} value={yaml??''} disabled={busy} onChange={e=>setYaml(e.target.value)}/>
      </>} prompt={kind==='image' ? <>
        <div className={inspector.panelHeading}><span>{copy.creationPrompt}</span></div>
        <div className={inspector.empty}><Icon name="file-text" size={26}/><h3>{copy.promptEmptyTitle}</h3><p>{copy.promptEmptyBody}</p></div>
      </> : undefined} error={(yamlError||error)&&<p className={inspector.error} role="alert">{yamlError||error}</p>}/>
    </AssetDetailBody>
    <DialogFooter className={styles.previewFooter}><div className={styles.previewMeta}><span>{draft.filename}</span></div><div className={styles.previewActions}><Button variant="ghost" disabled={busy} onClick={()=>onFinish(null)}>{t('asset.save.cancel')}</Button><Button variant="primary" disabled={busy||!name.trim()} onClick={()=>void save()}>{busy?t('asset.save.saving'):t('asset.save.submit')}</Button></div></DialogFooter>
  </AssetDetailDialog>;
}
