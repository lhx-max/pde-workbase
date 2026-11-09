'use client';

import React from 'react';
import { Button } from '@bezier/components';
import { Icon } from '../ui/Icon';
import { cr } from '../locales/canvas-remainder';

const CanvasComposerFocusContext = React.createContext<string | null | undefined>(undefined);

export function CanvasComposerFocusProvider({
  activeOwnerId,
  children,
}: {
  activeOwnerId: string | null;
  children: React.ReactNode;
}) {
  return (
    <CanvasComposerFocusContext.Provider value={activeOwnerId}>
      {children}
    </CanvasComposerFocusContext.Provider>
  );
}

type CanvasComposerShellProps = Omit<React.ComponentPropsWithoutRef<'form'>, 'className'> & {
  expanded: boolean;
  className?: string;
  /** Canvas node that owns this composer. Only the focused owner is rendered. */
  ownerId: string;
};

export function openCanvasProjectAssets() {
  window.dispatchEvent(new CustomEvent('bezier-design:toggle-project-assets'));
}

export function CanvasComposerShell({
  expanded,
  className = '',
  ownerId,
  children,
  onPointerDown,
  onClick,
  onDoubleClick,
  onWheel,
  onSubmit,
  ...props
}: CanvasComposerShellProps) {
  const activeOwnerId = React.useContext(CanvasComposerFocusContext);
  const formRef = React.useRef<HTMLFormElement>(null);
  if (activeOwnerId !== undefined && activeOwnerId !== ownerId) return null;

  return (
    <form
      {...props}
      ref={formRef}
      className={`minimax-image-composer nodrag nopan nowheel${expanded ? ' is-expanded' : ''}${className ? ` ${className}` : ''}`}
      onPointerDown={event => {
        event.stopPropagation();
        onPointerDown?.(event);
      }}
      onClick={event => {
        event.stopPropagation();
        onClick?.(event);
      }}
      onDoubleClick={event => {
        event.stopPropagation();
        onDoubleClick?.(event);
      }}
      onWheel={event => {
        event.stopPropagation();
        onWheel?.(event);
      }}
      onSubmit={event => {
        event.stopPropagation();
        onSubmit?.(event);
      }}
    >
      {children}
    </form>
  );
}

export function CanvasComposerAttachment({ name, mimeType, src, className = '', children }: {
  name: string;
  mimeType: string;
  src?: string;
  className?: string;
  children?: React.ReactNode;
}) {
  const image = mimeType.startsWith('image/') && src;
  return (
    <div className={`minimax-image-attachment${className ? ` ${className}` : ''}`} title={name}>
      {image ? <img src={src} alt={name} draggable={false} /> : (
        <span className="minimax-image-attachment-file">
          <Icon name="file" size={18} />
          <small>{name}</small>
        </span>
      )}
      {children}
    </div>
  );
}

export function CanvasComposerExpandButton({ expanded, onClick }: { expanded: boolean; onClick: () => void }) {
  return (
    <Button type="button" variant="ghost" size="icon" className="minimax-image-expand" aria-label={expanded ? cr().collapseInput : cr().expandInput} title={expanded ? cr().collapse : cr().expand} onClick={onClick}>
      <Icon name={expanded ? 'collapse' : 'expand'} size={16} />
    </Button>
  );
}

export function CanvasComposerAddButton({ label, onClick, disabled = false }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <Button type="button" variant="ghost" size="icon" className="minimax-image-add-reference" aria-label={label} title={label} disabled={disabled} onClick={onClick}>
      <Icon name="plus" size={18} />
    </Button>
  );
}

type CanvasComposerHeaderBaseProps = {
  children?: React.ReactNode;
  attachmentsLabel?: string;
  expanded: boolean;
  onExpand: () => void;
};

type CanvasComposerHeaderProps = CanvasComposerHeaderBaseProps & ({
  showAdd?: true;
  addLabel: string;
  addDisabled?: boolean;
  onAdd: () => void;
} | {
  showAdd: false;
  addLabel?: never;
  addDisabled?: never;
  onAdd?: never;
});

export function CanvasComposerHeader({
  children,
  attachmentsLabel = cr().attachedAssets,
  addLabel,
  addDisabled = false,
  showAdd = true,
  onAdd,
  expanded,
  onExpand,
}: CanvasComposerHeaderProps) {
  return (
    <div className="minimax-image-composer-head">
      <div className="minimax-image-attachments" aria-label={attachmentsLabel}>
        {children}
        {showAdd && addLabel && onAdd ? <CanvasComposerAddButton label={addLabel} disabled={addDisabled} onClick={onAdd} /> : null}
      </div>
      <CanvasComposerExpandButton expanded={expanded} onClick={onExpand} />
    </div>
  );
}
