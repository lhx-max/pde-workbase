// Adapted from upstream 319e5eee: original picker visuals, independent source ports.
import { useEffect, useRef, useState } from 'react';
import { PERSONAL_ASSET_CHANGED_EVENT, type PersonalAsset, type AssetLibraryInfo } from '@bezier/contracts';
import type { CanvasAssetPickerProps, CanvasResourceGridItem, ReferenceImageAsset } from '@bezier/canvas-workbench';
import { Button } from '@/src/components/ui';
import { useT } from '../../i18n';
import { getActiveAssetLibraryAdapter, getAssetLibrarySourceId, type AssetLibraryAdapter } from '../../providers/asset-library';
import { Icon } from '../Icon';
import { FilterChipRail } from '../FilterChipRail';
import { AssetPreviewDialog } from '../AssetContentPreview';
import { AssetDocumentPreview } from '../AssetDocumentPreview';
import { AssetPickerDialog } from './AssetPickerDialog';
import { DesignSystemAssetPicker } from './DesignSystemAssetPicker';
import { SelectableImageMasonry, SelectableTemplateGrid } from './SelectableImageMasonry';
import { renderHomeWorkbenchTabs } from '../home-hero/WorkbenchOverlayShells';
import { pickerKind, pickerMediaUrl, validatePickerSelection, readPickerContent, validatePickerUpload, PICKER_MEDIA_LIMIT, PICKER_TEXT_LIMIT } from './workspace-picker-data';
import uploadStyles from './AssetUploadPanel.module.css';
import './WorkspaceAssetPicker.css';

type PickerProps = Exclude<CanvasAssetPickerProps, { kind: 'design-system' }>;
/** Project identity is supplied by CanvasWorkspace, not inferred from product stores. */
export function renderWorkspaceAssetPicker(props: CanvasAssetPickerProps, projectKey = '') {
  if (!props.open) return null;
  return props.kind === 'design-system' ? <DesignSystemAssetPicker key={projectKey} {...props} />
    : <WorkspaceAssetPicker key={`${projectKey}:${props.kind}:${props.kind === 'artifact' ? props.mode : (props.acceptedKinds ?? ['image']).join(',')}`} {...props} />;
}
type Catalogue = {adapter: AssetLibraryAdapter; sourceId: string; info: AssetLibraryInfo; assets: PersonalAsset[]; folders: {id:string;name:string}[]};
function WorkspaceAssetPicker(props: PickerProps) {
  const t = useT();
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [retry, setRetry] = useState(0);
  const [source, setSource] = useState(() => props.kind === 'media' && !props.libraryOnly ? props.initialSource === 'library' ? 'assets' : props.initialSource ?? 'canvas' : 'assets');
  const [space, setSpace] = useState('all-spaces');
  const [query, setQuery] = useState('');
  const [mediaFilter, setMediaFilter] = useState('all');
  const [selected, setSelected] = useState<string[]>([]);
  const pinned = useRef(new Map<string, PersonalAsset>());
  const [applying, setApplying] = useState(false);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const operation = useRef<AbortController | null>(null);
  const catalogueRequest = useRef<AbortController | null>(null);
  const alive = useRef(true);
  const cancel = () => { operation.current?.abort(); operation.current = null; };
  const close = () => { cancel(); catalogueRequest.current?.abort(); props.onClose(); };
  useEffect(() => { alive.current = true; return () => { alive.current = false; cancel(); }; }, []);
  useEffect(() => {
    let current = true;
    let load: AbortController | null = null;
    let previous = getActiveAssetLibraryAdapter();
    let previousId = getAssetLibrarySourceId();
    const refresh = async () => {
      const adapter = getActiveAssetLibraryAdapter(), sourceId = getAssetLibrarySourceId();
      if (adapter !== previous || sourceId !== previousId) {
        cancel(); setApplying(false); setSelected([]); pinned.current.clear(); setPreviewId(null); setCatalogue(null); setSpace('all-spaces'); setError(''); setLoadError('');
      }
      previous = adapter; previousId = sourceId;
      load?.abort(); const controller = new AbortController(); load = controller; catalogueRequest.current = controller;
      const isCurrent = () => current && !controller.signal.aborted && adapter === getActiveAssetLibraryAdapter() && sourceId === getAssetLibrarySourceId();
      setLoading(true);
      try {
        const info = await adapter.info(controller.signal);
        if (!isCurrent()) return;
        if (info.apiVersion !== 1 || !info.capabilities.list || !info.capabilities.read || !info.capabilities.content || !info.capabilities.versions) throw new Error(t('asset.error.unavailable'));
        const [{assets}, spaces] = await Promise.all([adapter.list(controller.signal), info.capabilities.spaces ? adapter.spaces('local', controller.signal) : Promise.resolve({folders:[]})]);
        if (!isCurrent()) return;
        setCatalogue({adapter, sourceId, info, assets, folders:spaces.folders}); setLoadError('');
      } catch (reason) { if (isCurrent()) { setCatalogue(null); setLoadError(reason instanceof Error ? reason.message : t('assetPicker.loadFailed')); } }
      finally { if (isCurrent()) setLoading(false); }
    };
    void refresh();
    window.addEventListener(PERSONAL_ASSET_CHANGED_EVENT, refresh);
    return () => { current = false; load?.abort(); window.removeEventListener(PERSONAL_ASSET_CHANGED_EVENT, refresh); };
  }, [retry, t]);
  const kinds: readonly string[] = props.kind === 'media' ? props.acceptedKinds ?? ['image'] : [props.mode === 'deck' ? 'slides' : props.mode === 'text' ? 'text' : 'webpage'];
  const multiMedia = props.kind === 'media' && kinds.length > 1;
  const labels: Record<string,string> = {image:t('entry.workspacePicker.kind.image'), video:t('entry.workspacePicker.kind.video'), audio:t('entry.workspacePicker.kind.audio'), slides:t('homeHero.chip.deck'), text:t('homeHero.chip.document'), webpage:t('entry.workspacePicker.kind.webpage')};
  const supportedLabel = kinds.map(kind => labels[kind] || kind).join(', ');
  const active = catalogue && catalogue.adapter === getActiveAssetLibraryAdapter() && catalogue.sourceId === getAssetLibrarySourceId() ? catalogue : null;
  const assets = (active?.assets ?? []).filter(asset => !asset.deletedAt && asset.kind !== 'folder' && asset.versions.length && kinds.includes(pickerKind(asset)) && (space === 'all-spaces' || (asset.spaceId || 'default-project') === space));
  const resources = props.kind === 'media' ? props.resources.filter(resource => kinds.includes(resource.kind ?? 'image')) : [];
  const available = source === 'canvas' ? resources.map(item => item.id) : assets.map(item => item.id);
  const validSelected = selected.filter(id => available.includes(id));
  useEffect(() => {
    if (props.kind !== 'artifact' || !props.selectedId || !active) return;
    const asset = assets.find(item => item.id === props.selectedId || item.source.template?.id === props.selectedId);
    if (asset) { pinned.current.set(asset.id, structuredClone(asset)); setSelected([asset.id]); }
  }, [props.kind === 'artifact' ? props.selectedId : null, Boolean(active)]);
  const changeSource = (next: string) => { cancel(); setApplying(false); setSource(next); setSelected([]); pinned.current.clear(); setPreviewId(null); setError(''); };
  const toggle = (id: string) => {
    if (operation.current) return;
    const asset = assets.find(item => item.id === id);
    if (asset && !selected.includes(id)) pinned.current.set(id, structuredClone(asset));
    setSelected(ids => ids.includes(id) ? ids.filter(value => value !== id) : props.kind === 'artifact' || props.singleSelection ? [id] : [...ids, id]);
    setError('');
  };
  const localizeError = (reason: unknown) => {
    const message = reason instanceof Error ? reason.message : 'entry.workspacePicker.useFailed';
    return /^(assetPicker\.|entry\.workspacePicker\.)/.test(message) ? t(message as Parameters<typeof t>[0], {kinds:supportedLabel}) : message;
  };
  const run = async (work: (signal: AbortSignal, isCurrent: () => boolean) => Promise<void>) => {
    if (operation.current) return;
    // Capture BOTH source identity and port before the first await, including uploads.
    const adapter = getActiveAssetLibraryAdapter(), sourceId = getAssetLibrarySourceId();
    const controller = new AbortController(); operation.current = controller;
    const isCurrent = () => alive.current && operation.current === controller && !controller.signal.aborted && adapter === getActiveAssetLibraryAdapter() && sourceId === getAssetLibrarySourceId();
    setApplying(true); setError('');
    try { await work(controller.signal, isCurrent); if (isCurrent()) close(); }
    catch (reason) { if (isCurrent()) setError(localizeError(reason)); }
    finally { if (operation.current === controller) { operation.current = null; if (alive.current) setApplying(false); } }
  };
  const apply = () => {
    if (!validSelected.length) return;
    const adapter = active?.adapter;
    const records = validSelected.map(id => pinned.current.get(id)).filter((asset): asset is PersonalAsset => Boolean(asset));
    void run(async (signal, isCurrent) => {
      if (props.kind === 'media' && source === 'canvas') { if (isCurrent()) props.onUseCanvas(validSelected); return; }
      if (!adapter || records.length !== validSelected.length) throw new Error('assetPicker.selectionGone');
      const validated = await validatePickerSelection(adapter, records, signal);
      if (!isCurrent()) return;
      if (props.kind === 'artifact') {
        const asset = validated[0]!, version = asset.versions.at(-1)!;
        if (!(version.mime.startsWith('text/') || /json|xml/.test(version.mime))) throw new Error('entry.workspacePicker.templateUnsupported');
        if (version.size > PICKER_TEXT_LIMIT) throw new Error('entry.workspacePicker.templateTooLarge');
        const blob = await readPickerContent(adapter, asset, signal, PICKER_TEXT_LIMIT);
        if (!(blob.type.startsWith('text/') || /json|xml/.test(blob.type))) throw new Error('entry.workspacePicker.templateUnsupported');
        const prompt = await blob.text();
        await validatePickerSelection(adapter, records, signal);
        if (!isCurrent()) return;
        props.onSelect({id:asset.id, title:asset.name, description:asset.description, category:asset.tags[0] ?? '', posterUrl:asset.source.template?.posterSrc ?? '', referencePath:asset.source.template?.referencePath ?? '', prompt, previewSrc:asset.source.template?.previewSrc ?? '', previewVideoUrl:asset.source.template?.previewVideo ?? ''});
      } else {
        const files = await Promise.all(validated.map(async asset => {
          const blob = await readPickerContent(adapter, asset, signal, PICKER_MEDIA_LIMIT, true);
          if (!blob.type.startsWith(`${pickerKind(asset)}/`)) throw new Error('entry.workspacePicker.templateUnsupported');
          const version = asset.versions.at(-1)!;
          const extension = blob.type.split('/')[1]?.replace('jpeg','jpg').replace('svg+xml','svg') || 'bin';
          const filename = version.filename === 'template-prompt.md' ? `${asset.name}.${extension}` : version.filename || `${asset.name}.${extension}`;
          return new File([blob], filename, {type:blob.type});
        }));
        await validatePickerSelection(adapter, records, signal);
        if (!isCurrent()) return;
        const metadata: ReferenceImageAsset[] = validated.map(asset => ({id:asset.id,title:asset.name,business:'',businessLabel:'',styleId:'',styleName:'',posterUrl:pickerMediaUrl(adapter,asset),originalUrl:pickerMediaUrl(adapter,asset)}));
        const accepted = await props.onUseLibrary(files, metadata);
        if (accepted === false) throw new Error('entry.workspacePicker.addFailed');
      }
    });
  };
  const upload = (files: File[]) => {
    if (props.kind !== 'media' || !files.length || operation.current) return;
    try { validatePickerUpload(files, kinds, Boolean(props.singleSelection)); }
    catch (reason) { setError(localizeError(reason)); return; }
    void run(async (_signal, isCurrent) => { if (!isCurrent()) return; if (await props.onUpload(files) === false) throw new Error('entry.workspacePicker.uploadFailed'); });
  };
  const term = query.trim().toLocaleLowerCase();
  const items: CanvasResourceGridItem[] = (source === 'canvas' ? resources.map(resource => ({id:resource.id,name:resource.name,meta:labels[resource.kind ?? 'image'],preview:resource.src,kind:resource.kind ?? 'image',checked:validSelected.includes(resource.id)})) : assets.map(asset => {
    const template = asset.source.template, kind = pickerKind(asset);
    const url = active!.adapter.contentUrl(asset, asset.versions.at(-1)!.id);
    return {id:asset.id,name:asset.name,meta:[labels[kind],...asset.tags].filter(Boolean).join(' · '),checked:validSelected.includes(asset.id),preview:props.kind === 'media' ? pickerMediaUrl(active!.adapter,asset) : template?.posterSrc || undefined,kind:kind === 'video' || kind === 'audio' ? kind : 'image',...(props.kind === 'artifact' && props.mode !== 'text' ? {templatePreview:{type:props.mode,previewSrc:template?.previewSrc || (asset.versions.at(-1)?.mime.includes('html') ? url : undefined),videoUrl:template?.previewVideo || undefined}} : {})} as CanvasResourceGridItem;
  })).filter(item => (!multiMedia || mediaFilter === 'all' || item.kind === mediaFilter) && (!term || `${item.name} ${item.meta}`.toLocaleLowerCase().includes(term)));
  const title = props.kind === 'artifact' ? t('entry.workspacePicker.titleSelectTemplate',{label:props.artifactLabel}) : props.libraryOnly ? t('entry.workspacePicker.titleImageTemplate') : multiMedia ? t('entry.workspacePicker.titleAddClip') : t('entry.workspacePicker.titleSelectAsset');
  const previewAsset = source === 'assets' ? assets.find(asset => asset.id === previewId) : undefined;
  const previewResource = source === 'canvas' ? resources.find(resource => resource.id === previewId) : undefined;
  const preview = previewAsset && active ? {asset:previewAsset,name:previewAsset.name,kind:pickerKind(previewAsset),mime:previewAsset.versions.at(-1)?.mime,url:active.adapter.contentUrl(previewAsset,previewAsset.versions.at(-1)!.id)} : previewResource ? {name:previewResource.name,kind:previewResource.kind ?? 'image',url:previewResource.src} : undefined;
  const Collection = props.kind === 'artifact' || multiMedia ? SelectableTemplateGrid : SelectableImageMasonry;
  return <><AssetPickerDialog title={title} onClose={close} renderDialog={props.renderDialog} query={query} onQueryChange={source === 'upload' ? undefined : setQuery} busy={loading || applying}
    navigation={props.kind === 'media' && !props.libraryOnly ? renderHomeWorkbenchTabs({value:source,onValueChange:changeSource,ariaLabel:t('entry.workspacePicker.sourceAria'),items:[{value:'canvas',label:t('entry.workspacePicker.sourceCanvas')},{value:'assets',label:t('entry.workspacePicker.sourceAssets')},{value:'upload',label:t('entry.workspacePicker.sourceUpload')}]}) : undefined}
    filters={source !== 'upload' ? <div className="wap-filter-stack">{source === 'assets' && <FilterChipRail ariaLabel={t('entry.workspacePicker.spaceAria')} scrollControls value={space} onValueChange={value => {cancel();setApplying(false);setSpace(value);setSelected([]);setPreviewId(null);}} items={[{id:'all-spaces',label:t('entry.workspacePicker.allSpaces')},...(active?.folders ?? []).map(folder=>({id:folder.id,label:folder.name}))]}/>} {multiMedia && <FilterChipRail ariaLabel={t('entry.workspacePicker.mediaTypeAria')} value={mediaFilter} onValueChange={setMediaFilter} items={[{id:'all',label:t('entry.workspacePicker.allTypes')},...kinds.map(kind=>({id:kind,label:labels[kind] || kind}))]}/>}</div> : undefined}
    error={error || (source === 'assets' ? loadError : '')} onRetry={()=>{setError('');setRetry(value=>value+1);}} status={applying ? t('entry.workspacePicker.addingWait') : validSelected.length ? t('entry.workspacePicker.selectedCount',{count:validSelected.length}) : t('entry.workspacePicker.pickToUse')}
    actions={<><Button variant="ghost" onClick={close}>{t('entry.workspacePicker.cancel')}</Button><Button variant="primary" disabled={!validSelected.length || applying || source === 'upload'} onClick={apply}>{t(applying ? 'entry.workspacePicker.adding' : 'entry.workspacePicker.use')}</Button></>}>
    {source === 'upload' && props.kind === 'media' ? <div className={uploadStyles.area}><div className={uploadStyles.content}>
      <div className={uploadStyles.zone} data-drag-over={dragOver || undefined} aria-busy={applying} aria-label={t('entry.workspacePicker.dropAria')}
        onDragOver={event=>{event.preventDefault();event.stopPropagation();if(!applying)setDragOver(true);}} onDragLeave={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node | null))setDragOver(false);}}
        onDrop={event=>{event.preventDefault();event.stopPropagation();setDragOver(false);upload(Array.from(event.dataTransfer.files));}}>
        <span className={uploadStyles.icon} aria-hidden="true"><Icon name="upload" size={22}/></span><div className={uploadStyles.copy}><h3 aria-live="polite">{t(applying ? 'entry.workspacePicker.dropAdding' : dragOver ? 'entry.workspacePicker.dropRelease' : 'entry.workspacePicker.dropIdle')}</h3><p>{t(props.singleSelection ? 'entry.workspacePicker.dropSupport' : 'entry.workspacePicker.dropSupportMulti',{kinds:supportedLabel})}</p></div>
        <Button variant="primary" className={uploadStyles.chooseButton} disabled={applying} onClick={()=>input.current?.click()}>{t('entry.workspacePicker.chooseLocal')}</Button>
        <input ref={input} className={uploadStyles.input} type="file" aria-label={t('entry.workspacePicker.uploadAria')} accept={kinds.map(kind=>`${kind}/*`).join(',')} multiple={!props.singleSelection} disabled={applying} onChange={event=>{const files=Array.from(event.target.files ?? []);event.target.value='';upload(files);}}/>
      </div><p className={uploadStyles.note}><Icon name="folder" size={13}/><span>{t('entry.workspacePicker.uploadNote')}</span></p>
    </div></div> : <Collection showCaptions={multiMedia} items={items} onToggle={toggle} onPreview={setPreviewId} isDisabled={()=>applying} renderCover={item=>{const asset=assets.find(value=>value.id===item.id);return source === 'assets' && asset && pickerKind(asset)==='text' && active ? <AssetDocumentPreview kind="text" url={active.adapter.contentUrl(asset,asset.versions.at(-1)!.id)} compact/> : null;}} emptyState={<div className="wap-empty">{t(loading && source === 'assets' ? 'entry.workspacePicker.readingAssets' : props.kind === 'artifact' ? 'entry.workspacePicker.noTemplates' : 'entry.workspacePicker.noMatch')}</div>}/>}
  </AssetPickerDialog>{preview && <AssetPreviewDialog source={preview} onClose={()=>setPreviewId(null)} actions={<Button variant="primary" disabled={applying} onClick={()=>{if(previewId && !validSelected.includes(previewId))toggle(previewId);setPreviewId(null);}}>{t('entry.workspacePicker.selectThis')}</Button>}/>}</>;
}
