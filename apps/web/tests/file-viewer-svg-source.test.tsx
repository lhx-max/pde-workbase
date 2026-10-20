// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProjectFile } from '@bezier/contracts';
vi.mock('../src/components/HtmlViewer', () => ({ HtmlViewer: () => null }));
vi.mock('../src/providers/registry', async importOriginal => ({
  ...await importOriginal<typeof import('../src/providers/registry')>(),
  fetchProjectFileText: vi.fn(),
}));
import { FileViewer } from '../src/components/FileViewer';
import { fetchProjectFileText } from '../src/providers/registry';

const file: ProjectFile = { name: 'drawing.svg', path: 'drawing.svg', type: 'file', kind: 'image', mime: 'image/svg+xml', mtime: 1, size: 12 };
afterEach(() => { cleanup(); vi.mocked(fetchProjectFileText).mockReset(); });

describe('SVG source read failures', () => {
  it('shows the original unavailable state on rejection and supports reload recovery', async () => {
    vi.mocked(fetchProjectFileText).mockRejectedValueOnce(new Error('Read rejected'));
    render(<FileViewer projectId="project" file={file} />);
    fireEvent.click(screen.getByRole('button', { name: 'Code' }));
    expect(await screen.findByText(/Preview unavailable/)).toBeTruthy();
    vi.mocked(fetchProjectFileText).mockResolvedValueOnce('<svg>recovered</svg>');
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(await screen.findByText('<svg>recovered</svg>')).toBeTruthy();
  });

  it('ignores a cancelled previous source rejection after switching files', async () => {
    let rejectFirst!: (error: Error) => void;
    vi.mocked(fetchProjectFileText).mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectFirst = reject; }));
    const { rerender } = render(<FileViewer projectId="project" file={file} />);
    fireEvent.click(screen.getByRole('button', { name: 'Code' }));
    vi.mocked(fetchProjectFileText).mockResolvedValueOnce('<svg>current</svg>');
    rerender(<FileViewer projectId="project" file={{ ...file, name: 'current.svg' }} />);
    await screen.findByText('<svg>current</svg>');
    await act(async () => { rejectFirst(new Error('Late rejected read')); });
    expect(screen.getByText('<svg>current</svg>')).toBeTruthy();
    expect(screen.queryByText(/Preview unavailable/)).toBeNull();
  });
});
