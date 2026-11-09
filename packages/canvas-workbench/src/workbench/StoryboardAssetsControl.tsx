'use client';
import React from 'react';
import { Button, Select } from '@bezier/components';
import type { StoryboardAsset, StoryboardAssetRef } from '@bezier/contracts';
import { Icon } from '../ui/Icon';
import { requireCanvasPopoverRenderer, useCanvasUiHost, useCanvasNodeOverlayPortalContainer } from '../platform/ui-host';
import { projectFileUrl } from '../platform/api-base';
import { CanvasSelectionItem } from './CanvasSelectionItem';
import { resolveStoryboardAsset, type StoryboardAssetLibrary } from './storyboard-assets';
import type { StoryboardShot } from './storyboard-card';
import { StoryboardAssetSettings as AssetEditor } from './StoryboardAssetSettings';
import { sactl } from '../locales/storyboard-assets-control';
import { STORYBOARD_DEFAULT_VARIANT_NAME } from '../locales/storyboard-assets-copy';

export function AssetPopover({ label, trigger, children, initialOpen = false }: { label: string; trigger: React.ReactElement; children: React.ReactNode; initialOpen?: boolean }) {
  const [open, setOpen] = React.useState(initialOpen);
  const render = requireCanvasPopoverRenderer(useCanvasUiHost());
  const portalContainer = useCanvasNodeOverlayPortalContainer();
  return render({ open, onOpenChange: setOpen, trigger, ariaLabel: label, role: 'dialog', side: 'bottom', align: 'start', sideOffset: 8, portalContainer, wrapDomainMenu: false, contentClassName: 'storyboard-assets-popover', children: <>
    <div className="storyboard-assets-popover-inner"><header><strong>{label}</strong><Button variant="ghost" size="icon" aria-label={sactl().close} onClick={() => setOpen(false)}><Icon name="close" /></Button></header>
    {children}
    </div>
  </> });
}

export { StoryboardAssetSettings as AssetEditor } from "./StoryboardAssetSettings";

export function StoryboardAssetManager({ kind, library }: { kind: StoryboardAsset['kind']; library: StoryboardAssetLibrary }) {
  const [activeId, setActiveId] = React.useState<string>();
  const assets = library.assets.filter(a => a.kind === kind);
  const active = assets.find(a => a.id === activeId);
  const label = kind === 'character' ? sactl().character : sactl().scene;
  return <AssetPopover label={sactl().projectKind(label)} trigger={<Button variant="ghost" className="nodrag nopan"><Icon name={kind === 'character' ? 'users' : 'image'} />{label} {assets.length}<Icon name="arrow-down" size={12} /></Button>}>
    <div className="storyboard-assets-list">
      {assets.map(asset => <CanvasSelectionItem key={asset.id} selected={activeId === asset.id} onClick={() => setActiveId(asset.id)}><span>{asset.name || sactl().unnamed}</span></CanvasSelectionItem>)}
      <Button variant="ghost" aria-label={sactl().addKind(label)} onClick={() => { const id = crypto.randomUUID(); library.onSave({ id, kind, name: sactl().newKind(label), description: '', revision: 1, variants: [{ id: 'default', name: STORYBOARD_DEFAULT_VARIANT_NAME, description: '' }] }); setActiveId(id); }}><Icon name="plus" />{sactl().addKind(label)}</Button>
    </div>
    {active ? <AssetEditor key={active.id} asset={active} library={library} /> : <p className="storyboard-assets-hint">{(assets.length ? sactl().selectToEdit(label) : sactl().addOrExtract(label)) + sactl().sharedAcrossStoryboards}</p>}
  </AssetPopover>;
}

export function StoryboardShotAssets({ shot, library, onChange }: { shot: StoryboardShot; library: StoryboardAssetLibrary; onChange: (shot: StoryboardShot) => void }) {
  const refs = [...(shot.characters || []), ...(shot.scene ? [shot.scene] : [])];
  const toggle = (asset: StoryboardAsset) => {
    if (asset.kind === 'scene') onChange({ ...shot, scene: shot.scene?.assetId === asset.id ? undefined : { assetId: asset.id } });
    else onChange({ ...shot, characters: (shot.characters || []).some(r => r.assetId === asset.id) ? shot.characters!.filter(r => r.assetId !== asset.id) : [...(shot.characters || []), { assetId: asset.id }] });
  };
  const changeVariant = (ref: StoryboardAssetRef, variantId: string) => onChange({ ...shot, characters: shot.characters?.map(r => r.assetId === ref.assetId ? { ...r, variantId } : r), ...(shot.scene?.assetId === ref.assetId ? { scene: { ...shot.scene, variantId } } : {}) });
  return <div className="storyboard-shot-reference-strip nodrag nopan">
    {(shot.characters || []).slice(0, 2).concat(shot.scene ? [shot.scene] : []).map(ref => {
      const value = resolveStoryboardAsset(ref, library.assets);
      const scene = value?.asset.kind === 'scene';
      return <Button key={ref.assetId} variant="ghost" className={`storyboard-shot-reference ${scene ? 'is-scene' : 'is-character'}`} aria-label={sactl().viewLinked(value?.asset.name || sactl().missingRef)} title={value?.asset.name || sactl().missingRef} onClick={() => library.onPinRelation?.({ kind: 'asset', id: ref.assetId, variantId: ref.variantId })}>
        {value?.variant?.referencePath ? <img src={projectFileUrl(value.variant.referencePath)} alt="" /> : <Icon name={scene ? 'image' : 'users'} size={14} />}
        <span className="storyboard-reference-preview">{value?.variant?.referencePath && <img src={projectFileUrl(value.variant.referencePath)} alt="" />}{value?.asset.name || sactl().missingRef}</span>
      </Button>;
    })}
    <AssetPopover label={sactl().linkSubjectsScenes} trigger={<Button variant="ghost" className="storyboard-shot-reference-manage nodrag nopan" aria-label={sactl().linkSubjectsScenes} title={sactl().adjustRefs}>
    {(shot.characters?.length || 0) > 2 ? `+${shot.characters!.length - 2}` : refs.length ? '···' : sactl().addReference}
  </Button>}>
    {(['character', 'scene'] as const).map(kind => <section key={kind}><h4>{kind === 'character' ? sactl().subjectsMulti : sactl().sceneSingle}</h4><div className="storyboard-assets-list">
      {library.assets.filter(a => a.kind === kind).map(asset => { const ref = refs.find(r => r.assetId === asset.id); return <div key={asset.id}>
        <CanvasSelectionItem selected={Boolean(ref)} onClick={() => toggle(asset)}>{asset.name}</CanvasSelectionItem>
        {ref && asset.variants.length > 1 ? <Select aria-label={sactl().versionOf(asset.name)} value={ref.variantId || asset.variants[0]?.id} onChange={e => changeVariant(ref, e.target.value)}>{asset.variants.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}</Select> : null}
      </div>; })}
    </div></section>)}
    {!library.assets.length ? <p>{sactl().needGroupFirst}</p> : null}
  </AssetPopover></div>;
}
