import { Background, BackgroundVariant, useStore } from '@xyflow/react';
import { canvasBackgroundMetrics } from './canvas-background';

/** Subscribe only this decoration to live zoom, not the canvas's node tree. */
export function AdaptiveCanvasBackground({ pattern }: { pattern: 'dots' | 'grid' }) {
  const zoom = useStore(state => state.transform[2]);
  const { layers, dotSize, lineWidth } = canvasBackgroundMetrics(zoom);
  const dots = pattern === 'dots';
  return <>{layers.map(layer => <Background
    key={layer.level}
    id={`adaptive-${pattern}-${layer.level}`}
    variant={dots ? BackgroundVariant.Dots : BackgroundVariant.Lines}
    gap={layer.gap}
    size={dotSize}
    lineWidth={lineWidth}
    // Explicit offsets align both levels with the same world origin.
    offset={dots ? dotSize / 2 : layer.gap / 2}
    color={dots
      ? 'color-mix(in srgb, var(--text-primary) 38%, transparent)'
      : 'color-mix(in srgb, var(--text-primary) 12%, transparent)'}
    bgColor="transparent"
    style={{ opacity: layer.opacity, pointerEvents: 'none' }}
    className="xy-background"
  />)}</>;
}
