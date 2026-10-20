'use client';

import { Button } from '@bezier/components';
import { useState } from 'react';
import type { Node, NodeProps } from '@xyflow/react';
import { CanvasGroupFrame } from './CanvasGroupFrame';
import { CanvasNodeActions } from './CanvasNodeActions';
import { CanvasGroupName } from './CanvasGroupName';
import { Icon } from '../ui/Icon';
import type { OrganizationGroup } from './canvas-organization-groups';
import { CanvasNodeSourceHandle } from './CanvasNodeSourceHandle';
import type { CanvasNodeCreationKind } from './canvas-node-catalog';
import { cr } from '../locales/canvas-remainder';

export type OrganizationGroupData = {
  group: OrganizationGroup;
  count: number;
  onRename: (name: string) => void;
  onDissolve: () => string | void;
  onAddNode: (kind: CanvasNodeCreationKind) => string | void;
  referenceReady: boolean;
};

export function OrganizationGroupNode({ data, selected }: NodeProps<Node<OrganizationGroupData>>) {
  const [error, setError] = useState('');
  return <CanvasGroupFrame selected={selected}>
    <CanvasNodeSourceHandle level="group" onAddNode={kind => setError(data.onAddNode(kind) || '')} excludedKinds={['video', 'storyboard', 'text']} />
    {error && <div role="alert" className="image-group-operation-error">{error}</div>}
    <div className="image-group-chrome nopan">
      <div className="image-group-anchor">
        <div className="image-group-label node-drag-surface" title={cr().dragWholeGroup}>
          <Icon name="layers" size={16} />
          <span>{data.group.name} · {cr().itemCount(data.count)}</span>
        </div>
        <CanvasNodeActions>
          <CanvasGroupName name={data.group.name} onRename={data.onRename} />
          <Button variant="ghost" onClick={() => setError(data.onDissolve() || '')}>{cr().ungroup}</Button>
        </CanvasNodeActions>
      </div>
    </div>
  </CanvasGroupFrame>;
}
