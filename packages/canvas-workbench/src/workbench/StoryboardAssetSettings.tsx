'use client';
import { CanvasErrorNotice } from './CanvasErrorNotice';
import React from 'react';
import { storyboardStackStatus } from './storyboard-stack-state';
import { Button, Select } from '@bezier/components';
import type { StoryboardAsset } from '@bezier/contracts';
import { CompositionSafeInput, CompositionSafeTextarea } from './CompositionSafeField';
import { CanvasSegmentedControl } from './CanvasSegmentedControl';
import { requireCanvasMenuRenderer, useCanvasUiHost } from '../platform/ui-host';
import { ImageReferenceResourcePicker } from './ImageReferenceResourcePicker';
import { projectFileUrl } from '../platform/api-base';
import { Icon } from '../ui/Icon';
import { storyboardAssetDescription, storyboardAssetImageRatio, storyboardSceneView, type StoryboardAssetLibrary } from './storyboard-assets';
import { sas } from '../locales/storyboard-asset-settings';

export function StoryboardAssetSettings({ asset, library }: { asset: StoryboardAsset; library: StoryboardAssetLibrary }) {
  const variant = asset.variants.find(v => v.id === asset.activeVariantId) || asset.variants[0]!;
  const [picker, setPicker] = React.useState(false);
  const [uploadMode, setUploadMode] = React.useState<'reference' | 'result'>('reference');
  const [error, setError] = React.useState('');
  const [uploading, setUploading] = React.useState(false);
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const renderMenu = requireCanvasMenuRenderer(useCanvasUiHost());
  const fileRef = React.useRef<HTMLInputElement>(null);
  const saveVariant = (patch: Partial<typeof variant>) => library.onSave({ ...asset, revision: asset.revision + 1, variants: asset.variants.map(v => v.id === variant.id ? { ...v, ...patch } : v) });
  const usePaths = (paths: string[]) => {
    if (!paths.length) return;
    if (uploadMode === 'result') {
      const history = [...(variant.history || [])];
      if (variant.referencePath && !history.some(h => h.path === variant.referencePath)) history.push({ id: crypto.randomUUID(), path: variant.referencePath });
      paths.forEach(path => { if (!history.some(h => h.path === path)) history.push({ id: crypto.randomUUID(), path }); });
      saveVariant({ referencePath: paths[0], referenceNodeId: undefined, generationNodeId: undefined, history });
    } else saveVariant({ inputReferences: [...new Set([...(variant.inputReferences || []), ...paths])] });
  };
  const upload = async (files: readonly File[]) => {
    if (!files.length || uploading) return false;
    setUploading(true); setError('');
    try {
      if (!library.onUpload) throw new Error(sas().uploadUnsupported);
      if (files.some(file => !file.type.startsWith('image/'))) throw new Error(sas().pickImage);
      const uploaded = await Promise.all(files.map(file => library.onUpload!(file)));
      usePaths(uploaded.map(file => file.path));
      return true;
    } catch (cause) { setError(cause instanceof Error ? cause.message : sas().uploadFailed); return false; }
    finally { setUploading(false); }
  };
  const history = variant.history || [];
  const pending = Boolean(variant.generationNodeId && library.images.some(i => i.sourceInstanceId === variant.generationNodeId && i.status === 'generating'));
  return <div className="storyboard-asset-editor storyboard-asset-settings">
    <div className="storyboard-asset-setting-row storyboard-asset-identity"><span className="storyboard-asset-identity-thumbnail">{variant.referencePath ? <img src={projectFileUrl(variant.referencePath)} alt="" /> : <Icon name={asset.kind === 'character' ? 'users' : 'image'} size={20} />}</span><CompositionSafeInput aria-label={asset.kind === 'character' ? sas().characterName : sas().sceneName} value={asset.name} onValueChange={name => library.onSave({ ...asset, name, revision: asset.revision + 1 })} />
      {asset.variants.length > 1 && <Select aria-label={sas().settingVersion} value={variant.id} onChange={e => library.onSave({ ...asset, activeVariantId: e.target.value })}>{asset.variants.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}</Select>}
      {history.length > 0 && renderMenu({ open: historyOpen, onOpenChange: setHistoryOpen, ariaLabel: sas().historyVersions, trigger: <Button variant="ghost" disabled={pending || uploading}>{sas().historyVersions}<Icon name="arrow-down" size={12} /></Button>, selectedValue: variant.referencePath || '', onSelectedValueChange: path => saveVariant({ referencePath: path, referenceNodeId: undefined, generationNodeId: undefined }), items: history.map((h, i) => ({ id: h.id, value: h.path, content: sas().imageVersion(i) })) })}
    </div>
    <CompositionSafeTextarea aria-label={sas().description} rows={4} value={storyboardAssetDescription(asset, variant.id)} onValueChange={descriptionOverride => saveVariant({ descriptionOverride })} placeholder={asset.kind === 'character' ? sas().characterDescPlaceholder : sas().sceneDescPlaceholder} />
    {asset.kind === 'scene' && <div className="storyboard-asset-scene-view"><span>{sas().sceneView}</span><CanvasSegmentedControl label={sas().sceneView} value={storyboardSceneView(variant)} options={[{ id: 'default', label: sas().viewDefault }, { id: 'wide', label: sas().viewWide }, { id: 'multi', label: sas().viewMulti }, { id: 'top', label: sas().viewTop }, { id: 'detail', label: sas().viewDetail }]} onChange={sceneView => saveVariant({ sceneView: sceneView as typeof variant.sceneView })} /></div>}
    <div className="storyboard-asset-options">
      {asset.kind === 'character' ? <div><span>{sas().subjectView}</span><CanvasSegmentedControl label={sas().subjectView} value={variant.view ?? 'three'} options={[{ id: 'default', label: sas().viewDefault }, { id: 'three', label: sas().threeView }, { id: 'front', label: sas().frontView }, { id: 'detail', label: sas().closeUp }]} onChange={view => saveVariant({ view: view as typeof variant.view })} /></div> : <div><span>{sas().timeOfDay}</span><CanvasSegmentedControl label={sas().timeOfDay} value={variant.timeOfDay || 'default'} options={[{ id: 'default', label: sas().viewDefault }, { id: 'day', label: sas().day }, { id: 'dusk', label: sas().dusk }, { id: 'night', label: sas().night }]} onChange={timeOfDay => saveVariant({ timeOfDay: timeOfDay as typeof variant.timeOfDay })} /></div>}
      <div><span>{sas().count}</span><CanvasSegmentedControl label={sas().generateCount} value={String(variant.imageCount || 1)} options={[{ id: '1', label: sas().count1 }, { id: '2', label: sas().count2 }, { id: '4', label: sas().count4 }]} onChange={value => saveVariant({ imageCount: Number(value) as 1 | 2 | 4 })} /></div>
    </div>
    <div className="storyboard-asset-scene-view"><span>{sas().imageRatio}</span><CanvasSegmentedControl label={sas().imageRatio} value={storyboardAssetImageRatio(asset, variant.id)} options={(['16:9', '9:16', '1:1', '4:3', '3:4'] as const).map(id => ({ id, label: id }))} onChange={imageRatio => saveVariant({ imageRatio })} /></div>
    <div className="storyboard-asset-media-actions"><Button variant="ghost" disabled={uploading} onClick={() => { setUploadMode('reference'); setPicker(true); }}><Icon name="plus" size={14} />{sas().referenceImage}</Button><Button variant="ghost" disabled={uploading} onClick={() => { setUploadMode('result'); fileRef.current?.click(); }}><Icon name="image" size={14} />{sas().uploadDirect}</Button><StoryboardAssetGenerateButton asset={asset} library={library} /></div>
    <div className="storyboard-asset-reference-strip">{(variant.inputReferences || []).map(path => <div key={path}><img src={projectFileUrl(path)} alt={sas().genReferenceAlt} /><Button variant="ghost" size="icon" aria-label={sas().removeReference} onClick={() => saveVariant({ inputReferences: variant.inputReferences!.filter(p => p !== path) })}><Icon name="close" /></Button></div>)}</div>
    <input ref={fileRef} type="file" accept="image/*" hidden multiple onChange={event => { const files = [...(event.target.files || [])]; event.target.value = ''; void upload(files); }} />
    {uploading && <small role="status">{sas().savingImage}</small>}{error && <CanvasErrorNotice error={error} />}
    {picker && <ImageReferenceResourcePicker open resources={library.images.filter(i => i.path && i.status !== 'generating' && i.status !== 'failed').map(i => ({ id: i.id, name: i.name || sas().image, path: i.path, src: i.src, kind: 'image' }))} onClose={() => setPicker(false)} onUseCanvas={ids => { usePaths(library.images.filter(i => ids.includes(i.id) && i.path).map(i => i.path!)); setPicker(false); }} onUseLibrary={files => upload(files)} onUpload={files => upload(Array.from(files || []))} />}
  </div>;
}

export function StoryboardAssetGenerateButton({ asset, library }: { asset: StoryboardAsset; library: StoryboardAssetLibrary }) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const variant = asset.variants.find(v => v.id === asset.activeVariantId) || asset.variants[0]!;
  const feedback = variant.generationNodeId ? library.feedback?.[variant.generationNodeId] : undefined;
  const status = storyboardStackStatus(library.images.filter(i => Boolean(variant.generationNodeId) && i.sourceInstanceId === variant.generationNodeId), feedback);
  return <><Button variant="primary" aria-label={busy || status.generating ? sas().generating : sas().generate} aria-busy={busy || status.generating} disabled={busy || status.generating || !storyboardAssetDescription(asset, variant.id).trim()} onClick={async () => {
    setBusy(true); setError('');
    try { await library.onGenerate(asset, variant.id); } catch (cause) { setError(cause instanceof Error ? cause.message : sas().generateFailed); } finally { setBusy(false); }
  }}>{busy || status.generating ? <><span className="basic-output-spinner" aria-hidden="true" />{sas().generating}</> : <><Icon name="image" size={14} />{sas().generate}</>}</Button>{!busy && !status.generating && (error || status.generationError) && <small role="status" title={error || status.generationError} className="storyboard-asset-action-error">{error || status.generationError}</small>}</>;
}
