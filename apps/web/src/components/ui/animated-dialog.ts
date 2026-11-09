// Stable DA-facing entry; the adapter owns cross-family nested layering.
export { DialogSurface } from './dialog-surface';
export {
  Dialog as DialogRoot,
  DialogTrigger,
  DialogClose as DialogDismiss,
  DialogHeader as AnimatedDialogHeader,
  DialogFooter as AnimatedDialogFooter,
  DialogTitle as AnimatedDialogTitle,
  DialogDescription as AnimatedDialogDescription,
  type DialogProps as DialogRootProps,
  type DialogTriggerProps,
  type DialogCloseProps as DialogDismissProps,
  type DialogContentProps as DialogSurfaceProps,
} from '@/src/components/animate-ui/components/radix/dialog';
