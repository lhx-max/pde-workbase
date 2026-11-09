'use client';

import React from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@bezier/components';
import { Icon } from '../ui/Icon';
import { canvasNodeActionChrome } from '../locales/chrome';
import { useCanvasLocale } from '../platform/canvas-locale';

export const CanvasGroupMemberAction = React.createContext<{ nodeId: string; onRemove: () => void } | null>(null);

/**
 * 卡片选中/悬停时浮出的节点级操作条（复制 / 删除）。
 *
 * 抽出来的原因：这套操作原本只存在于 BasicCanvasNode 的标题栏里，图片、视频、
 * 图片组等卡片要么只能用键盘 Backspace 删除（没有可见入口），要么完全没有。
 * 逐个卡片复制一遍 JSX 会把下面两个易漏的细节也复制三份：
 *
 *   1. `nodrag` —— 不加的话按钮会被 React Flow 当成拖拽把手，点一下就把整个
 *      节点拖走了。
 *   2. `stopPropagation` —— pointerdown 与 click 都要拦。前者防止拖拽，后者
 *      防止冒泡到卡片的选中/打开逻辑上。
 *
 * 所以这里只暴露语义化的回调，交互细节由组件统一兜住。
 */
export function CanvasNodeActions({
  onDuplicate,
  onRemove,
  onDownload,
  downloadLabel,
  downloadDisabled = false,
  duplicateLabel,
  removeLabel,
  floating: _floating,
  placement = 'outside',
  className,
  children,
}: {
  /** 省略即不渲染复制按钮（例如工作流产出的节点不允许复制）。 */
  onDuplicate?: () => void;
  /** 省略即不渲染删除按钮。 */
  onRemove?: () => void;
  onDownload?: () => void;
  downloadLabel?: string;
  downloadDisabled?: boolean;
  duplicateLabel?: string;
  removeLabel?: string;
  /**
   * @deprecated 所有卡片统一定位到节点外框，此参数仅保留兼容旧调用方。
   */
  floating?: boolean;
  /** 图片内容态使用卡内右上角；仍由同一节点级 portal 定位。 */
  placement?: 'outside' | 'inside';
  className?: string;
  /** 卡片自有的额外操作，排在复制/删除之前。 */
  children?: React.ReactNode;
}) {
  const anchor = React.useRef<HTMLSpanElement>(null);
  const memberAction = React.useContext(CanvasGroupMemberAction);
  const actionsChrome = canvasNodeActionChrome(useCanvasLocale());
  const resolvedDownloadLabel = downloadLabel ?? actionsChrome.download;
  const resolvedDuplicateLabel = duplicateLabel ?? actionsChrome.duplicateNode;
  const resolvedRemoveLabel = removeLabel ?? actionsChrome.removeNode;
  const [nodeHost, setNodeHost] = React.useState<Element | null>(null);
  const [frameTop, setFrameTop] = React.useState(0);
  const hasActions = Boolean(onDownload || onDuplicate || onRemove || children);
  React.useLayoutEffect(() => {
    const node = anchor.current?.closest('.react-flow__node') ?? null;
    const imageFrame = node?.querySelector<HTMLElement>('.minimax-image-frame, .image-asset-frame');
    setNodeHost(placement === 'inside' ? imageFrame ?? node : node);
    // Keep outside actions in the node portal (the generated image clips its
    // contents), but measure from the visible frame, not the title/padding.
    const measure = () => {
      let top = 0;
      let element: HTMLElement | null = imageFrame ?? null;
      while (element && element !== node) {
        top += element.offsetTop;
        element = element.offsetParent as HTMLElement | null;
      }
      setFrameTop(element === node ? top : 0);
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    if (node) observer?.observe(node);
    if (imageFrame) observer?.observe(imageFrame);
    return () => observer?.disconnect();
  }, [hasActions, placement]);
  if (!hasActions) return null;
  const actions = (
    <div
      role="group"
      aria-label={actionsChrome.group}
      data-placement={placement}
      style={placement === 'outside' ? { '--node-actions-frame-top': `${frameTop}px` } as React.CSSProperties : undefined}
      className={`canvas-action-surface canvas-node-actions nodrag nopan${className ? ` ${className}` : ''}`}
      onPointerDown={event => event.stopPropagation()}
      onMouseDown={event => event.stopPropagation()}
      onClick={event => event.stopPropagation()}
      onDoubleClick={event => event.stopPropagation()}
    >
      {children}
      {memberAction && anchor.current?.closest('.react-flow__node')?.getAttribute('data-id') === memberAction.nodeId
        ? <Button variant="ghost" onClick={memberAction.onRemove}>{actionsChrome.removeFromGroup}</Button> : null}
      {onDownload ? (
        <Button variant="ghost" size="icon" aria-label={resolvedDownloadLabel} title={resolvedDownloadLabel}
          disabled={downloadDisabled} onClick={event => { event.stopPropagation(); onDownload(); }}>
          <Icon name="download" size={16} />
        </Button>
      ) : null}
      {onDuplicate ? (
        <Button
          variant="ghost"
          size="icon"
          aria-label={resolvedDuplicateLabel}
          title={actionsChrome.duplicate}
          onClick={event => {
            event.stopPropagation();
            onDuplicate();
          }}
        >
          <Icon name="copy" size={16} />
        </Button>
      ) : null}
      {onRemove ? (
        <Button
          variant="ghost"
          size="icon"
          aria-label={resolvedRemoveLabel}
          title={actionsChrome.remove}
          onClick={event => {
            event.stopPropagation();
            // The focused button disappears with its node. Keep shortcuts such
            // as undo on the canvas instead of dropping focus onto the document.
            event.currentTarget.closest<HTMLElement>('.xy-flow-host')?.focus({ preventScroll: true });
            onRemove();
          }}
        >
          <Icon name="trash" size={16} />
        </Button>
      ) : null}
    </div>
  );
  return <><span ref={anchor} hidden />{nodeHost ? createPortal(actions, nodeHost) : actions}</>;
}
