// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DocumentEditorPane, I18nProvider, MarkdownWordDocument } from '@doc/surface';
import '@doc/surface/styles.css';

// Exercise the installed package's public entry and transitive CSS modules,
// rather than aliasing its source or mocking the editor to hide import failures.
afterEach(cleanup);

describe('@doc/surface browser package', () => {
  it('exports the embedded document editor', () => {
    expect(DocumentEditorPane).toBeTypeOf('function');
  });

  it('renders the real rich-text component with the host React runtime', async () => {
    const onChange = vi.fn();
    render(
      <I18nProvider>
        <MarkdownWordDocument markdown="# Packaged document" editable={false} onChange={onChange} />
      </I18nProvider>,
    );

    expect(await screen.findByRole('heading', { name: 'Packaged document' })).toBeTruthy();
    expect(screen.getByRole('textbox').getAttribute('contenteditable')).toBe('false');
    expect(onChange).not.toHaveBeenCalled();
  });
});
