'use client';
import React from 'react';
import { CanvasPreviewImage } from './CanvasPreviewImage';
import { Button } from '@bezier/components';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import type { StoryboardAsset } from '@bezier/contracts';
import { Icon } from '../ui/Icon';
import { projectFileUrl } from '../platform/api-base';
import { CanvasHostedDialog } from '../platform/ui-host';
import { AssetEditor, AssetPopover } from './StoryboardAssetsControl';
import { StoryboardAssetGenerateButton } from './StoryboardAssetSettings';
import { CanvasSelectionItem } from './CanvasSelectionItem';
import type { StoryboardAssetLibrary } from './storyboard-assets';
import type { StoryboardShot } from './storyboard-card';
import { relatedStoryboardShots, storyboardRelationAssetIds, shotAssetRefs } from './storyboard-relations';
import { sag } from '../locales/storyboard-asset-group';
import { STORYBOARD_DEFAULT_VARIANT_NAME } from '../locales/storyboard-assets-copy';

export type StoryboardAssetGroupData = {
  kind: StoryboardAsset['kind']; library: StoryboardAssetLibrary; shots: StoryboardShot[];
};
export const storyboardGroupId = (id: string, kind: string) => `storyboard-assets:${id}:${kind}`;

function AssetRelationsEditor({ asset, shots, library }: { asset: StoryboardAsset; shots: StoryboardShot[]; library: StoryboardAssetLibrary }) {
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const label = asset.kind === 'character' ? sag().character : sag().scene;
  return <div className="storyboard-asset-relations-editor">
    <div className="storyboard-asset-shot-options">
      {shots.map((shot, index) => {
        const linked = asset.kind === 'scene' ? shot.scene?.assetId === asset.id : Boolean(shot.characters?.some(ref => ref.assetId === asset.id));
        const otherScene = asset.kind === 'scene' && shot.scene?.assetId !== asset.id ? library.assets.find(a => a.id === shot.scene?.assetId) : undefined;
        return <CanvasSelectionItem key={shot.id} selected={linked} aria-label={sag().linkedShot(index)} onClick={() => library.onSetShotAssociation?.(asset.id, shot.id, !linked)}>
          <span>{String(index + 1).padStart(2, '0')}</span><span>{shot.description || sag().noDescription}{otherScene && <small>{sag().replaceScene(otherScene.name)}</small>}</span><Icon name={linked ? 'check' : 'plus'} size={14} />
        </CanvasSelectionItem>;
      })}
      {!shots.length && <span>{sag().noShots}</span>}
    </div>
    {library.onRemove && <div className="storyboard-asset-delete-row">{confirmDelete ? <><span>{sag().removeHint(label)}</span><Button variant="ghost" onClick={() => setConfirmDelete(false)}>{sag().cancel}</Button><Button variant="ghost" onClick={() => library.onRemove?.(asset.id)}>{sag().confirmRemove}</Button></> : <Button variant="ghost" onClick={() => setConfirmDelete(true)}><Icon name="trash" size={14} />{sag().removeKind(label)}</Button>}</div>}
  </div>;
}

function StoryboardAssetGroupNodeComponent({ data, selected }: NodeProps<Node<StoryboardAssetGroupData>>) {
  const { kind, library, shots } = data;
  const label = kind === 'character' ? sag().character : sag().scene;
  const assets = library.assets.filter(a => a.kind === kind);
  const [preview, setPreview] = React.useState<{ path: string; name: string }>();
  const relatedIds = storyboardRelationAssetIds(shots, library.assets, library.relation);
  const relatedShots = relatedStoryboardShots(shots, library.assets, library.relation);
  return <section className={`storyboard-asset-group ${selected ? 'is-selected' : ''}`} aria-label={sag().kindGroup(label)} data-storyboard-scope={library.storyboardId} data-relation-active={Boolean(library.relation)}>
    <Handle type="source" position={Position.Right} isConnectable={false} style={{ visibility: 'hidden', pointerEvents: 'none' }} />
    <Handle id="relation-left" type="source" position={Position.Left} isConnectable={false} style={{ opacity: 0, pointerEvents: 'none' }} />
    <header className="node-drag-surface"><Icon name={kind === 'character' ? 'users' : 'image'} /><strong>{label}</strong><span>{assets.length}</span>
      <Button variant="default" className="nodrag nopan" onClick={() => library.onSave({ id: crypto.randomUUID(), kind, name: sag().newKind(label), description: '', revision: 1, variants: [{ id: 'default', name: STORYBOARD_DEFAULT_VARIANT_NAME, description: '' }] })}><Icon name="plus" />{sag().addKind(label)}</Button>
    </header>
    <div className="storyboard-asset-group-grid">
      {assets.map(asset => {
        const uses = shots.filter(s => s.scene?.assetId === asset.id || s.characters?.some(r => r.assetId === asset.id));
        return <article key={asset.id} className="storyboard-asset-tile" data-asset-id={asset.id} data-related={relatedIds.includes(asset.id)}
          tabIndex={0} aria-label={sag().viewLinkedOf(asset.name)}
          onClick={event => { if (!(event.target as HTMLElement).closest('button, input, textarea, select, [role="dialog"]')) library.onPinRelation?.({ kind: 'asset', id: asset.id }); }}
          onKeyDown={event => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); library.onPinRelation?.({ kind: 'asset', id: asset.id }); } }}
          onPointerEnter={event => { if (event.pointerType !== 'touch') library.onHoverRelation?.({ kind: 'asset', id: asset.id }); }} onPointerLeave={() => library.onHoverRelation?.()}
          onFocusCapture={() => library.onHoverRelation?.({ kind: 'asset', id: asset.id })} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget as globalThis.Node | null)) library.onHoverRelation?.(); }}>
          <div className="storyboard-asset-tile-images nodrag nopan">{asset.variants.map(variant => <CanvasSelectionItem key={variant.id}
            data-variant-related={library.relation?.kind === 'shot' && relatedShots.some(s => shotAssetRefs(s).some(r => r.assetId === asset.id && (r.variantId || asset.variants[0]?.id) === variant.id))}
            selected={library.pinnedRelation?.kind === 'asset' ? library.pinnedRelation.id === asset.id && (!library.pinnedRelation.variantId || library.pinnedRelation.variantId === variant.id) : library.focusedAssetId === asset.id}
            onClick={() => variant.referencePath ? setPreview({ path: variant.referencePath, name: `${asset.name} · ${variant.name}` }) : library.onPinRelation ? library.onPinRelation({ kind: 'asset', id: asset.id, variantId: variant.id }) : library.onFocusAsset?.(library.focusedAssetId === asset.id ? undefined : asset.id)}
            title={`${asset.name} · ${variant.name}`} aria-label={variant.referencePath ? sag().cardAriaWithImage(asset.name, variant.name) : sag().cardAriaNoImage(asset.name, variant.name)}>
            {variant.referencePath ? <CanvasPreviewImage src={projectFileUrl(variant.referencePath)} previewSize={96} alt={`${asset.name} · ${variant.name}`} /> : <Icon name={kind === 'character' ? 'users' : 'image'} size={32} />}
            <span>{variant.name}</span>
          </CanvasSelectionItem>)}</div>
          <strong className="storyboard-asset-relation-trigger" title={asset.name}>{asset.name}</strong>
          <AssetPopover label={sag().linkedShotsOf(asset.name)} trigger={<Button variant="ghost" className="storyboard-asset-uses-trigger nodrag nopan" aria-label={sag().adjustLinkedOf(asset.name)}>{uses.length ? sag().linkedCount(uses.length) : sag().linkedShots}<Icon name="arrow-down" size={12} /></Button>}><AssetRelationsEditor asset={asset} shots={shots} library={library} /></AssetPopover>
          <div className="storyboard-asset-tile-actions nodrag nopan"><AssetPopover label={sag().kindSettings(label)} trigger={<Button variant="default">{sag().settings}</Button>}><AssetEditor asset={asset} library={library} /></AssetPopover><StoryboardAssetGenerateButton asset={asset} library={library} /></div>
        </article>;
      })}
      {!assets.length ? <p>{sag().emptyHint(label)}</p> : null}
    </div>
    <CanvasHostedDialog surface="resource" open={Boolean(preview)} onOpenChange={open => { if (!open) setPreview(undefined); }} ariaLabel={sag().imageDetails} className="storyboard-asset-preview">
      {preview && <><header><div><span>{sag().kindReference(label)}</span><strong>{preview.name}</strong></div><Button variant="ghost" size="icon" aria-label={sag().closeImageDetails} onClick={() => setPreview(undefined)}><Icon name="close" /></Button></header><div className="storyboard-asset-preview-stage"><img src={projectFileUrl(preview.path)} alt={preview.name} /></div></>}
    </CanvasHostedDialog>
  </section>;
}

export const StoryboardAssetGroupNode = React.memo(StoryboardAssetGroupNodeComponent,
  (previous, next) => previous.data === next.data && previous.selected === next.selected);
