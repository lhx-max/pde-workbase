// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DirectorTools } from '../src/director/director-tools';
import type { DubbingPlayback } from '../src/dubbing-editor';

afterEach(() => cleanup());

function renderTools(playing: boolean, time = 0) {
  const playback = createRef<DubbingPlayback>() as { current: DubbingPlayback };
  playback.current = { play: vi.fn(async () => {}), stop: vi.fn(), seek: vi.fn() };
  render(<DirectorTools data={{}} mediaUrl={() => undefined} rows={[{ id: 'l1', text: '第一句', videoStartMs: 0, videoEndMs: 1000 }]} duration={5000}
    time={() => time} selectedId={null} select={vi.fn()} ranges={[]} setRanges={vi.fn()} mode="voice" setMode={vi.fn()}
    playback={playback} disabled={false} patch={() => true} playing={playing} />);
  return playback.current;
}

describe('播放键', () => {
  it('未播放时只有一个「播放」键，点击开始播放', () => {
    const playback = renderTools(false);
    expect(screen.queryByRole('button', { name: '暂停' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '播放' }));
    expect(playback.play).toHaveBeenCalledTimes(1);
    expect(playback.stop).not.toHaveBeenCalled();
  });

  it('播放中同一个键显示「暂停」，点击停止', () => {
    const playback = renderTools(true, 1200);
    expect(screen.queryByRole('button', { name: '播放' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '暂停' }));
    expect(playback.stop).toHaveBeenCalledTimes(1);
    expect(playback.play).not.toHaveBeenCalled();
  });

  it('播到结尾后再点播放从头开始', () => {
    const playback = renderTools(false, 5000);
    fireEvent.click(screen.getByRole('button', { name: '播放' }));
    expect(playback.seek).toHaveBeenCalledWith(0);
  });
});
