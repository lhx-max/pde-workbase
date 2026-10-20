'use client';
import { defaultVisualModel, isVisualModelEnabled } from './visual-model-routing';
import { useCanvasImageModels } from '../platform/media-catalog';
import { ign } from '../locales/image-group-node';

import React from 'react';
import { CanvasGroupFrame } from './CanvasGroupFrame';
import { CanvasGroupName } from './CanvasGroupName';
import { Button } from '@bezier/components';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { getImageDisplaySize, type ContinueGenerateParams, type WorkbenchImage } from './ImageAssetNode';
import { setImageGroupHot, scheduleClearImageGroupHot, subscribeImageGroupHot, getImageGroupHot } from './imageGroupHot';
import { CanvasSelectionItem } from './CanvasSelectionItem';
import { CanvasNodeActions } from './CanvasNodeActions';
import { CompositionSafeTextarea } from './CompositionSafeField';

export type ImageGroup = {
  name?: string;
  id: string;
  memberIds: string[];
  x: number;
  y: number;
  width: number;
  height: number;
  visualInstanceId?: string;
  /** New user groups preserve their layout; legacy auto-layout groups remain compatible. */
  layoutMode?: 'free';
};

export type ImageGroupData = {
  onRename?: (groupId: string, name: string) => void;
  group: ImageGroup;
  members: WorkbenchImage[];
  memberCount: number;
  onGenerate: (groupId: string, params: ContinueGenerateParams) => string | void;
  onUngroup: (groupId: string) => string | void;
  /** 复制整组：组 + 组内每张图都建副本。 */
  onDuplicate: (groupId: string) => void;
  /** 删除整组，连组内图片一起（区别于「解散」——那个只拆框、留图）。 */
  onRemove: (groupId: string) => void;
};

/** 虚线框到组内图片的四向留白 */
export const GROUP_PAD = 16;
export const GROUP_GAP = 16;

function useImageGroupHot(groupId: string) {
  const [hot, setHot] = React.useState(getImageGroupHot() === groupId);
  React.useEffect(() => {
    return subscribeImageGroupHot((id) => setHot(id === groupId));
  }, [groupId]);
  return hot;
}

export function layoutGroupMembers(members: WorkbenchImage[]) {
  const sizes = members.map(item => getImageDisplaySize(item.naturalWidth, item.naturalHeight));
  const maxH = Math.max(120, ...sizes.map(item => item.height));
  let cursorX = GROUP_PAD;
  // 顶对齐，避免矮图垂直居中导致「顶部空隙看起来更宽」
  const placements = members.map((member, index) => {
    const size = sizes[index] ?? getImageDisplaySize(member.naturalWidth, member.naturalHeight);
    const placement = {
      id: member.id,
      x: cursorX,
      y: GROUP_PAD,
      width: size.width,
      height: size.height,
    };
    cursorX += size.width + GROUP_GAP;
    return placement;
  });
  const width = Math.max(220, cursorX - GROUP_GAP + GROUP_PAD);
  const height = GROUP_PAD * 2 + maxH;
  return { placements, width, height };
}

function GroupIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <rect x="3" y="3" width="6.5" height="6.5" rx="1.4" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <rect x="10.5" y="3" width="6.5" height="6.5" rx="1.4" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <rect x="3" y="10.5" width="6.5" height="6.5" rx="1.4" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <rect x="10.5" y="10.5" width="6.5" height="6.5" rx="1.4" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function GenIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M11 2.5 12.3 6l3.5 1.3-3.5 1.3L11 12l-1.3-3.4L6.2 7.3 9.7 6 11 2.5Z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M5 12.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8.8-2Z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  );
}

function UngroupIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M4 7V4.8A1.8 1.8 0 0 1 5.8 3H8M12 3h2.2A1.8 1.8 0 0 1 16 4.8V7M16 13v2.2a1.8 1.8 0 0 1-1.8 1.8H12M8 17H5.8A1.8 1.8 0 0 1 4 15.2V13" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function ImageGroupNode({ data, selected }: NodeProps<Node<ImageGroupData>>) {
  const { group, members, memberCount, onGenerate, onUngroup, onDuplicate, onRemove } = data;
  const sharedHot = useImageGroupHot(group.id);
  const [genOpen, setGenOpen] = React.useState(false);
  const [operationError, setOperationError] = React.useState('');
  const [genModels, setGenModels] = React.useState<string[]>([defaultVisualModel()]);
  const modelOptions = useCanvasImageModels();
  const [genCount, setGenCount] = React.useState(1);
  const [genRatios, setGenRatios] = React.useState<string[]>([members[0]?.ratio || '9:16']);
  const [genResolution, setGenResolution] = React.useState('2K');
  const [genPrompt, setGenPrompt] = React.useState('');

  function markHot() {
    setImageGroupHot(group.id);
  }

  function scheduleCold() {
    scheduleClearImageGroupHot();
  }

  const open = selected || sharedHot;
  const estimate = Math.max(1, genModels.length) * genCount * Math.max(1, genRatios.length);

  function toggleValue(value: string, values: string[], setValues: React.Dispatch<React.SetStateAction<string[]>>) {
    setValues(values.includes(value) ? (values.length > 1 ? values.filter(item => item !== value) : values) : [...values, value]);
  }

  function submitGenerate() {
    if (!memberCount) return;
    const error = onGenerate(group.id, {
      models: genModels,
      count: genCount,
      ratios: genRatios,
      resolution: genResolution,
      prompt: genPrompt.trim(),
    });
    setOperationError(error || '');
    if (error) return;
    setGenOpen(false);
    setGenPrompt('');
  }

  return (
    <CanvasGroupFrame
      selected={selected}
      className={`image-group-drag-handle ${open ? 'is-hot' : ''}`}
      onPointerEnter={markHot}
      onPointerLeave={scheduleCold}
    >
      <Handle type="target" position={Position.Left} className="node-handle" />
      <Handle type="source" position={Position.Right} className="node-handle" />

      {/* 标签与工具栏同排；工具栏在标签右侧按 20px 间距展开。 */}
      <div
        className="image-group-chrome nopan"
        onPointerEnter={markHot}
        onPointerLeave={scheduleCold}
      >
        <div className="image-group-anchor">
          <div className="image-group-label image-group-drag-handle node-drag-surface" title={ign().dragGroup}>
            <GroupIcon />
            <span>{group.name || ign().defaultName} · {ign().countSuffix(memberCount)}</span>
          </div>
          <CanvasNodeActions
            onDuplicate={() => onDuplicate(group.id)}
            onRemove={() => onRemove(group.id)}
            duplicateLabel={ign().duplicate}
            removeLabel={ign().remove}
          >
            {data.onRename && <CanvasGroupName name={group.name || ign().defaultName} onRename={name => data.onRename?.(group.id, name)} />}
            <Button variant="ghost" size="icon" disabled={!memberCount} className={genOpen ? 'is-active' : ''} data-tip={ign().generate} aria-label={ign().generate} onClick={() => setGenOpen(value => !value)}>
              <GenIcon />
            </Button>
            <span className="image-capsule-divider" />
            <Button variant="ghost" size="icon" data-tip={ign().ungroup} aria-label={ign().ungroup} onClick={() => setOperationError(onUngroup(group.id) || '')}>
              <UngroupIcon />
            </Button>
          </CanvasNodeActions>
        </div>
      </div>
      {operationError && <div role="alert" className="image-group-operation-error nodrag nopan">{operationError}</div>}
      {genOpen && (
        <div className="image-continue-panel image-group-continue-panel nodrag nopan" onPointerDown={event => event.stopPropagation()}>
          <div className="image-continue-head">
            <strong>{ign().genTitle}</strong>
            <Button variant="ghost" size="icon" aria-label={ign().close} onClick={() => setGenOpen(false)}>×</Button>
          </div>
          <div className="icp-field">
            <span className="icp-label">{ign().model}</span>
            <div className="icp-chip-row">
              {modelOptions.filter(({ value }) => isVisualModelEnabled(value)).map(({ value, label }) => (
                <CanvasSelectionItem key={value} selected={genModels.includes(value)} className="icp-chip icp-chip-grow" onClick={() => toggleValue(value, genModels, setGenModels)}>{label}</CanvasSelectionItem>
              ))}
            </div>
          </div>
          <div className="icp-field">
            <span className="icp-label">{ign().ratio}</span>
            <div className="icp-chip-row icp-ratio-row">
              {['1:1', '3:4', '4:3', '9:16', '16:9'].map(ratio => (
                <CanvasSelectionItem key={ratio} selected={genRatios.includes(ratio)} className="icp-chip icp-chip-grow" onClick={() => toggleValue(ratio, genRatios, setGenRatios)}>{ratio}</CanvasSelectionItem>
              ))}
            </div>
          </div>
          <div className="icp-options-row">
            <div className="icp-field">
              <span className="icp-label">{ign().count}</span>
              <div className="icp-stepper">
                <Button variant="ghost" size="icon" disabled={genCount <= 1} onClick={() => setGenCount(count => Math.max(1, count - 1))}>−</Button>
                <strong>{genCount}</strong>
                <Button variant="ghost" size="icon" disabled={genCount >= 4} onClick={() => setGenCount(count => Math.min(4, count + 1))}>+</Button>
              </div>
            </div>
            <div className="icp-field icp-field-grow">
              <span className="icp-label">{ign().resolution}</span>
              <div className="icp-chip-row">
                {['2K', '4K'].map(resolution => (
                  <CanvasSelectionItem key={resolution} selected={genResolution === resolution} className="icp-chip icp-chip-grow" onClick={() => setGenResolution(resolution)}>{resolution}</CanvasSelectionItem>
                ))}
              </div>
            </div>
          </div>
          <span className="icp-estimate">{ign().estimate(estimate, memberCount)}</span>
          <div className="icp-field">
            <span className="icp-label">{ign().references}</span>
            <div className="icp-ref icp-ref-group">
              {members.map(member => (
                <div className="icp-ref-thumb" key={member.id}><img src={member.src} alt="" draggable={false} /></div>
              ))}
            </div>
          </div>
          <CompositionSafeTextarea
            className="icp-brief"
            value={genPrompt}
            onValueChange={setGenPrompt}
            onKeyDown={event => {
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                event.preventDefault();
                submitGenerate();
              }
            }}
            placeholder={ign().placeholder}
          />
          <Button variant="primary" disabled={!memberCount} className="icp-submit" onClick={submitGenerate}>{ign().submit}</Button>
        </div>
      )}
    </CanvasGroupFrame>
  );
}

export function buildImageGroupNode(args: {
  group: ImageGroup;
  members: WorkbenchImage[];
  callbacks: Omit<ImageGroupData, 'group' | 'members' | 'memberCount'>;
}): Node<ImageGroupData> {
  return {
    id: args.group.id,
    type: 'imageGroup',
    position: { x: args.group.x, y: args.group.y },
    style: { width: args.group.width, height: args.group.height },
    dragHandle: '.image-group-drag-handle',
    data: {
      group: args.group,
      members: args.members,
      memberCount: args.group.memberIds.length,
      ...args.callbacks,
    },
  };
}
