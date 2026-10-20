import {
  Popover as PopoverPrimitive,
  PopoverAnchor,
  PopoverClose as PopoverClosePrimitive,
  PopoverContent as PopoverContentPrimitive,
  PopoverPortal,
  PopoverTrigger as PopoverTriggerPrimitive,
  type PopoverAnchorProps,
  type PopoverCloseProps,
  type PopoverContentProps,
  type PopoverPortalProps,
  type PopoverProps,
  type PopoverTriggerProps,
} from '@/src/components/animate-ui/primitives/radix/popover';
import { cn } from '@/src/lib/utils';
import { anchoredOverlaySurfaceClassName } from './overlay-surface';

function Popover(props: PopoverProps) {
  return <PopoverPrimitive {...props} />;
}

function PopoverTrigger(props: PopoverTriggerProps) {
  return <PopoverTriggerPrimitive {...props} />;
}

type PublicPopoverContentProps = PopoverContentProps & {
  portalContainer?: PopoverPortalProps['container'];
};

function PopoverContent({
  className,
  align = 'start',
  sideOffset = 4,
  portalContainer,
  ...props
}: PublicPopoverContentProps) {
  return (
    <PopoverPortal container={portalContainer}>
      <PopoverContentPrimitive
        align={align}
        sideOffset={sideOffset}
        className={cn(
          anchoredOverlaySurfaceClassName,
          'w-72 origin-(--radix-popover-content-transform-origin) p-4',
          className,
        )}
        {...props}
      />
    </PopoverPortal>
  );
}

function PopoverClose(props: PopoverCloseProps) {
  return <PopoverClosePrimitive {...props} />;
}

export {
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverClose,
  PopoverAnchor,
  type PopoverProps,
  type PopoverTriggerProps,
  type PublicPopoverContentProps as PopoverContentProps,
  type PopoverCloseProps,
  type PopoverAnchorProps,
};
