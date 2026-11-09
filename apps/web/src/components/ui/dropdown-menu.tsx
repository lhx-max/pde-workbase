/**
 * DA DropdownMenu — the public menu entry for product code.
 *
 * Composes the Animate UI radix primitives (behavior + motion) with DA token
 * styling. The shadcn-palette classes in `animate-ui/components/radix/` are
 * NOT bridged to DA tokens, so product surfaces must consume this adapter
 * instead of the vendor component layer.
 */
import { useContext } from 'react';
import { CheckIcon, ChevronRightIcon, CircleIcon } from 'lucide-react';
import { DialogLayerContext } from './dialog-layer';

import {
  DropdownMenu as DropdownMenuPrimitiveRoot,
  DropdownMenuTrigger as DropdownMenuTriggerPrimitive,
  DropdownMenuGroup as DropdownMenuGroupPrimitive,
  DropdownMenuPortal as DropdownMenuPortalPrimitive,
  DropdownMenuSub as DropdownMenuSubPrimitive,
  DropdownMenuRadioGroup as DropdownMenuRadioGroupPrimitive,
  DropdownMenuSubTrigger as DropdownMenuSubTriggerPrimitive,
  DropdownMenuSubContent as DropdownMenuSubContentPrimitive,
  DropdownMenuContent as DropdownMenuContentPrimitive,
  DropdownMenuHighlight as DropdownMenuHighlightPrimitive,
  DropdownMenuHighlightItem as DropdownMenuHighlightItemPrimitive,
  DropdownMenuItem as DropdownMenuItemPrimitive,
  DropdownMenuCheckboxItem as DropdownMenuCheckboxItemPrimitive,
  DropdownMenuRadioItem as DropdownMenuRadioItemPrimitive,
  DropdownMenuItemIndicator as DropdownMenuItemIndicatorPrimitive,
  DropdownMenuLabel as DropdownMenuLabelPrimitive,
  DropdownMenuSeparator as DropdownMenuSeparatorPrimitive,
  type DropdownMenuProps as DropdownMenuRootPrimitiveProps,
  type DropdownMenuTriggerProps as DropdownMenuTriggerPrimitiveProps,
  type DropdownMenuGroupProps as DropdownMenuGroupPrimitiveProps,
  type DropdownMenuSubProps as DropdownMenuSubPrimitiveProps,
  type DropdownMenuRadioGroupProps as DropdownMenuRadioGroupPrimitiveProps,
  type DropdownMenuSubTriggerProps as DropdownMenuSubTriggerPrimitiveProps,
  type DropdownMenuSubContentProps as DropdownMenuSubContentPrimitiveProps,
  type DropdownMenuContentProps as DropdownMenuContentPrimitiveProps,
  type DropdownMenuItemProps as DropdownMenuItemPrimitiveProps,
  type DropdownMenuCheckboxItemProps as DropdownMenuCheckboxItemPrimitiveProps,
  type DropdownMenuRadioItemProps as DropdownMenuRadioItemPrimitiveProps,
  type DropdownMenuLabelProps as DropdownMenuLabelPrimitiveProps,
  type DropdownMenuSeparatorProps as DropdownMenuSeparatorPrimitiveProps,
} from '@/src/components/animate-ui/primitives/radix/dropdown-menu';
import { cn } from '@/src/lib/utils';
import { anchoredOverlaySurfaceClassName } from './overlay-surface';

// ─── DA surface classes ───────────────────────────────────────────────────────

const contentBase = [
  'z-50 min-w-[152px] overflow-x-hidden overflow-y-auto',
  'max-h-(--radix-dropdown-menu-content-available-height)',
  anchoredOverlaySurfaceClassName,
  'p-[5px]',
].join(' ');

const highlightBase = 'absolute inset-0 z-0 rounded-[var(--radius-md)] bg-bg-subtle';

const itemBase = [
  'relative flex h-8 cursor-default select-none items-center gap-2',
  'rounded-[var(--radius-md)] px-2.5 text-[13px] leading-none text-text outline-none',
  'data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50',
  "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5 [&_svg]:text-text-muted",
].join(' ');

const itemDestructive = 'text-[var(--red)] [&_svg]:text-[var(--red)]';
const itemDestructiveActive = 'bg-[color-mix(in_srgb,var(--red)_10%,transparent)]';

const checkableItemBase = cn(itemBase, 'pl-8');
const indicatorSpan = 'pointer-events-none absolute left-2 flex size-3.5 items-center justify-center';

// ─── Root / Trigger / grouping (pure behavior, re-exported) ──────────────────

type DropdownMenuProps = DropdownMenuRootPrimitiveProps;
const DropdownMenu = DropdownMenuPrimitiveRoot;

type DropdownMenuTriggerProps = DropdownMenuTriggerPrimitiveProps;
const DropdownMenuTrigger = DropdownMenuTriggerPrimitive;

type DropdownMenuGroupProps = DropdownMenuGroupPrimitiveProps;
const DropdownMenuGroup = DropdownMenuGroupPrimitive;

type DropdownMenuSubProps = DropdownMenuSubPrimitiveProps;
const DropdownMenuSub = DropdownMenuSubPrimitive;

type DropdownMenuRadioGroupProps = DropdownMenuRadioGroupPrimitiveProps;
const DropdownMenuRadioGroup = DropdownMenuRadioGroupPrimitive;

// ─── Content ──────────────────────────────────────────────────────────────────

type FocusOutsideEvent = { target: unknown; preventDefault: () => void };

type InteractOutsideEvent = {
  preventDefault: () => void;
  detail?: { originalEvent?: { target?: unknown } };
};

type OutsideHandler<T extends { preventDefault: () => void }> = (event: T) => void;

/**
 * Passive cover/preview iframes are pointer-events-none decorations, yet
 * Chromium can hand them focus while they finish loading. A background iframe
 * grabbing focus must never dismiss an open menu — veto only that case and
 * defer to the caller/defaults otherwise. Radix routes dismissal through both
 * onFocusOutside and onInteractOutside, so guard both.
 */
function guardIframeOutside<
  T extends { preventDefault: () => void; target?: unknown; detail?: { originalEvent?: { target?: unknown } } },
>(handler: OutsideHandler<T> | undefined): OutsideHandler<T> {
  return (event) => {
    const target = (event.detail?.originalEvent?.target ?? event.target) as HTMLElement | null | undefined;
    if (target?.tagName === 'IFRAME') {
      event.preventDefault();
      return;
    }
    handler?.(event);
  };
}

type DropdownMenuContentProps = DropdownMenuContentPrimitiveProps;

function DropdownMenuContent({
  sideOffset = 4,
  align = 'start',
  className,
  children,
  onFocusOutside,
  onInteractOutside,
  style,
  ...props
}: DropdownMenuContentProps) {
  // A dialog opened over a tooltip-layer surface sits at that layer + 2.
  // The menu's own layer is 4000, so inside that dialog it paints behind the scrim.
  const dialogLayer = useContext(DialogLayerContext);
  const aboveDialog = dialogLayer ? (dialogLayer.zIndex ?? 1700) + 20 : undefined;
  return (
    <DropdownMenuContentPrimitive
      sideOffset={sideOffset}
      align={align}
      className={cn(contentBase, className)}
      onFocusOutside={guardIframeOutside(onFocusOutside)}
      onInteractOutside={guardIframeOutside(onInteractOutside)}
      style={{ ...style, ...(aboveDialog != null ? { zIndex: aboveDialog } : {}) }}
      {...props}
    >
      <DropdownMenuHighlightPrimitive className={highlightBase}>
        {children}
      </DropdownMenuHighlightPrimitive>
    </DropdownMenuContentPrimitive>
  );
}

// ─── Items ────────────────────────────────────────────────────────────────────

type DropdownMenuItemProps = DropdownMenuItemPrimitiveProps & {
  variant?: 'default' | 'destructive';
};

function DropdownMenuItem({
  className,
  variant = 'default',
  disabled,
  ...props
}: DropdownMenuItemProps) {
  return (
    <DropdownMenuHighlightItemPrimitive
      disabled={disabled}
      activeClassName={variant === 'destructive' ? itemDestructiveActive : ''}
    >
      <DropdownMenuItemPrimitive
        disabled={disabled}
        className={cn(itemBase, variant === 'destructive' && itemDestructive, className)}
        {...props}
      />
    </DropdownMenuHighlightItemPrimitive>
  );
}

type DropdownMenuCheckboxItemProps = DropdownMenuCheckboxItemPrimitiveProps;

function DropdownMenuCheckboxItem({
  className,
  children,
  disabled,
  ...props
}: DropdownMenuCheckboxItemProps) {
  return (
    <DropdownMenuHighlightItemPrimitive disabled={disabled}>
      <DropdownMenuCheckboxItemPrimitive
        disabled={disabled}
        className={cn(checkableItemBase, className)}
        {...props}
      >
        <span className={indicatorSpan}>
          <DropdownMenuItemIndicatorPrimitive
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: 1 }}
          >
            <CheckIcon className="size-3.5" />
          </DropdownMenuItemIndicatorPrimitive>
        </span>
        {children}
      </DropdownMenuCheckboxItemPrimitive>
    </DropdownMenuHighlightItemPrimitive>
  );
}

type DropdownMenuRadioItemProps = DropdownMenuRadioItemPrimitiveProps;

function DropdownMenuRadioItem({
  className,
  children,
  disabled,
  ...props
}: DropdownMenuRadioItemProps) {
  return (
    <DropdownMenuHighlightItemPrimitive disabled={disabled}>
      <DropdownMenuRadioItemPrimitive
        disabled={disabled}
        className={cn(checkableItemBase, className)}
        {...props}
      >
        <span className={indicatorSpan}>
          <DropdownMenuItemIndicatorPrimitive>
            <CircleIcon className="size-1.5 fill-current" />
          </DropdownMenuItemIndicatorPrimitive>
        </span>
        {children}
      </DropdownMenuRadioItemPrimitive>
    </DropdownMenuHighlightItemPrimitive>
  );
}

// ─── Label / Separator ────────────────────────────────────────────────────────

type DropdownMenuLabelProps = DropdownMenuLabelPrimitiveProps;

function DropdownMenuLabel({ className, ...props }: DropdownMenuLabelProps) {
  return (
    <DropdownMenuLabelPrimitive
      className={cn('px-2.5 py-1.5 text-[11px] text-text-faint', className)}
      {...props}
    />
  );
}

type DropdownMenuSeparatorProps = DropdownMenuSeparatorPrimitiveProps;

function DropdownMenuSeparator({ className, ...props }: DropdownMenuSeparatorProps) {
  return (
    <DropdownMenuSeparatorPrimitive
      className={cn('-mx-1 my-1 h-px bg-border-soft', className)}
      {...props}
    />
  );
}

// ─── Sub menu ─────────────────────────────────────────────────────────────────

type DropdownMenuSubTriggerProps = DropdownMenuSubTriggerPrimitiveProps;

function DropdownMenuSubTrigger({
  className,
  children,
  disabled,
  ...props
}: DropdownMenuSubTriggerProps) {
  return (
    <DropdownMenuHighlightItemPrimitive disabled={disabled}>
      <DropdownMenuSubTriggerPrimitive
        disabled={disabled}
        className={cn(itemBase, className)}
        {...props}
      >
        {children}
        <ChevronRightIcon className="ml-auto size-3.5" />
      </DropdownMenuSubTriggerPrimitive>
    </DropdownMenuHighlightItemPrimitive>
  );
}

type DropdownMenuSubContentProps = DropdownMenuSubContentPrimitiveProps;

function DropdownMenuSubContent({ className, children, onFocusOutside, onInteractOutside, ...props }: DropdownMenuSubContentProps) {
  return (
    <DropdownMenuSubContentPrimitive
      data-highlight-scope="submenu"
      className={cn(contentBase, className)}
      onFocusOutside={guardIframeOutside(onFocusOutside)}
      onInteractOutside={guardIframeOutside(onInteractOutside)}
      {...props}
    >
      <DropdownMenuHighlightPrimitive className={highlightBase}>
        {children}
      </DropdownMenuHighlightPrimitive>
    </DropdownMenuSubContentPrimitive>
  );
}

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuPortalPrimitive as DropdownMenuPortal,
  type DropdownMenuProps,
  type DropdownMenuTriggerProps,
  type DropdownMenuContentProps,
  type DropdownMenuGroupProps,
  type DropdownMenuItemProps,
  type DropdownMenuCheckboxItemProps,
  type DropdownMenuRadioGroupProps,
  type DropdownMenuRadioItemProps,
  type DropdownMenuLabelProps,
  type DropdownMenuSeparatorProps,
  type DropdownMenuSubProps,
  type DropdownMenuSubTriggerProps,
  type DropdownMenuSubContentProps,
};
