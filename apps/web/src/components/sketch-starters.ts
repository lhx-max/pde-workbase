import { convertToExcalidrawElements } from '@excalidraw/excalidraw';
import type { ExcalidrawElementSkeleton } from '@excalidraw/excalidraw/data/transform';
import { emptySketchScene, type ExcalidrawSketchScene } from './sketch-model';

export type SketchStarterKind = 'wireframe' | 'flowchart' | 'structure';

/** Creates an editable starter, without reading theme, locale, or editor state. */
export function createSketchStarter(
  kind: SketchStarterKind,
  labels: { screen: string; start: string; step: string; end: string; topic: string; branch: string },
  strokeColor: string,
): ExcalidrawSketchScene {
  const style = {
    strokeColor,
    backgroundColor: 'transparent',
    strokeWidth: 1.5,
    strokeStyle: 'solid' as const,
    fillStyle: 'solid' as const,
    roughness: 0,
    opacity: 100,
  };
  const box = (
    id: string,
    x: number,
    y: number,
    width: number,
    height: number,
    text?: string,
    type: 'rectangle' | 'ellipse' = 'rectangle',
  ): ExcalidrawElementSkeleton => ({
    ...style,
    id,
    type,
    x,
    y,
    width,
    height,
    roundness: type === 'rectangle' ? { type: 3 } : null,
    ...(text === undefined ? {} : {
      label: {
        text,
        fontSize: 18,
        fontFamily: 2,
        strokeColor,
        textAlign: 'center',
        verticalAlign: 'middle',
      },
    }),
  });
  const arrow = (
    start: string,
    end: string,
    x: number,
    y: number,
    dx: number,
    dy: number,
  ): ExcalidrawElementSkeleton => ({
    ...style,
    type: 'arrow',
    x,
    y,
    points: [[0, 0], [dx, dy]],
    start: { id: start },
    end: { id: end },
    startArrowhead: null,
    endArrowhead: 'arrow',
  });
  const line = (x: number, y: number, width: number): ExcalidrawElementSkeleton => ({
    ...style,
    type: 'line',
    x,
    y,
    width,
    height: 0,
    points: [[0, 0], [width, 0]],
    opacity: 45,
  });

  let skeletons: ExcalidrawElementSkeleton[];
  switch (kind) {
    case 'wireframe':
      skeletons = [
        box('screen', 0, 0, 440, 320),
        box('header', 24, 24, 392, 48, labels.screen),
        box('sidebar', 24, 96, 88, 200),
        line(40, 120, 56),
        line(40, 144, 40),
        line(40, 168, 48),
        box('content-left', 136, 96, 128, 112),
        box('content-right', 288, 96, 128, 112),
        line(136, 232, 280),
        line(136, 252, 192),
        box('action', 320, 272, 96, 24),
      ];
      break;
    case 'flowchart':
      skeletons = [
        box('start', 0, 0, 160, 80, labels.start, 'ellipse'),
        box('step', 240, 0, 160, 80, labels.step),
        box('end', 480, 0, 160, 80, labels.end, 'ellipse'),
        arrow('start', 'step', 168, 40, 64, 0),
        arrow('step', 'end', 408, 40, 64, 0),
      ];
      break;
    case 'structure':
      skeletons = [
        box('topic', 220, 0, 180, 64, labels.topic),
        box('branch-left', 0, 180, 180, 64, labels.branch),
        box('branch-center', 220, 180, 180, 64, labels.branch),
        box('branch-right', 440, 180, 180, 64, labels.branch),
        arrow('topic', 'branch-left', 260, 72, -170, 100),
        arrow('topic', 'branch-center', 310, 72, 0, 100),
        arrow('topic', 'branch-right', 360, 72, 170, 100),
      ];
      break;
  }

  return {
    ...emptySketchScene(),
    // Local skeleton IDs describe bindings only; each insertion gets fresh IDs,
    // including bound labels, and Excalidraw remaps all references together.
    elements: convertToExcalidrawElements(skeletons, { regenerateIds: true }),
  };
}
