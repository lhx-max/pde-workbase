// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';

// Keep the real App and its providers, but isolate the canvas and HTTP boundary.
// No test mounts TooltipLayer itself: omitting the production mount must fail.
vi.mock('../src/components/FileWorkspace', () => ({
  FileWorkspace: () => <section>
    <button className="bezier-tooltip" data-tooltip="  画布资源  " title="画布资源">
      <span>资源</span>
    </button>
    <button className="bezier-tooltip" data-tooltip="收集网页" data-tooltip-placement="right">收集</button>
    <button className="bezier-tooltip" data-tooltip="   ">空提示</button>
  </section>,
}));
vi.mock('../src/providers/registry', () => ({
  requestJson: vi.fn(async () => ({ project: { id: 'tooltip-project', name: 'Tooltip test' } })),
}));
vi.mock('../src/index.css', () => ({}));

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function mountApp() {
  let view!: ReturnType<typeof render>;
  await act(async () => { view = render(<App projectId="tooltip-project" />); });
  return view;
}

describe('App global TooltipLayer contract', () => {
  it('renders hovered descendant content in one body portal using the existing CSS class', async () => {
    const view = await mountApp();
    const button = screen.getByRole('button', { name: '资源' });
    fireEvent.pointerOver(screen.getByText('资源'));
    const tooltip = screen.getByRole('tooltip');
    expect(tooltip.textContent).toBe('画布资源');
    expect(tooltip.className).toBe('bezier-tooltip-layer');
    expect(tooltip.parentElement).toBe(document.body);
    expect(view.container.contains(tooltip)).toBe(false);
    expect(tooltip.style.visibility).toBe('visible');
    expect(button.hasAttribute('title')).toBe(false);
    fireEvent.pointerOut(button, { relatedTarget: document.body });
    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(button.getAttribute('title')).toBe('画布资源');
    fireEvent.pointerOver(screen.getByRole('button', { name: '收集' }));
    expect(screen.getAllByRole('tooltip')).toHaveLength(1);
    expect(screen.getByRole('tooltip').textContent).toBe('收集网页');
  });

  it('dismisses activation and only restores focus tooltips for keyboard navigation', async () => {
    await mountApp();
    const button = screen.getByRole('button', { name: '资源' });
    fireEvent.pointerOver(button);
    expect(screen.getByRole('tooltip').textContent).toBe('画布资源');
    fireEvent.pointerDown(button);
    fireEvent.focusIn(button);
    expect(screen.queryByRole('tooltip')).toBeNull();
    fireEvent.keyDown(button, { key: 'h' });
    fireEvent.focusIn(button);
    expect(screen.queryByRole('tooltip')).toBeNull();
    fireEvent.keyDown(button, { key: 'Tab' });
    fireEvent.focusIn(button);
    expect(screen.getByRole('tooltip').textContent).toBe('画布资源');
    fireEvent.keyDown(button, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('hides expanded triggers and ignores empty tooltip content', async () => {
    await mountApp();
    const button = screen.getByRole('button', { name: '资源' });
    fireEvent.pointerOver(button);
    expect(screen.getByRole('tooltip').textContent).toBe('画布资源');
    await act(async () => { button.setAttribute('aria-expanded', 'true'); });
    expect(screen.queryByRole('tooltip')).toBeNull();
    fireEvent.pointerOver(button);
    expect(screen.queryByRole('tooltip')).toBeNull();
    fireEvent.pointerOver(screen.getByRole('button', { name: '空提示' }));
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('removes its portal and document input tracking when App unmounts', async () => {
    const prior = document.documentElement.getAttribute('data-input-modality');
    const view = await mountApp();
    fireEvent.pointerOver(screen.getByRole('button', { name: '资源' }));
    expect(screen.getByRole('tooltip').textContent).toBe('画布资源');
    view.unmount();
    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(document.documentElement.getAttribute('data-input-modality')).toBe(prior);
    fireEvent.pointerMove(document.body, { clientX: 10, clientY: 10 });
    expect(document.documentElement.getAttribute('data-input-modality')).toBe(prior);
  });
});
