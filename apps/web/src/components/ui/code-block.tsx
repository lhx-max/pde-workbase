import { useT } from '../../i18n';
import { Check, Copy } from 'lucide-react';
import {
  useEffect,
  useRef,
  useState,
  type HTMLAttributes,
  type ReactNode,
} from 'react';

import { cn } from '@/src/lib/utils';

import { Button } from './button';

export interface CodeBlockProps extends Omit<HTMLAttributes<HTMLElement>, 'children'> {
  code: string;
  label?: string;
  children?: ReactNode;
  copyable?: boolean;
  copyLabel?: string;
  copiedLabel?: string;
  wrap?: boolean;
}

/**
 * Token-bound code surface for previews and read-only snippets.
 * Syntax highlighting stays with the caller through `children`; this component
 * owns the surface, label, scrolling, copy action and feedback.
 */
export function CodeBlock({
  code,
  label,
  children,
  copyable = true,
  copyLabel,
  copiedLabel,
  wrap = false,
  className,
  ...props
}: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const resetTimerRef = useRef<number | null>(null);
  const t = useT();
  const copyText = copyLabel ?? t('ui.copy');
  const copiedText = copiedLabel ?? t('ui.copied');

  useEffect(() => () => {
    if (resetTimerRef.current !== null) window.clearTimeout(resetTimerRef.current);
  }, []);

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      if (resetTimerRef.current !== null) window.clearTimeout(resetTimerRef.current);
      resetTimerRef.current = window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <section
      data-ui-code-block=""
      className={cn(
        'flex flex-col overflow-hidden rounded-[var(--radius-medium)] bg-bg-subtle text-text',
        className,
      )}
      {...props}
    >
      {label || copyable ? (
        <header className="flex min-h-9 items-center justify-between gap-3 px-3 py-1.5 text-[12px] text-text-muted">
          <span className="min-w-0 truncate font-medium">{label}</span>
          {copyable ? (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className="shrink-0 gap-1.5 px-1.5"
              onClick={() => void copyCode()}
              aria-label={copied ? copiedText : copyText}
              title={copied ? copiedText : copyText}
            >
              {copied ? <Check aria-hidden="true" size={13} /> : <Copy aria-hidden="true" size={13} />}
              <span>{copied ? copiedText : copyText}</span>
            </Button>
          ) : null}
        </header>
      ) : null}
      <pre
        className={cn(
          'm-0 min-h-0 flex-1 overflow-auto px-3 pb-3 pt-1 font-mono text-[12px] leading-5 text-text',
          wrap ? 'whitespace-pre-wrap break-words' : 'whitespace-pre',
        )}
      >
        <code>{children ?? code}</code>
      </pre>
    </section>
  );
}
