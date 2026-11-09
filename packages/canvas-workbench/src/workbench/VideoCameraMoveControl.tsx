'use client';

import React from 'react';
import { Button } from '@bezier/components';
import { requireCanvasPopoverRenderer, useCanvasUiHost } from '../platform/ui-host';
import { Icon } from '../ui/Icon';
import { CanvasSelectionItem } from './CanvasSelectionItem';
import { CanvasSegmentedControl } from './CanvasSegmentedControl';
import { cr } from '../locales/canvas-remainder';
import {
  DEFAULT_VIDEO_CAMERA_MOVE,
  VIDEO_CAMERA_MOVES,
  VIDEO_CAMERA_SHOTS,
  VIDEO_CAMERA_SPEEDS,
  type VideoCameraMove,
  videoCameraMoveSummary,
} from './video-camera-move';

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<{ id: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <div className="video-node-camera-field">
      <span>{label}</span>
      <CanvasSegmentedControl label={label} value={value} options={options} onChange={onChange} />
    </div>
  );
}

export function VideoCameraMoveControl({
  value,
  disabled,
  onChange,
  ariaLabel = cr().cameraSettings,
  footerHint = cr().autoAddPrompt,
  portalContainer,
  renderTrigger,
}: {
  value?: VideoCameraMove;
  disabled?: boolean;
  onChange: (value: VideoCameraMove) => void;
  ariaLabel?: string;
  footerHint?: string;
  portalContainer?: HTMLElement | null;
  renderTrigger?: (state: { open: boolean; summary: string }) => React.ReactElement;
}) {
  const uiHost = useCanvasUiHost();
  const renderPopover = requireCanvasPopoverRenderer(uiHost);
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState<VideoCameraMove>(value ?? DEFAULT_VIDEO_CAMERA_MOVE);

  const setPopoverOpen = (next: boolean) => {
    setOpen(next);
    if (next) setDraft(value ?? DEFAULT_VIDEO_CAMERA_MOVE);
  };
  const summary = value ? videoCameraMoveSummary(value) : cr().notSet;

  return renderPopover({
    open,
    onOpenChange: setPopoverOpen,
    contentClassName: 'video-node-camera-popover',
    ariaLabel,
    role: 'dialog',
    portalContainer,
    wrapDomainMenu: false,
    trigger: renderTrigger ? renderTrigger({ open, summary }) : (
      <Button
        type="button"
        variant="ghost"
        className="video-node-camera-trigger"
        aria-expanded={open}
        disabled={disabled}
        title={cr().setCameraMove}
      >
        <Icon name="video" size={14} />
        <span>{cr().cameraMove}</span>
        {value ? <small>{videoCameraMoveSummary(value)}</small> : null}
        <Icon name="chevron-right" size={12} className="video-node-camera-chevron" />
      </Button>
    ),
    children: (
      <div className="video-node-camera-panel" onPointerDown={event => event.stopPropagation()}>
        <div className="video-node-camera-heading">
          <strong>{cr().cameraMove}</strong>
          <span>{cr().asVideoConstraint}</span>
        </div>
        <div className="video-node-camera-move-grid" role="group" aria-label={cr().moveType}>
          {VIDEO_CAMERA_MOVES.map(option => (
            <CanvasSelectionItem
              key={option.id}
              selected={draft.move === option.id}
              className="video-node-camera-move-button"
              title={option.description}
              onClick={() => setDraft(current => ({ ...current, move: option.id }))}
            >
              <Icon name={option.icon} size={18} className="video-node-camera-move-icon" />
              <span>{option.label}</span>
            </CanvasSelectionItem>
          ))}
        </div>
        <Segmented
          label={cr().speed}
          value={draft.speed}
          options={VIDEO_CAMERA_SPEEDS}
          onChange={speed => setDraft(current => ({ ...current, speed }))}
        />
        <Segmented
          label={cr().shotSize}
          value={draft.shot}
          options={VIDEO_CAMERA_SHOTS}
          onChange={shot => setDraft(current => ({ ...current, shot }))}
        />
        <div className="video-node-camera-footer">
          <span>{videoCameraMoveSummary(draft)}，{footerHint}</span>
          <Button
            type="button"
            variant="primary"
            onClick={() => {
              onChange(draft);
              setOpen(false);
            }}
          >
            {cr().apply}
          </Button>
        </div>
      </div>
    ),
  });
}
