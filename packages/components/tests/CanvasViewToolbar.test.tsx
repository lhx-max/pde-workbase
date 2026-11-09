// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CanvasViewToolbar } from '../src/canvas-view-toolbar';

afterEach(cleanup);
const zoomProps = () => ({ zoom: 1, minZoom: .1, maxZoom: 30, onZoomOut: vi.fn(), onZoomIn: vi.fn(), onZoomTo: vi.fn(), onFitView: vi.fn() });

describe('CanvasViewToolbar', () => {
  it('renders zoom/history without exposing background, tidy or connections', () => {
    const history = { canUndo: true, canRedo: false, onUndo: vi.fn(), onRedo: vi.fn() };
    render(<CanvasViewToolbar {...zoomProps()} history={history} />);
    expect(screen.queryByRole('button', { name: 'Tidy canvas' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Canvas display' })).toBeNull();
    expect(screen.queryByRole('button', { name: /connections/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    fireEvent.click(screen.getByRole('button', { name: 'Redo' }));
    expect(history.onUndo).toHaveBeenCalledOnce();
    expect(history.onRedo).not.toHaveBeenCalled();
  });
  it('keeps all the existing board controls when their capabilities are supplied', () => {
    render(<CanvasViewToolbar {...zoomProps()} tidyActions={[{ id: 'tidy', label: 'Arrange', icon: 'category', onSelect: vi.fn() }]}
      background="grid" tone="default" onBackgroundChange={vi.fn()} onToneChange={vi.fn()}
      connectionsVisible onConnectionsVisibleChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Tidy canvas' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Canvas display' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Hide connections' })).toBeTruthy();
  });
  it('accepts localized appearance copy and preserves controlled choices', () => {
    const props = {
      ...zoomProps(), onBackgroundChange: vi.fn(), onToneChange: vi.fn(),
      labels: {
        displaySettings: '画布显示设置', canvasSettings: '画布设置', closeSettings: '关闭画布设置',
        backgroundStyle: '背景样式', backgroundColor: '背景颜色',
        dots: '点阵', grid: '网格', none: '无', defaultTone: '默认', warmGray: '暖灰', coolGray: '冷灰',
      },
    };
    const { rerender } = render(<CanvasViewToolbar {...props} background="dots" tone="default" />);
    fireEvent.click(screen.getByRole('button', { name: '画布显示设置' }));
    expect(screen.getByText('画布设置')).toBeTruthy();
    expect(screen.queryByText('Canvas settings')).toBeNull();
    expect(screen.getByRole('group', { name: '背景样式' })).toBeTruthy();
    expect(screen.getByRole('group', { name: '背景颜色' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '点阵' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: '无' }));
    fireEvent.click(screen.getByRole('button', { name: '暖灰' }));
    expect(props.onBackgroundChange).toHaveBeenCalledWith('none');
    expect(props.onToneChange).toHaveBeenCalledWith('warm-gray');
    rerender(<CanvasViewToolbar {...props} background="none" tone="warm-gray" />);
    expect(screen.getByRole('button', { name: '无' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: '暖灰' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: '关闭画布设置' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('keeps one popover open and preserves tidy actions and outside dismissal', () => {
    const organize = vi.fn(); const restore = vi.fn();
    render(<CanvasViewToolbar {...zoomProps()} onBackgroundChange={vi.fn()} onToneChange={vi.fn()}
      labels={{ tidy: 'Organize board' }} tidyActions={[
        { id: 'flow', label: 'By flow', description: 'Keep connections', icon: 'connections', onSelect: organize },
        { id: 'restore', label: 'Restore', icon: 'revert', disabled: true, onSelect: restore },
      ]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Canvas display' }));
    fireEvent.click(screen.getByRole('button', { name: 'Organize board' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('menu', { name: 'Organize board' })).toBeTruthy();
    expect(screen.getByRole('separator')).toBeTruthy();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Restore' }));
    expect(restore).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('menuitem', { name: /By flow/ }));
    expect(organize).toHaveBeenCalledOnce();
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Organize board' }));
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
  });
  it('supports zoom presets, fit and escape using the same menu', () => {
    const props = zoomProps();
    render(<CanvasViewToolbar {...props} />);
    const trigger = screen.getByRole('button', { name: 'Zoom 100%. Open zoom menu' });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('menuitem', { name: '200%' }));
    expect(props.onZoomTo).toHaveBeenCalledWith(2);
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Fit to canvas' }));
    expect(props.onFitView).toHaveBeenCalledOnce();
    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});
