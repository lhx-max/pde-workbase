// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../src/i18n';
import { QuestionFormView, normalizeVisualStyleQuestionValue } from '../src/components/QuestionForm';
import type { QuestionForm } from '../src/artifacts/question-form';
import { visualStyleCardsForContext, type VisualStyleContext } from '../src/runtime/visual-style-catalog';
import { visualStyleCatalogZh } from '../src/runtime/visual-style-catalog.zh-CN';

const contexts: VisualStyleContext[] = ['deck', 'prototype', 'document', 'image', 'video'];
const form: QuestionForm = { id: 'styles', title: 'User request', questions: [{ id: 'tone', type: 'radio', label: 'User style question', options: [{ label: 'Custom English description', value: 'custom-value' }] }] };
afterEach(cleanup);

describe('first-party visual style catalog localization', () => {
  it.each(contexts)('localizes every %s title, description and preview label without changing identifiers', context => {
    const en = visualStyleCardsForContext(context);
    const zh = visualStyleCardsForContext(context, 'zh-CN');
    expect(visualStyleCardsForContext(context, 'en')).toEqual(en);
    expect(zh).toHaveLength(en.length);
    for (const [index, card] of zh.entries()) {
      expect(visualStyleCatalogZh[card.value]).toBeDefined();
      expect(card.title).toMatch(/\p{Script=Han}/u);
      expect(card.description).toMatch(/\p{Script=Han}/u);
      expect(card.preview.alt).toContain('风格预览');
      expect({ ...card, title: en[index]!.title, description: en[index]!.description, preview: { ...card.preview, alt: en[index]!.preview.alt } }).toEqual(en[index]);
    }
  });
  it('contains exactly the active catalog IDs', () => {
    const ids = contexts.flatMap(context => visualStyleCardsForContext(context).map(card => card.value));
    expect(Object.keys(visualStyleCatalogZh).sort()).toEqual(ids.sort());
  });
  it('renders Chinese cards while preserving user-provided headings', () => {
    render(<I18nProvider initial="zh-CN"><QuestionFormView form={form} visualStyleContext="deck" interactive onSubmit={vi.fn()}/></I18nProvider>);
    expect(screen.getByRole('radio', { name: '编辑叙事' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: '产品主题演讲' })).toBeTruthy();
    expect(screen.getByText('User request')).toBeTruthy();
    expect(screen.getByText('User style question')).toBeTruthy();
  });
  it('preserves explicitly selected English card labels', () => {
    render(<I18nProvider initial="en"><QuestionFormView form={form} visualStyleContext="deck" interactive onSubmit={vi.fn()}/></I18nProvider>);
    expect(screen.getByRole('radio', { name: 'Editorial narrative' })).toBeTruthy();
    expect(screen.queryByRole('radio', { name: '编辑叙事' })).toBeNull();
  });
  it('normalizes both localized built-in labels to the same stable ID and leaves custom answers alone', () => {
    const question = form.questions[0]!;
    expect(normalizeVisualStyleQuestionValue(question, '编辑叙事', 'deck')).toBe('deck-editorial-narrative');
    expect(normalizeVisualStyleQuestionValue(question, 'Editorial narrative', 'deck')).toBe('deck-editorial-narrative');
    expect(normalizeVisualStyleQuestionValue(question, 'My custom style', 'deck')).toBe('My custom style');
    expect(normalizeVisualStyleQuestionValue(question, 'Custom English description', 'deck')).toBe('custom-value');
  });
});
