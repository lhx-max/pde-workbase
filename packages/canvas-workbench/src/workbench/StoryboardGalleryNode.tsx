import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import type { StoryboardGallery } from './storyboard-gallery';
import { CanvasGroupFrame } from './CanvasGroupFrame';
import { Icon } from '../ui/Icon';
import { cr } from '../locales/canvas-remainder';

export function StoryboardGalleryNode({ data, selected }: NodeProps<Node<StoryboardGallery>>) {
  return <CanvasGroupFrame selected={selected} className="storyboard-gallery-frame" data-storyboard-scope={data.storyboardId} data-storyboard-gallery-kind={data.kind}>
    {data.kind !== 'shot' && <>
      <Handle id="relation-left" type="source" position={Position.Left} isConnectable={false} className="storyboard-gallery-relation-handle" />
      <Handle id="relation-right" type="source" position={Position.Right} isConnectable={false} className="storyboard-gallery-relation-handle" />
    </>}
    <div className="image-group-chrome"><div className="image-group-label node-drag-surface" title={cr().dragWholeGroup}><Icon name="layers" size={16} /><span>{data.title} · {cr().memberCount(data.members.filter(m => !m.id.startsWith('storyboard-assets:')).length)}</span></div></div>
  </CanvasGroupFrame>;
}
