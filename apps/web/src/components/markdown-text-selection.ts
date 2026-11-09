import { tActive } from '../i18n';
export type MarkdownTextSelectionAction = 'chat' | 'edit';

export type MarkdownTextSelectionContext = {
  text: string;
  before: string;
  after: string;
  from: number;
  to: number;
};

export function buildMarkdownTextSelectionPrompt(
  fileName: string,
  action: MarkdownTextSelectionAction,
  selection: MarkdownTextSelectionContext,
  editInstruction?: string,
): string {
  const quote = selection.text
    .trim()
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');
  if (action === 'edit') {
    const locator = buildSelectionLocator(selection);
    const instruction = editInstruction?.trim();
    return [
      tActive('doc.selection.editIntro', { name: fileName }),
      '',
      tActive('doc.selection.selected'),
      quote,
      ...(locator ? ['', tActive('doc.selection.locator'), locator] : []),
      ...(instruction ? ['', tActive('doc.selection.instruction', { instruction })] : []),
    ].join('\n');
  }
  return [
    tActive('doc.selection.about', { name: fileName }),
    '',
    quote,
    '',
  ].join('\n');
}

function buildSelectionLocator(selection: MarkdownTextSelectionContext): string {
  const before = compactLocator(selection.before, 'before');
  const after = compactLocator(selection.after, 'after');
  if (!before && !after) return '';
  return [before ? tActive('doc.selection.before', { text: before }) : '', after ? tActive('doc.selection.after', { text: after }) : '']
    .filter(Boolean)
    .join('\n');
}

function compactLocator(value: string, side: 'before' | 'after'): string {
  const compact = value.replace(/\s+/g, ' ').trim();
  if (!compact) return '';
  if (compact.length <= 80) return compact;
  return side === 'before' ? `...${compact.slice(-80)}` : `${compact.slice(0, 80)}...`;
}
