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
  React.useLayoutEffect(() => {
    const form = formRef.current;
    const canvas = form?.closest('.xy-flow-host');
    const node = form?.closest('.react-flow__node');
    if (!form || !canvas || !node) return;
    const chrome = canvas.closest('[data-pane-order]') || canvas.closest('.flow-home') || canvas;
    const observed = new Set<Element>();
    const update = () => {
      const bounds = canvas.getBoundingClientRect();
      let bottom = bounds.bottom;
      for (const obstacle of chrome.querySelectorAll('[data-canvas-composer-obstacle]')) {
        if (!observed.has(obstacle)) { resize.observe(obstacle); observed.add(obstacle); }
        const rect = obstacle.getBoundingClientRect();
        if (rect.width && rect.height && rect.right > bounds.left && rect.left < bounds.right
          && rect.bottom > bounds.top && rect.top > bounds.top && rect.top < bounds.bottom) bottom = Math.min(bottom, rect.top);
      }
      const zoom = node.getBoundingClientRect().width / (node as HTMLElement).offsetWidth || 1;
      form.style.transform = 'translateX(-50%)';
      form.style.maxWidth = `${Math.max(0, bounds.width - 16) / zoom}px`;
      form.style.maxHeight = `${Math.max(0, bottom - bounds.top - 16) / zoom}px`;
      form.style.overflowY = 'auto';
      const rect = form.getBoundingClientRect();
      const dx = Math.max(bounds.left + 8 - rect.left, Math.min(0, bounds.right - 8 - rect.right));
      const dy = Math.max(bounds.top + 8 - rect.top, Math.min(0, bottom - 8 - rect.bottom));
      form.style.transform = `translateX(-50%) translate(${dx / zoom}px, ${dy / zoom}px)`;
    };
    const resize = new ResizeObserver(update);
    update();
    [canvas, node, form].forEach(element => resize.observe(element));
    const movement = new MutationObserver(update);
    for (const element of [node, form.closest('.react-flow__viewport')]) {
      if (element) movement.observe(element, { attributes: true, attributeFilter: ['style'] });
    }
    const chromeChanges = new MutationObserver(update);
    chromeChanges.observe(chrome, { childList: true, subtree: true });
    window.addEventListener('resize', update);
    return () => { resize.disconnect(); movement.disconnect(); chromeChanges.disconnect(); window.removeEventListener('resize', update); };
  }, [activeOwnerId, ownerId, expanded]);
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
