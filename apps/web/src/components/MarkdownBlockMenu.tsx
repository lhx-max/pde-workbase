import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { Editor } from '@tiptap/core';
import { createPortal } from 'react-dom';
import { Button } from '@/src/components/ui';
import { Icon, type IconName } from './Icon';
import { useT } from '../i18n';
import styles from './MarkdownBlockMenu.module.css';

type BlockId = 'paragraph' | 'h1' | 'h2' | 'h3' | 'bullet' | 'ordered' | 'quote' | 'code' | 'divider';
type Trigger = { from: number; to: number; query: string; left: number; top: number };

/** Only transform top-level paragraphs; nested lists and code keep literal slashes. */
export function readBlockTrigger(editor: Editor): Trigger | null {
  const { empty, $from } = editor.state.selection;
  if (!editor.isEditable || !empty || $from.depth !== 1 || $from.parent.type.name !== 'paragraph') return null;
  if ($from.parentOffset !== $from.parent.content.size) return null;
  const text = $from.parent.textContent;
  if (!/^\/[^\s/]*$/.test(text)) return null;
  const coords = editor.view.coordsAtPos($from.pos);
  return { from: $from.start(), to: $from.pos, query: text.slice(1).toLowerCase(), left: coords.left, top: coords.bottom };
}

/** Delete the trigger and convert the block in a single undoable transaction. */
export function applyBlockCommand(editor: Editor, id: BlockId): boolean {
  const trigger = readBlockTrigger(editor);
  if (!trigger) return false;
  const chain = editor.chain().focus().deleteRange({ from: trigger.from, to: trigger.to });
  switch (id) {
    case 'paragraph': return chain.setParagraph().run();
    case 'h1': return chain.setHeading({ level: 1 }).run();
    case 'h2': return chain.setHeading({ level: 2 }).run();
    case 'h3': return chain.setHeading({ level: 3 }).run();
    case 'bullet': return chain.toggleBulletList().run();
    case 'ordered': return chain.toggleOrderedList().run();
    case 'quote': return chain.setBlockquote().run();
    case 'code': return chain.setCodeBlock().run();
    case 'divider': return chain.setHorizontalRule().run();
  }
}

export function MarkdownBlockMenu({ editor }: { editor: Editor }) {
  const t = useT();
  const id = useId();
  const menuRef = useRef<HTMLDivElement>(null);
  const [trigger, setTrigger] = useState<Trigger | null>(null);
  const [active, setActive] = useState(0);
  const dismissed = useRef<string | null>(null);
  const commands = useMemo<Array<{ id: BlockId; label: string; icon: IconName; keywords: string }>>(() => [
    { id: 'paragraph', label: t('doc.word.body'), icon: 'paragraph', keywords: 'text paragraph body' },
    ...([1, 2, 3] as const).map(level => ({ id: `h${level}` as BlockId, label: t('doc.word.heading', { level }), icon: `heading-${level}` as IconName, keywords: `h${level} heading${level}` })),
    { id: 'bullet', label: t('doc.word.bullet'), icon: 'list', keywords: 'bullet list' },
    { id: 'ordered', label: t('doc.word.ordered'), icon: 'list-ordered', keywords: 'number ordered list' },
    { id: 'quote', label: t('doc.word.quote'), icon: 'paragraph', keywords: 'quote blockquote' },
    { id: 'code', label: t('doc.word.codeBlock'), icon: 'terminal', keywords: 'code' },
    { id: 'divider', label: t('doc.word.rule'), icon: 'minus', keywords: 'divider rule hr' },
  ], [t]);
  const filtered = commands.filter(command => `${command.label} ${command.keywords}`.toLowerCase().includes(trigger?.query ?? ''));
  const current = useRef({ trigger, filtered, active });
  current.current = { trigger, filtered, active };

  useEffect(() => {
    const sync = () => {
      const next = editor.isFocused ? readBlockTrigger(editor) : null;
      const signature = next ? `${next.from}:${next.query}` : null;
      if (!next) dismissed.current = null;
      if (signature && signature === dismissed.current) return;
      if (next?.query !== current.current.trigger?.query) setActive(0);
      setTrigger(next);
    };
    const close = () => {
      const value = current.current.trigger;
      dismissed.current = value ? `${value.from}:${value.query}` : null;
      setTrigger(null);
    };
    const keydown = (event: KeyboardEvent) => {
      const state = current.current;
      if (!state.trigger || event.isComposing || event.keyCode === 229) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        close();
      } else if (['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key) && state.filtered.length) {
        event.preventDefault();
        event.stopPropagation();
        if (event.key === 'Enter') {
          const command = state.filtered[state.active % state.filtered.length];
          if (command) applyBlockCommand(editor, command.id);
          setTrigger(null);
        } else {
          setActive((state.active + (event.key === 'ArrowDown' ? 1 : -1) + state.filtered.length) % state.filtered.length);
        }
      }
    };
    const blur = () => setTrigger(null);
    editor.on('transaction', sync).on('focus', sync).on('blur', blur);
    const dom = editor.view.dom;
    dom.addEventListener('keydown', keydown, true);
    window.addEventListener('resize', close);
    const scroll = (event: Event) => {
      if (!(event.target instanceof Node) || !menuRef.current?.contains(event.target)) close();
    };
    window.addEventListener('scroll', scroll, true);
    sync();
    return () => {
      editor.off('transaction', sync).off('focus', sync).off('blur', blur);
      dom.removeEventListener('keydown', keydown, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', scroll, true);
    };
  }, [editor]);

  useEffect(() => {
    menuRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest' });
  }, [active, trigger?.query]);

  if (!trigger) return null;
  const height = Math.min(360, window.innerHeight - 24);
  const left = Math.max(12, Math.min(trigger.left, window.innerWidth - 292));
  const top = Math.max(12, Math.min(trigger.top + 8, window.innerHeight - height - 12));
  return createPortal(
    <div ref={menuRef} className={styles.menu} style={{ left, top, maxHeight: height }}>
      <div className={styles.header}>{t('doc.word.blocks')}</div>
      <div role="listbox" aria-label={t('doc.word.blocks')} aria-activedescendant={`${id}-${active}`}>
        {filtered.map((command, index) => (
          <Button key={command.id} id={`${id}-${index}`} type="button" role="option"
            aria-selected={index === active} className={styles.item}
            onMouseDown={event => event.preventDefault()}
            onMouseEnter={() => setActive(index)}
            onClick={() => { applyBlockCommand(editor, command.id); setTrigger(null); }}>
            <span className={styles.icon}><Icon name={command.icon} size={18} /></span>
            <span>{command.label}</span>
            <kbd>/{command.id}</kbd>
          </Button>
        ))}
        {!filtered.length && <div className={styles.empty}>{t('doc.word.noBlocks')}</div>}
      </div>
      <div className={styles.hint}>{t('doc.word.blockKeys')}</div>
    </div>, document.body,
  );
}
