import type {
  ImageGenerationPopoverRenderProps,
  ResourceDialogRenderProps,
  CanvasHoverCardRenderProps,
  CanvasMenuRenderProps,
  CanvasTabsRenderProps,
} from '@bezier/canvas-workbench';
import {
  DialogRoot,
  DialogSurface,
  Popover,
  PopoverContent,
  PopoverTrigger,
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Tabs,
  TabsList,
  TabsTrigger,
} from '@/src/components/ui';
import { FilterChipRail } from '../FilterChipRail';

type HomeWorkbenchDialogRenderProps = ResourceDialogRenderProps & {
  morphLayoutId?: string;
};

/**
 * Host-owned Animate UI shells for canvas workbench controls shown on the home
 * composer. The workbench keeps domain content and state; DA owns overlay
 * behavior, collision handling, focus management, and native motion.
 */
export function renderHomeWorkbenchPopover({
  open,
  onOpenChange,
  trigger,
  children,
  contentClassName,
  ariaLabel,
  wrapDomainMenu = true,
  role = 'listbox',
  portalContainer,
  side = 'top',
  align = 'start',
  sideOffset = 8,
}: ImageGenerationPopoverRenderProps) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        className={`${contentClassName} home-workbench-popover`}
        role={role}
        aria-label={ariaLabel}
        side={side}
        align={align}
        sideOffset={sideOffset}
        avoidCollisions
        collisionPadding={12}
        sticky="always"
        hideWhenDetached
        portalContainer={portalContainer}
      >
        <div className="canvas-workbench home-workbench-popover__scope">
          {wrapDomainMenu ? (
            <div className={`minimax-image-menu ${contentClassName}`}>{children}</div>
          ) : children}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export const renderCanvasWorkbenchPopover = renderHomeWorkbenchPopover;

export function renderCanvasWorkbenchHoverCard({
  trigger,
  children,
  contentClassName,
  ariaLabel,
  side = 'top',
  align = 'start',
}: CanvasHoverCardRenderProps) {
  return (
    <HoverCard openDelay={260} closeDelay={80}>
      <HoverCardTrigger asChild>{trigger}</HoverCardTrigger>
      <HoverCardContent
        className={`workbench-host-hover-card ${contentClassName || ''}`}
        role="tooltip"
        aria-label={ariaLabel}
        side={side}
        align={align}
        sideOffset={8}
        collisionPadding={12}
      >
        <div className="canvas-workbench workbench-host-hover-card__scope">{children}</div>
      </HoverCardContent>
    </HoverCard>
  );
}

export function renderCanvasWorkbenchMenu({
  open,
  onOpenChange,
  trigger,
  items,
  contentClassName,
  ariaLabel,
  label,
  selectedValue,
  onSelectedValueChange,
  scale,
  side = 'top',
  align = 'start',
}: CanvasMenuRenderProps) {
  const renderedItems = items.map(item => {
    if (item.kind === 'separator') {
      return <DropdownMenuSeparator key={item.id} />;
    }
    if (selectedValue !== undefined && item.value !== undefined) {
      return (
        <DropdownMenuRadioItem
          key={item.id}
          value={item.value}
          disabled={item.disabled}
          className={item.className}
        >
          {item.content}
        </DropdownMenuRadioItem>
      );
    }
    return (
      <DropdownMenuItem
        key={item.id}
        disabled={item.disabled}
        className={item.className}
        onSelect={item.onSelect}
      >
        {item.content}
      </DropdownMenuItem>
    );
  });

  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange} modal={false}>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent
        className={`workbench-host-menu ${contentClassName || ''}`}
        aria-label={ariaLabel}
        aria-labelledby=""
        side={side}
        align={align}
        sideOffset={8 * (scale ?? 1)}
        collisionPadding={12}
        updatePositionStrategy={scale !== undefined ? 'always' : 'optimized'}
        style={scale !== undefined ? {
          // Zoom changes layout size too, so Radix collides against the scaled surface.
          zoom: scale,
          maxHeight: `calc(var(--radix-dropdown-menu-content-available-height) / ${scale})`,
          maxWidth: `calc((100vw - 24px) / ${scale})`,
        } : undefined}
      >
        {label ? <DropdownMenuLabel>{label}</DropdownMenuLabel> : null}
        {selectedValue !== undefined && onSelectedValueChange ? (
          <DropdownMenuRadioGroup value={selectedValue} onValueChange={onSelectedValueChange}>
            {renderedItems}
          </DropdownMenuRadioGroup>
        ) : renderedItems}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export const renderHomeWorkbenchMenu = renderCanvasWorkbenchMenu;

export function renderCanvasWorkbenchTabs({
  value,
  onValueChange,
  items,
  ariaLabel,
  className,
}: CanvasTabsRenderProps) {
  return (
    <Tabs value={value} onValueChange={onValueChange} className={className}>
      <TabsList aria-label={ariaLabel} className={className ? `${className}__list` : undefined}>
        {items.map((item) => (
          <TabsTrigger key={item.value} value={item.value} disabled={item.disabled}>
            {item.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}

export const renderHomeWorkbenchTabs = renderCanvasWorkbenchTabs;

export function renderCanvasWorkbenchTemplateCategories({
  value,
  onValueChange,
  items,
  ariaLabel,
  className,
}: CanvasTabsRenderProps) {
  return (
    <FilterChipRail
      className={className}
      ariaLabel={ariaLabel}
      items={items.map(item => ({
        id: item.value,
        label: item.label,
        disabled: item.disabled,
      }))}
      value={value}
      onValueChange={onValueChange}
    />
  );
}

export const renderHomeWorkbenchTemplateCategories = renderCanvasWorkbenchTemplateCategories;

function HomeWorkbenchDialog({
  open,
  onOpenChange,
  children,
  className,
  ariaLabelledBy,
  ariaLabel,
  surface = 'resource',
  canvasStyles = true,
  backdrop = 'dimmed',
}: HomeWorkbenchDialogRenderProps) {
  const domainClassName = className
    .split(/\s+/)
    .filter((name) => name && name !== 'canvas-workbench')
    .join(' ');

  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <DialogSurface
        className={surface === 'resource'
          ? 'home-workbench-dialog home-workbench-dialog--resource'
          : `workbench-domain-dialog${canvasStyles ? '' : ' workbench-domain-dialog--floating'}`}
        overlayClassName={[
          'home-workbench-dialog-overlay',
          surface === 'resource' ? 'home-workbench-dialog-overlay--resource' : '',
          backdrop === 'transparent' ? 'home-workbench-dialog-overlay--transparent' : '',
        ].filter(Boolean).join(' ')}
        unstyled={surface === 'domain'}
        overlayUnstyled={false}
        aria-labelledby={ariaLabelledBy}
        aria-label={ariaLabel}
        showCloseButton={false}
        data-motion="none"
      >
        <div className={`${canvasStyles ? 'canvas-workbench ' : ''}${surface === 'resource' ? 'home-workbench-dialog__scope' : 'workbench-domain-dialog__scope'}`}>
          <div className={domainClassName}>{children}</div>
        </div>
      </DialogSurface>
    </DialogRoot>
  );
}

export function renderHomeWorkbenchDialog(props: ResourceDialogRenderProps) {
  return <HomeWorkbenchDialog {...props} />;
}

export const renderCanvasWorkbenchDialog = renderHomeWorkbenchDialog;

export function renderMorphingHomeWorkbenchDialog(
  morphLayoutId: string,
  props: ResourceDialogRenderProps,
) {
  return <HomeWorkbenchDialog {...props} morphLayoutId={morphLayoutId} />;
}
