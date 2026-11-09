import {
  HoverCard as HoverCardPrimitive,
  HoverCardContent as HoverCardContentPrimitive,
  HoverCardPortal,
  HoverCardTrigger as HoverCardTriggerPrimitive,
  type HoverCardContentProps,
  type HoverCardProps,
  type HoverCardTriggerProps,
} from '@/src/components/animate-ui/primitives/radix/hover-card';
import { cn } from '@/src/lib/utils';
import { anchoredOverlaySurfaceClassName } from './overlay-surface';

function HoverCard(props: HoverCardProps) {
  return <HoverCardPrimitive {...props} />;
}

function HoverCardTrigger(props: HoverCardTriggerProps) {
  return <HoverCardTriggerPrimitive {...props} />;
}

function HoverCardContent({
  className,
  align = 'center',
  sideOffset = 4,
  ...props
}: HoverCardContentProps) {
  return (
    <HoverCardPortal>
      <HoverCardContentPrimitive
        align={align}
        sideOffset={sideOffset}
        className={cn(
          anchoredOverlaySurfaceClassName,
          'w-64 origin-(--radix-hover-card-content-transform-origin) p-4',
          className,
        )}
        {...props}
      />
    </HoverCardPortal>
  );
}

export {
  HoverCard,
  HoverCardTrigger,
  HoverCardContent,
  type HoverCardProps,
  type HoverCardTriggerProps,
  type HoverCardContentProps,
};
