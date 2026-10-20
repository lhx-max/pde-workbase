import * as React from 'react';
import { XIcon } from 'lucide-react';

import {
  Dialog as DialogPrimitive,
  DialogContent as DialogContentPrimitive,
  DialogDescription as DialogDescriptionPrimitive,
  DialogFooter as DialogFooterPrimitive,
  DialogHeader as DialogHeaderPrimitive,
  DialogTitle as DialogTitlePrimitive,
  DialogTrigger as DialogTriggerPrimitive,
  DialogPortal as DialogPortalPrimitive,
  DialogOverlay as DialogOverlayPrimitive,
  DialogClose as DialogClosePrimitive,
  type DialogProps as DialogPrimitiveProps,
  type DialogContentProps as DialogContentPrimitiveProps,
  type DialogDescriptionProps as DialogDescriptionPrimitiveProps,
  type DialogFooterProps as DialogFooterPrimitiveProps,
  type DialogHeaderProps as DialogHeaderPrimitiveProps,
  type DialogTitleProps as DialogTitlePrimitiveProps,
  type DialogTriggerProps as DialogTriggerPrimitiveProps,
  type DialogOverlayProps as DialogOverlayPrimitiveProps,
  type DialogCloseProps as DialogClosePrimitiveProps,
} from '@/src/components/animate-ui/primitives/radix/dialog';
import { cn } from '@/src/lib/utils';

type DialogProps = DialogPrimitiveProps;

function Dialog(props: DialogProps) {
  return <DialogPrimitive {...props} />;
}

type DialogTriggerProps = DialogTriggerPrimitiveProps;

function DialogTrigger(props: DialogTriggerProps) {
  return <DialogTriggerPrimitive {...props} />;
}

type DialogCloseProps = DialogClosePrimitiveProps;

function DialogClose(props: DialogCloseProps) {
  return <DialogClosePrimitive {...props} />;
}

type DialogOverlayProps = DialogOverlayPrimitiveProps & {
  /** Preserve a domain overlay's existing visual contract. */
  unstyled?: boolean;
};

const DialogOverlay = React.forwardRef<HTMLDivElement, DialogOverlayProps>(function DialogOverlay(
  { className, unstyled = false, ...props },
  ref,
) {
  return (
    <DialogOverlayPrimitive
      ref={ref}
      className={cn(!unstyled && 'fixed inset-0 z-50 bg-[var(--bg-overlay-scrim)]', className)}
      {...props}
    />
  );
});

type DialogContentProps = DialogContentPrimitiveProps & {
  /** Static by default. A caller must explicitly opt in to its own motion. */
  disableAnimation?: boolean;
  showCloseButton?: boolean;
  overlayClassName?: string;
  overlayStyle?: DialogOverlayProps['style'];
  /** Preserve a domain surface's established geometry while reusing Radix behavior. */
  unstyled?: boolean;
  /** Same as `unstyled`, but for the portal overlay. */
  overlayUnstyled?: boolean;
};

const DialogContent = React.forwardRef<HTMLDivElement, DialogContentProps>(function DialogContent({
  className,
  children,
  showCloseButton = true,
  overlayClassName,
  overlayStyle,
  unstyled = false,
  overlayUnstyled = unstyled,
  disableAnimation = true,
  style,
  layout,
  layoutId,
  ...props
}, ref) {
  return (
    <DialogPortalPrimitive>
      <DialogOverlay className={overlayClassName} style={{ ...overlayStyle, ...(disableAnimation ? { animation: 'none', transition: 'none' } : {}) }} unstyled={overlayUnstyled}
        {...(disableAnimation ? { initial: false, animate: { opacity: 1, filter: 'none' }, exit: { opacity: 1, filter: 'none' }, transition: { duration: 0 } } : {})} />
      <DialogContentPrimitive
        ref={ref}
        className={cn(
          !unstyled && 'bg-background fixed inset-0 z-50 m-auto grid h-fit w-full max-w-[calc(100%-2rem)] gap-4 rounded-lg border-0 p-6 shadow-lg outline-none sm:max-w-lg',
          className,
        )}
        {...props}
        style={{ ...style, ...(disableAnimation ? { animation: 'none', transition: 'none' } : {}) }}
        layout={disableAnimation ? false : layout}
        layoutId={disableAnimation ? undefined : layoutId}
        {...(disableAnimation ? { initial: false, animate: { opacity: 1, filter: 'none' }, exit: { opacity: 1, filter: 'none' }, transition: { duration: 0 } } : {})}
      >
        {children}
        {showCloseButton && (
          <DialogClosePrimitive className="ring-offset-background focus-visible:ring-ring data-[state=open]:bg-accent data-[state=open]:text-muted-foreground absolute top-4 right-4 rounded-xs opacity-70 transition-opacity hover:opacity-100 focus-visible:ring-2 focus-visible:ring-offset-2 focus:outline-hidden disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4">
            <XIcon />
            <span className="sr-only">Close</span>
          </DialogClosePrimitive>
        )}
      </DialogContentPrimitive>
    </DialogPortalPrimitive>
  );
});

type DialogHeaderProps = DialogHeaderPrimitiveProps;

function DialogHeader({ className, ...props }: DialogHeaderProps) {
  return (
    <DialogHeaderPrimitive
      className={cn('flex flex-col gap-2 text-center sm:text-left', className)}
      {...props}
    />
  );
}

type DialogFooterProps = DialogFooterPrimitiveProps;

function DialogFooter({ className, ...props }: DialogFooterProps) {
  return (
    <DialogFooterPrimitive
      className={cn(
        'flex flex-col-reverse gap-2 sm:flex-row sm:justify-end',
        className,
      )}
      {...props}
    />
  );
}

type DialogTitleProps = DialogTitlePrimitiveProps;

function DialogTitle({ className, ...props }: DialogTitleProps) {
  return (
    <DialogTitlePrimitive
      className={cn('text-lg leading-none font-semibold', className)}
      {...props}
    />
  );
}

type DialogDescriptionProps = DialogDescriptionPrimitiveProps;

function DialogDescription({ className, ...props }: DialogDescriptionProps) {
  return (
    <DialogDescriptionPrimitive
      className={cn('text-muted-foreground text-sm', className)}
      {...props}
    />
  );
}

export {
  Dialog,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
  type DialogProps,
  type DialogTriggerProps,
  type DialogCloseProps,
  type DialogContentProps,
  type DialogHeaderProps,
  type DialogFooterProps,
  type DialogTitleProps,
  type DialogDescriptionProps,
};
