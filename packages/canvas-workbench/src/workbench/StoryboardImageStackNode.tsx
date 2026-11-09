'use client';
import React from 'react';
import { CanvasPreviewImage } from './CanvasPreviewImage';
import { CanvasNodeRenderBoundary, useCanvasRenderDetail } from './CanvasRenderPolicy';
import type { Node, NodeProps } from '@xyflow/react';
import { Button } from '@bezier/components';
import { projectFileUrl } from '../platform/api-base';
import { ImageAssetNode, type ImageAssetData } from './ImageAssetNode';
import { cr } from '../locales/canvas-remainder';

export type StoryboardImageStackData = {
  name: string;
  versions: Array<{ id: string; path: string }>;
  selectedPath?: string;
  relationState?: 'related' | 'muted';
  onSelect: (path: string) => void;
  editor?: ImageAssetData;
  generating?: boolean;
  generationError?: string;
};

function StoryboardImageStackNodeComponent(props: NodeProps<Node<StoryboardImageStackData>>) {
  return <CanvasNodeRenderBoundary nodeId={props.id} selected={props.selected}><StoryboardImageStackBody {...props} /></CanvasNodeRenderBoundary>;
}

export const StoryboardImageStackNode = React.memo(StoryboardImageStackNodeComponent,
  (previous, next) => previous.id === next.id && previous.data === next.data && previous.selected === next.selected);

function StoryboardImageStackBody(props: NodeProps<Node<StoryboardImageStackData>>) {
  const { detail } = useCanvasRenderDetail();
  const { data, selected } = props;
  const [hovered, setHovered] = React.useState<string>();
  const chosen = data.versions.find(v => v.path === data.selectedPath) || data.versions[0];
  const preview = data.versions.find(v => v.path === hovered) || chosen;
  if (!preview && !data.generating && !data.generationError) return null;
  return <section className={`storyboard-image-stack ${data.relationState ? `is-${data.relationState}` : ''}`} aria-label={cr().imageVersionsOf(data.name)} onPointerLeave={() => setHovered(undefined)}>
    <header className="node-drag-surface"><strong>{data.name}</strong><span>{cr().versionCount(data.versions.length)}</span></header>
    {data.editor ? <div className="storyboard-stack-native" onPointerEnter={() => setHovered(undefined)}>
      <ImageAssetNode {...props} key={data.editor.image.path} data={{ ...data.editor, composerOwnerId: props.id }} selected={selected} />
      {hovered && hovered !== chosen?.path && preview && <CanvasPreviewImage className="storyboard-stack-hover-preview" src={projectFileUrl(preview.path)} alt={cr().historyPreviewOf(data.name)} />}
    </div> : preview ? <Button variant="ghost" className="storyboard-stack-cover nodrag nopan" aria-label={cr().pickImageOf(data.name)} onClick={() => { setHovered(undefined); if (chosen) data.onSelect(chosen.path); }}>
      <CanvasPreviewImage src={projectFileUrl(preview.path)} alt={data.name} draggable={false} />
      <span>{hovered && hovered !== chosen?.path ? cr().preview : cr().inUse}</span>
    </Button> : <div className="storyboard-stack-empty" />}
    {(data.generating || data.generationError) && <div className="storyboard-stack-generation" role="status">{data.generating ? <><span className="basic-output-spinner" />{cr().generatingNewVersion}</> : data.generationError}</div>}
    <div className="storyboard-stack-pages nodrag nopan nowheel" role="group" aria-label={cr().historyVersions} onWheel={e => e.stopPropagation()}>
      {data.versions.map((version, index) => <button key={version.path} type="button" aria-label={cr().useVersionOf(data.name, index)} aria-pressed={version.path === chosen?.path}
        onPointerEnter={() => setHovered(version.path)} onFocus={() => setHovered(version.path)} onBlur={() => setHovered(undefined)}
        onClick={() => { data.onSelect(version.path); setHovered(undefined); }}>
        {detail && <CanvasPreviewImage src={projectFileUrl(version.path)} previewSize={96} alt="" draggable={false} />}<span>{index + 1}</span>
      </button>)}
    </div>
  </section>;
}
