import { useCallback, useEffect, useMemo, useRef, useState, type PropsWithChildren, type ReactNode } from 'react';
import { Button, Input, Select } from '@/src/components/ui';
import { createPortal } from 'react-dom';
import { EditorContent, useEditor } from '@tiptap/react';
import { Node as TiptapNode, mergeAttributes } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import TextAlign from '@tiptap/extension-text-align';
import DOMPurify from 'dompurify';

import { renderMarkdownToSafeHtml } from '../artifacts/markdown';
import { Icon, type IconName } from './Icon';
import { useT } from '../i18n';
import { MarkdownBlockMenu } from './MarkdownBlockMenu';
import blockStyles from './MarkdownBlockMenu.module.css';
import type {
  MarkdownTextSelectionAction,
  MarkdownTextSelectionContext,
} from './markdown-text-selection';

type MarkdownWordDocumentProps = {
  inline?: boolean;
  renderToolbar?: (toolbar: ReactNode) => ReactNode;
  onOpenDetail?: () => void;
  markdown: string;
  editable: boolean;
  onChange: (markdown: string) => void;
  resolveImageSource?: (source: string) => string;
  onTextAction?: (
    action: MarkdownTextSelectionAction,
    selection: MarkdownTextSelectionContext,
    instruction?: string,
  ) => void;
};

type MarkdownSelectionBubble = {
  selection: MarkdownTextSelectionContext;
  left: number;
  top: number;
  bottom: number;
};

type WordBlockStyle = 'paragraph' | 'heading-1' | 'heading-2' | 'heading-3' | 'blockquote' | 'codeBlock';

const WORD_ALLOWED_ATTRS = ['alt', 'class', 'colspan', 'data-markdown-source', 'href', 'rowspan', 'src', 'style', 'target', 'title'];
const WORD_ALLOWED_TAGS = [
  'a', 'blockquote', 'br', 'code', 'del', 'div', 'em', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'hr', 'img', 'li', 'ol', 'p', 'pre', 's', 'span', 'strong', 'table', 'tbody', 'td', 'th',
  'thead', 'tr', 'u', 'ul',
];

const MarkdownImage = TiptapNode.create({
  name: 'image',
  group: 'block',
  atom: true,
  draggable: true,
  addOptions() {
    return {
      resolveImageSource: (source: string) => source,
    };
  },
  addAttributes() {
    return {
      src: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-markdown-source') ?? element.getAttribute('src'),
      },
      alt: { default: null },
      title: { default: null },
    };
  },
  parseHTML() {
    return [{ tag: 'img[src]' }];
  },
  renderHTML({ HTMLAttributes }) {
    const source = typeof HTMLAttributes.src === 'string' ? HTMLAttributes.src : '';
    return ['img', mergeAttributes(HTMLAttributes, {
      src: this.options.resolveImageSource(source),
      'data-markdown-source': source,
    })];
  },
});

const AI_QUICK_ACTION_IDS = ['improve', 'fix', 'expand', 'shorten', 'translate', 'bullet'] as const;
type AiQuickActionId = (typeof AI_QUICK_ACTION_IDS)[number];
const AI_QUICK_ACTION_ICONS: Record<AiQuickActionId, IconName> = {
  improve: 'sparkles',
  fix: 'check',
  expand: 'edit',
  shorten: 'scissors',
  translate: 'languages',
  bullet: 'list',
};

export function MarkdownWordDocument({
  inline = false,
  renderToolbar = toolbar => toolbar,
  onOpenDetail,
  markdown,
  editable,
  onChange,
  resolveImageSource = (source) => source,
  onTextAction,
}: MarkdownWordDocumentProps) {
  const t = useT();
  const onChangeRef = useRef(onChange);
  const lastEmittedHtmlRef = useRef<string | null>(null);
  const [editorRevision, setEditorRevision] = useState(0);
  const [linkOpen, setLinkOpen] = useState(false);
  const [copyNotice, setCopyNotice] = useState('');
  const [linkValue, setLinkValue] = useState('');
  const [selectionBubble, setSelectionBubble] = useState<MarkdownSelectionBubble | null>(null);
  const [selectionEditOpen, setSelectionEditOpen] = useState(false);
  const [selectionEditDraft, setSelectionEditDraft] = useState('');
  const selectionEditOpenRef = useRef(false);
  const selectionEditInputRef = useRef<HTMLInputElement>(null);

  onChangeRef.current = onChange;

  const incomingHtml = useMemo(() => sanitizeMarkdownWordHtml(
    renderMarkdownToSafeHtml(markdown, { allowDangerousHtml: true }),
  ), [markdown]);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        link: {
          autolink: true,
          linkOnPaste: true,
          openOnClick: false,
          HTMLAttributes: { rel: 'noreferrer noopener', target: '_blank' },
        },
      }),
      MarkdownImage.configure({ resolveImageSource }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
    ],
    content: incomingHtml,
    editable,
    immediatelyRender: false,
    autofocus: inline ? 'end' : false,
    editorProps: {
      attributes: {
        class: 'markdown-rendered markdown-word-editor',
        'aria-label': t('doc.word.editor'),
        role: 'textbox',
        spellcheck: editable ? 'true' : 'false',
        'data-placeholder': t('doc.word.emptyHint'),
      },
      handleKeyDown: (_view, event) => {
        if (onTextAction && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
          event.preventDefault();
          if (editor && editable) {
            let bubble = selectionBubbleForEditor(editor);
            if (!bubble) {
              const { from } = editor.state.selection;
              const resolvedPos = editor.state.doc.resolve(from);
              const start = resolvedPos.start();
              const end = resolvedPos.end();
              if (end > start) {
                editor.commands.setTextSelection({ from: start, to: end });
                bubble = selectionBubbleForEditor(editor);
              }
            }
            if (bubble) {
              setSelectionBubble(bubble);
              selectionEditOpenRef.current = true;
              setSelectionEditDraft('');
              setSelectionEditOpen(true);
            }
          }
          return true;
        }
        return false;
      },
    },
    onCreate: () => setEditorRevision((revision) => revision + 1),
    onTransaction: ({ transaction }) => {
      // Cursor-only formatting changes stored marks without emitting an update
      // or moving the selection. Toolbar state must follow those changes too.
      if (transaction.docChanged || transaction.selectionSet || transaction.storedMarksSet) {
        setEditorRevision((revision) => revision + 1);
      }
    },
    onSelectionUpdate: ({ editor: nextEditor }) => {
      setSelectionBubble(editable && (!inline || onTextAction) ? selectionBubbleForEditor(nextEditor) : null);
    },
    onBlur: () => {
      if (!selectionEditOpenRef.current) setSelectionBubble(null);
    },
    onUpdate: ({ editor: nextEditor }) => {
      const sanitized = sanitizeMarkdownWordHtml(nextEditor.getHTML());
      lastEmittedHtmlRef.current = sanitized;
      onChangeRef.current(markdownFromWordHtml(sanitized));
    },
  });

  useEffect(() => {
    // Editability is UI state, not a document edit. Tiptap emits an update by
    // default here, which would serialize untouched Markdown and dirty it on open.
    editor?.setEditable(editable, false);
    if (!editable) {
      selectionEditOpenRef.current = false;
      setSelectionEditOpen(false);
      setSelectionEditDraft('');
      setSelectionBubble(null);
    }
  }, [editable, editor]);

  useEffect(() => {
    if (!selectionBubble || !editor) return undefined;
    const reposition = () => setSelectionBubble(selectionBubbleForEditor(editor));
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [editor, selectionBubble?.selection.from, selectionBubble?.selection.to]);

  useEffect(() => {
    selectionEditOpenRef.current = selectionEditOpen;
    if (!selectionEditOpen) return;
    const frame = window.requestAnimationFrame(() => selectionEditInputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [selectionEditOpen]);

  useEffect(() => {
    if (!editor || editor.isFocused) return;
    if (lastEmittedHtmlRef.current === incomingHtml) return;
    const current = sanitizeMarkdownWordHtml(editor.getHTML());
    if (current !== incomingHtml) editor.commands.setContent(incomingHtml, { emitUpdate: false });
  }, [editor, incomingHtml]);

  const run = useCallback((action: () => boolean) => {
    if (!editor || !editable) return;
    action();
    editor.commands.focus();
  }, [editable, editor]);

  const blockStyle = editor ? activeBlockStyle(editor, editorRevision) : 'paragraph';

  const openLinkEditor = useCallback(() => {
    if (!editor || !editable) return;
    setLinkValue(String(editor.getAttributes('link').href ?? ''));
    setLinkOpen(true);
  }, [editable, editor]);

  const applyLink = useCallback(() => {
    if (!editor || !editable) return;
    const href = normalizeDocumentLink(linkValue);
    if (!href) {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
    } else {
      editor.chain().focus().extendMarkRange('link').setLink({ href }).run();
    }
    setLinkOpen(false);
  }, [editable, editor, linkValue]);

  return (
    <section className={`markdown-word-pane${inline ? ' markdown-word-inline' : ''}`} aria-label={t('doc.word.editor')}>
      {editable && inline ? renderToolbar(
        <div className="markdown-word-floating-toolbar" role="toolbar" aria-label={t('doc.word.formatting')}
          onPointerDown={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()} onWheel={event => event.stopPropagation()}>
          {([1, 2, 3] as const).map(level => <WordToolButton key={level} label={t('doc.word.heading', { level })} active={editor?.isActive('heading', { level })} onClick={() => run(() => editor?.chain().focus().toggleHeading({ level }).run() ?? false)}><Icon name={`heading-${level}`} size={18} /></WordToolButton>)}
          <WordToolButton label={t('doc.word.body')} active={editor?.isActive('paragraph')} onClick={() => run(() => editor?.chain().focus().setParagraph().run() ?? false)}><Icon name="paragraph" size={18} /></WordToolButton>
          <WordToolbarDivider />
          <WordToolButton label={t('doc.word.bold')} active={editor?.isActive('bold')} onClick={() => run(() => editor?.chain().focus().toggleBold().run() ?? false)}><Icon name="bold" size={18} /></WordToolButton>
          <WordToolButton label={t('doc.word.italic')} active={editor?.isActive('italic')} onClick={() => run(() => editor?.chain().focus().toggleItalic().run() ?? false)}><Icon name="italic" size={18} /></WordToolButton>
          <WordToolbarDivider />
          <WordToolButton label={t('doc.word.bullet')} active={editor?.isActive('bulletList')} onClick={() => run(() => editor?.chain().focus().toggleBulletList().run() ?? false)}><Icon name="list" size={19} /></WordToolButton>
          <WordToolButton label={t('doc.word.ordered')} active={editor?.isActive('orderedList')} onClick={() => run(() => editor?.chain().focus().toggleOrderedList().run() ?? false)}><Icon name="list-ordered" size={19} /></WordToolButton>
          <WordToolbarDivider />
          <WordToolButton label={copyNotice || t('doc.word.copyAll')} onClick={() => { void navigator.clipboard.writeText(markdown).then(() => setCopyNotice(t('doc.word.copied')), () => setCopyNotice(t('doc.word.copyFailed'))); }}><Icon name="copy" size={19} /></WordToolButton>
          <WordToolButton label={t('doc.word.detail')} onClick={() => onOpenDetail?.()}><Icon name="maximize" size={19} /></WordToolButton>
        </div>
      ) : editable ? (
        <div className="markdown-word-toolbar" role="toolbar" aria-label={t('doc.word.formatting')}>
          {onOpenDetail && <Button type="button" variant="ghost" onClick={onOpenDetail}>{t('doc.word.detail')}</Button>}
          <div className="markdown-word-tool-group markdown-word-tool-group-style">
            <label className="markdown-word-style-select">
              <span className="sr-only">{t('doc.word.paragraphStyle')}</span>
              <Select
                aria-label={t('doc.word.paragraphStyle')}
                value={blockStyle}
                onChange={(event) => {
                  const value = event.currentTarget.value as WordBlockStyle;
                  run(() => editor ? applyBlockStyle(editor, value) : false);
                }}
              >
                <option value="paragraph">{t('doc.word.body')}</option>
                <option value="heading-1">{t('doc.word.heading', { level: 1 })}</option>
                <option value="heading-2">{t('doc.word.heading', { level: 2 })}</option>
                <option value="heading-3">{t('doc.word.heading', { level: 3 })}</option>
                <option value="blockquote">{t('doc.word.quote')}</option>
                <option value="codeBlock">{t('doc.word.codeBlock')}</option>
              </Select>
              <Icon name="chevron-down" size={13} />
            </label>
          </div>

          <WordToolbarDivider />
          <div className="markdown-word-tool-group">
            <WordToolButton label={t('doc.word.bold')} active={editor?.isActive('bold')} onClick={() => run(() => editor?.chain().focus().toggleBold().run() ?? false)}><Icon name="bold" size={15} /></WordToolButton>
            <WordToolButton label={t('doc.word.italic')} active={editor?.isActive('italic')} onClick={() => run(() => editor?.chain().focus().toggleItalic().run() ?? false)}><Icon name="italic" size={15} /></WordToolButton>
            <WordToolButton label={t('doc.word.underline')} active={editor?.isActive('underline')} className="markdown-word-tool-underline" onClick={() => run(() => editor?.chain().focus().toggleUnderline().run() ?? false)}>U</WordToolButton>
            <WordToolButton label={t('doc.word.strike')} active={editor?.isActive('strike')} className="markdown-word-tool-strike" onClick={() => run(() => editor?.chain().focus().toggleStrike().run() ?? false)}>S</WordToolButton>
            <WordToolButton label={t('doc.word.code')} active={editor?.isActive('code')} className="markdown-word-tool-code" onClick={() => run(() => editor?.chain().focus().toggleCode().run() ?? false)}>&lt;/&gt;</WordToolButton>
          </div>

          <WordToolbarDivider />
          <div className="markdown-word-tool-group">
            <WordToolButton label={t('doc.word.bullet')} active={editor?.isActive('bulletList')} onClick={() => run(() => editor?.chain().focus().toggleBulletList().run() ?? false)}><Icon name="list" size={16} /></WordToolButton>
            <WordToolButton label={t('doc.word.ordered')} active={editor?.isActive('orderedList')} onClick={() => run(() => editor?.chain().focus().toggleOrderedList().run() ?? false)}><Icon name="list-ordered" size={16} /></WordToolButton>
            <WordToolButton label={t('doc.word.quote')} active={editor?.isActive('blockquote')} className="markdown-word-tool-quote" onClick={() => run(() => editor?.chain().focus().toggleBlockquote().run() ?? false)}>“</WordToolButton>
            <WordToolButton label={t('doc.word.rule')} onClick={() => run(() => editor?.chain().focus().setHorizontalRule().run() ?? false)}><Icon name="minus" size={15} /></WordToolButton>
          </div>

          <WordToolbarDivider />
          <div className="markdown-word-tool-group">
            <WordToolButton label={t('doc.word.alignLeft')} active={editor?.isActive({ textAlign: 'left' })} onClick={() => run(() => editor?.chain().focus().setTextAlign('left').run() ?? false)}><AlignmentGlyph align="left" /></WordToolButton>
            <WordToolButton label={t('doc.word.alignCenter')} active={editor?.isActive({ textAlign: 'center' })} onClick={() => run(() => editor?.chain().focus().setTextAlign('center').run() ?? false)}><AlignmentGlyph align="center" /></WordToolButton>
            <WordToolButton label={t('doc.word.alignRight')} active={editor?.isActive({ textAlign: 'right' })} onClick={() => run(() => editor?.chain().focus().setTextAlign('right').run() ?? false)}><AlignmentGlyph align="right" /></WordToolButton>
            <WordToolButton label={t('doc.word.alignJustify')} active={editor?.isActive({ textAlign: 'justify' })} onClick={() => run(() => editor?.chain().focus().setTextAlign('justify').run() ?? false)}><AlignmentGlyph align="justify" /></WordToolButton>
          </div>

          <WordToolbarDivider />
          <div className="markdown-word-tool-group markdown-word-tool-group-actions">
            <div className="markdown-word-link-control">
              <WordToolButton label={t('doc.word.link')} active={editor?.isActive('link')} onClick={openLinkEditor}><Icon name="link" size={14} /></WordToolButton>
              {linkOpen ? (
                <form
                  className="markdown-word-link-popover"
                  onSubmit={(event) => {
                    event.preventDefault();
                    applyLink();
                  }}
                >
                  <label htmlFor="markdown-word-link-input">{t('doc.word.linkAddress')}</label>
                  <div>
                    <Input
                      id="markdown-word-link-input"
                      autoFocus
                      value={linkValue}
                      placeholder="https://example.com"
                      onChange={(event) => setLinkValue(event.currentTarget.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Escape') {
                          event.preventDefault();
                          setLinkOpen(false);
                          editor?.commands.focus();
                        }
                      }}
                    />
                    <Button type="submit">{t('doc.word.apply')}</Button>
                  </div>
                  <span>{t('doc.word.linkClearHint')}</span>
                </form>
              ) : null}
            </div>
            <WordToolButton label={t('doc.word.clear')} onClick={() => run(() => editor?.chain().focus().unsetAllMarks().clearNodes().run() ?? false)}>Tx</WordToolButton>
          </div>

          <span className="markdown-word-toolbar-spacer" />
          <div className="markdown-word-tool-group markdown-word-history">
            <WordToolButton label={t('doc.word.undo')} disabled={!editor?.can().undo()} onClick={() => run(() => editor?.chain().focus().undo().run() ?? false)}><Icon name="undo" size={15} /></WordToolButton>
            <WordToolButton label={t('doc.word.redo')} disabled={!editor?.can().redo()} onClick={() => run(() => editor?.chain().focus().redo().run() ?? false)}><Icon name="redo" size={15} /></WordToolButton>
          </div>
        </div>
      ) : null}

      <div className={`markdown-word-page-frame${editable && !inline && editor?.isEmpty ? ` ${blockStyles.emptyDocument}` : ''}`}>
        {editor ? <EditorContent editor={editor} /> : <div className="markdown-word-loading">{t('doc.word.opening')}</div>}
      </div>
      {editor && editable && !inline && <MarkdownBlockMenu editor={editor} />}
      {selectionBubble && editable && typeof document !== 'undefined'
        ? createPortal(
            selectionEditOpen && onTextAction ? (
              <div
                className="markdown-word-selection-editor-card"
                style={{
                  left: selectionEditorLeft(selectionBubble.left),
                  top: Math.min(selectionBubble.bottom + 12, window.innerHeight - 130),
                }}
              >
                <form
                  className="markdown-word-selection-editor"
                  aria-label={t('doc.word.editSelection')}
                  onSubmit={(event) => {
                    event.preventDefault();
                    const instruction = selectionEditDraft.trim();
                    if (!instruction) return;
                    onTextAction('edit', selectionBubble.selection, instruction);
                    selectionEditOpenRef.current = false;
                    setSelectionEditOpen(false);
                    setSelectionEditDraft('');
                    setSelectionBubble(null);
                  }}
                >
                  <div className="markdown-word-selection-editor-icon">
                    <Icon name="sparkles" size={15} />
                  </div>
                  <Input
                    ref={selectionEditInputRef}
                    aria-label={t('doc.word.describeEdit')}
                    value={selectionEditDraft}
                    placeholder={t('doc.word.editPlaceholder')}
                    onChange={(event) => setSelectionEditDraft(event.currentTarget.value)}
                    onKeyDown={(event) => {
                      if (event.key !== 'Escape') return;
                      event.preventDefault();
                      selectionEditOpenRef.current = false;
                      setSelectionEditOpen(false);
                      setSelectionEditDraft('');
                      setSelectionBubble(null);
                      editor?.commands.focus();
                    }}
                  />
                  <Button
                    type="submit"
                    aria-label={t('doc.word.submitEdit')}
                    disabled={!selectionEditDraft.trim()}
                  >
                    <Icon name="arrow-up" size={15} />
                  </Button>
                  <Button
                    type="button"
                    className="markdown-word-selection-cancel-btn"
                    aria-label={t('doc.word.cancelEdit')}
                    title={t('doc.word.cancelEdit')}
                    onClick={() => {
                      selectionEditOpenRef.current = false;
                      setSelectionEditOpen(false);
                      setSelectionEditDraft('');
                      setSelectionBubble(null);
                      editor?.commands.focus();
                    }}
                  >
                    <Icon name="close" size={13} />
                  </Button>
                </form>
                <div className="markdown-word-quick-chips" role="group" aria-label={t('doc.word.quickActions')}>
                  {AI_QUICK_ACTION_IDS.map((id) => (
                    <button
                      key={id}
                      type="button"
                      className="markdown-word-chip"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => {
                        onTextAction('edit', selectionBubble.selection, t(`doc.word.quick.${id}.prompt`));
                        selectionEditOpenRef.current = false;
                        setSelectionEditOpen(false);
                        setSelectionEditDraft('');
                        setSelectionBubble(null);
                      }}
                    >
                      <Icon name={AI_QUICK_ACTION_ICONS[id]} size={12} />
                      {t(`doc.word.quick.${id}.label`)}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div
                className="markdown-word-selection-actions"
                role="toolbar"
                aria-label={t('doc.word.selectionActions')}
                style={{ left: Math.min(Math.max(selectionBubble.left, Math.min(260, window.innerWidth / 2)), Math.max(window.innerWidth / 2, window.innerWidth - 260)), top: selectionBubble.top }}
              >
                {onTextAction && <>
                <Button
                  type="button"
                  className="markdown-word-selection-ai-btn"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    selectionEditOpenRef.current = true;
                    setSelectionEditDraft('');
                    setSelectionEditOpen(true);
                  }}
                >
                  <Icon name="sparkles" size={13} />
                  <span>{t('doc.word.rewrite')}</span>
                  <kbd className="markdown-word-ai-kbd">⌘K</kbd>
                </Button>
                <span aria-hidden />
                </>}
                <WordToolButton label={t('doc.word.bold')} active={editor?.isActive('bold')} onClick={() => run(() => editor?.chain().focus().toggleBold().run() ?? false)}><Icon name="bold" size={15} /></WordToolButton>
                <WordToolButton label={t('doc.word.italic')} active={editor?.isActive('italic')} onClick={() => run(() => editor?.chain().focus().toggleItalic().run() ?? false)}><Icon name="italic" size={15} /></WordToolButton>
                <WordToolButton label={t('doc.word.underline')} active={editor?.isActive('underline')} className="markdown-word-tool-underline" onClick={() => run(() => editor?.chain().focus().toggleUnderline().run() ?? false)}>U</WordToolButton>
                <WordToolButton label={t('doc.word.strike')} active={editor?.isActive('strike')} className="markdown-word-tool-strike" onClick={() => run(() => editor?.chain().focus().toggleStrike().run() ?? false)}>S</WordToolButton>
                <WordToolButton label={t('doc.word.code')} active={editor?.isActive('code')} className="markdown-word-tool-code" onClick={() => run(() => editor?.chain().focus().toggleCode().run() ?? false)}>&lt;/&gt;</WordToolButton>
                {onTextAction && <>
                <span aria-hidden />
                <Button
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    onTextAction('chat', selectionBubble.selection);
                    setSelectionBubble(null);
                  }}
                >
                  <Icon name="comment" size={14} />
                  {t('doc.word.addToChat')}
                </Button>
                </>}
              </div>
            ),
            document.body,
          )
        : null}
    </section>
  );
}

function selectionBubbleForEditor(
  editor: NonNullable<ReturnType<typeof useEditor>>,
): MarkdownSelectionBubble | null {
  const { from, to } = editor.state.selection;
  if (from === to) return null;
  const text = editor.state.doc.textBetween(from, to, '\n', '\n').trim();
  if (!text) return null;
  try {
    const start = editor.view.coordsAtPos(from);
    const end = editor.view.coordsAtPos(to);
    return {
      selection: {
        text,
        before: editor.state.doc.textBetween(Math.max(0, from - 180), from, '\n', '\n').trim(),
        after: editor.state.doc.textBetween(to, Math.min(editor.state.doc.content.size, to + 180), '\n', '\n').trim(),
        from,
        to,
      },
      left: Math.min(
        Math.max((start.left + end.right) / 2, 120),
        Math.max(120, window.innerWidth - 120),
      ),
      top: Math.max(52, Math.min(start.top, end.top) - 10),
      bottom: Math.max(start.bottom, end.bottom),
    };
  } catch {
    return null;
  }
}

function selectionEditorLeft(preferredLeft: number): number {
  const halfWidth = Math.min(236, window.innerWidth / 2);
  return Math.min(Math.max(preferredLeft, halfWidth), window.innerWidth - halfWidth);
}

function WordToolButton({
  active = false,
  className = '',
  disabled = false,
  label,
  onClick,
  children,
}: PropsWithChildren<{
  active?: boolean;
  className?: string;
  disabled?: boolean;
  label: string;
  onClick: () => void;
}>) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [tooltipPosition, setTooltipPosition] = useState<{ left: number; top: number } | null>(null);
  const showTooltip = useCallback(() => {
    const bounds = buttonRef.current?.getBoundingClientRect();
    if (!bounds) return;
    setTooltipPosition({
      left: Math.min(Math.max(bounds.left + (bounds.width / 2), 72), window.innerWidth - 72),
      top: bounds.bottom + 8,
    });
  }, []);
  const hideTooltip = useCallback(() => setTooltipPosition(null), []);

  return (
    <>
      <Button
        ref={buttonRef}
        type="button"
        className={`markdown-word-tool ${active ? 'is-active' : ''} ${className}`.trim()}
        aria-label={label}
        aria-pressed={active}
        disabled={disabled}
        onMouseEnter={showTooltip}
        onMouseLeave={hideTooltip}
        onFocus={showTooltip}
        onBlur={hideTooltip}
        onMouseDown={(event) => event.preventDefault()}
        onClick={onClick}
      >
        {children}
      </Button>
      {tooltipPosition && typeof document !== 'undefined'
        ? createPortal(
            <span
              className="markdown-word-tooltip"
              role="tooltip"
              style={{ left: tooltipPosition.left, top: tooltipPosition.top }}
            >
              {label}
            </span>,
            document.body,
          )
        : null}
    </>
  );
}

function WordToolbarDivider() {
  return <span className="markdown-word-toolbar-divider" aria-hidden />;
}

function AlignmentGlyph({ align }: { align: 'left' | 'center' | 'right' | 'justify' }) {
  return <span className={`markdown-word-align-glyph markdown-word-align-${align}`} aria-hidden><i /><i /><i /></span>;
}

function activeBlockStyle(editor: ReturnType<typeof useEditor>, revision: number): WordBlockStyle {
  void revision;
  if (editor?.isActive('heading', { level: 1 })) return 'heading-1';
  if (editor?.isActive('heading', { level: 2 })) return 'heading-2';
  if (editor?.isActive('heading', { level: 3 })) return 'heading-3';
  if (editor?.isActive('blockquote')) return 'blockquote';
  if (editor?.isActive('codeBlock')) return 'codeBlock';
  return 'paragraph';
}

function applyBlockStyle(editor: ReturnType<typeof useEditor>, style: WordBlockStyle): boolean {
  if (!editor) return false;
  if (style === 'heading-1') return editor.chain().focus().setHeading({ level: 1 }).run();
  if (style === 'heading-2') return editor.chain().focus().setHeading({ level: 2 }).run();
  if (style === 'heading-3') return editor.chain().focus().setHeading({ level: 3 }).run();
  if (style === 'blockquote') return editor.chain().focus().setBlockquote().run();
  if (style === 'codeBlock') return editor.chain().focus().setCodeBlock().run();
  return editor.chain().focus().setParagraph().run();
}

function normalizeDocumentLink(value: string): string | null {
  const href = value.trim();
  if (!href) return null;
  if (/^(?:https?:\/\/|mailto:|#|\/|\.\/|\.\.\/)/i.test(href)) return href;
  if (/^[a-z][a-z\d+.-]*:/i.test(href)) return null;
  return `https://${href}`;
}

export function sanitizeMarkdownWordHtml(html: string): string {
  const sanitized = DOMPurify.sanitize(html, {
    ALLOWED_ATTR: WORD_ALLOWED_ATTRS,
    ALLOWED_TAGS: WORD_ALLOWED_TAGS,
  }).trim();
  const root = document.createElement('div');
  root.innerHTML = sanitized;
  for (const element of root.querySelectorAll<HTMLElement>('[style]')) {
    const alignment = normalizedTextAlignment(element.style.textAlign);
    if (alignment) element.setAttribute('style', `text-align:${alignment}`);
    else element.removeAttribute('style');
  }
  return root.innerHTML.trim();
}

export function markdownFromWordHtml(html: string): string {
  const root = document.createElement('div');
  root.innerHTML = sanitizeMarkdownWordHtml(html);
  const blocks = Array.from(root.childNodes).map((node) => markdownFromWordNode(node, 0));
  return blocks
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\s+|\s+$/g, '')
    .concat(blocks.length > 0 ? '\n' : '');
}

function markdownFromWordNode(node: Node, listDepth: number): string {
  if (node.nodeType === Node.TEXT_NODE) return escapeWordMarkdownText(node.textContent ?? '');
  if (!(node instanceof HTMLElement)) return '';
  const tag = node.tagName.toLowerCase();
  const inline = () => Array.from(node.childNodes).map((child) => markdownFromWordNode(child, listDepth)).join('');
  const text = () => inline().trim();
  if (/^h[1-6]$/.test(tag)) {
    const content = text();
    const alignment = normalizedTextAlignment(node.style.textAlign);
    return alignment ? alignedBlockHtml(tag, alignment, node.innerHTML) : `${'#'.repeat(Number(tag[1]))} ${content}`;
  }
  if (tag === 'p' || tag === 'div') {
    const alignment = normalizedTextAlignment(node.style.textAlign);
    return alignment ? alignedBlockHtml('p', alignment, node.innerHTML) : text();
  }
  if (tag === 'br') return '  \n';
  if (tag === 'strong' || tag === 'b') return `**${inline()}**`;
  if (tag === 'em' || tag === 'i') return `*${inline()}*`;
  if (tag === 'u') return `<u>${sanitizeMarkdownWordHtml(node.innerHTML)}</u>`;
  if (tag === 'del' || tag === 's') return `~~${inline()}~~`;
  if (tag === 'code' && node.parentElement?.tagName.toLowerCase() !== 'pre') return `\`${inline()}\``;
  if (tag === 'a') {
    const href = normalizeDocumentLink(node.getAttribute('href') ?? '');
    return href ? `[${inline()}](${href})` : inline();
  }
  if (tag === 'img') {
    const src = (node.getAttribute('data-markdown-source') ?? node.getAttribute('src'))?.trim();
    return src ? `![${node.getAttribute('alt') ?? ''}](${src})` : '';
  }
  if (tag === 'blockquote') return text().split('\n').map((line) => `> ${line}`).join('\n');
  if (tag === 'pre') return `\`\`\`\n${node.textContent?.replace(/\n$/, '') ?? ''}\n\`\`\``;
  if (tag === 'ul' || tag === 'ol') {
    return Array.from(node.children)
      .filter((child) => child.tagName.toLowerCase() === 'li')
      .map((child, index) => {
        const prefix = tag === 'ol' ? `${index + 1}. ` : '- ';
        return `${'  '.repeat(listDepth)}${prefix}${markdownFromWordNode(child, listDepth + 1).trim()}`;
      })
      .join('\n');
  }
  if (tag === 'li') return inline();
  if (tag === 'hr') return '---';
  return inline();
}

function normalizedTextAlignment(value: string): 'center' | 'right' | 'justify' | null {
  return value === 'center' || value === 'right' || value === 'justify' ? value : null;
}

function alignedBlockHtml(tag: string, alignment: 'center' | 'right' | 'justify', innerHtml: string): string {
  const safeTag = /^h[1-6]$/.test(tag) ? tag : 'p';
  return `<${safeTag} style="text-align:${alignment}">${sanitizeMarkdownWordHtml(innerHtml)}</${safeTag}>`;
}

function escapeWordMarkdownText(value: string): string {
  return value.replace(/([\\`*_{}\[\]])/g, '\\$1');
}
