import { describe, expect, it } from 'vitest';
import { Position, type Node } from '@xyflow/react';
import { canvasEdgeAnchor, canvasEdgeNodeStates } from '../src/workbench/canvas-edge-geometry';

const bounds = { measured: { width: 420, height: 520 }, internals: { positionAbsolute: { x: 100, y: 200 } } };
const fallback = { x: 552, y: 460 }; // Hover-only + is outside the card.
const node = (id: string, parentId?: string, extra: Partial<Node> = {}): Node => ({ id, parentId, position: { x: 0, y: 0 }, data: {}, ...extra });

describe('shared canvas edge geometry', () => {
  it('keeps default and legacy menu ports on the boundary without workflow metadata', () => {
    for (const handle of [undefined, null, '', 'radix-_r_2_', 'radix-:r1:']) {
      expect(canvasEdgeAnchor(bounds, handle, Position.Right, fallback)).toEqual({ x: 520, y: 460 });
      expect(canvasEdgeAnchor(bounds, handle, Position.Left, { x: 91, y: 460 })).toEqual({ x: 100, y: 460 });
    }
  });
  it('uses current absolute bounds after resize and parent rebase; zoom is not reapplied', () => {
    const moved = { measured: { width: 640, height: 300 }, internals: { positionAbsolute: { x: -80, y: 900 } } };
    expect(canvasEdgeAnchor(moved, null, Position.Right, fallback)).toEqual({ x: 560, y: 1050 });
    expect(canvasEdgeAnchor(moved, null, Position.Top, fallback)).toEqual({ x: 240, y: 900 });
    expect(canvasEdgeAnchor(moved, null, Position.Bottom, fallback)).toEqual({ x: 240, y: 1200 });
  });
  it('retains branch, result-item and relation ports instead of collapsing them to the card center', () => {
    for (const port of ['result-item:option-2', 'route-a', 'relation-left', 'relation-right']) {
      const itemPoint = { x: 504, y: 337 };
      expect(canvasEdgeAnchor(bounds, port, Position.Right, itemPoint)).toBe(itemPoint);
    }
  });
  it('uses the measured handle until node bounds are available', () => {
    for (const value of [undefined, { ...bounds, measured: {} }, { ...bounds, measured: { width: NaN, height: 100 } }]) {
      expect(canvasEdgeAnchor(value, null, Position.Right, fallback)).toBe(fallback);
    }
  });
  it('keeps edges above every group background, including selected nested groups', () => {
    const nodes = [node('child', 'nested'), node('nested', 'group'), node('group'), node('outside')];
    const states = canvasEdgeNodeStates(nodes, new Set(['group']));
    expect(states.get('group')?.z).toBe(1000);
    expect(states.get('child')).toMatchObject({ visible: true, related: true, z: 1002, edgeFloor: 1002 });
    expect(states.get('outside')).toMatchObject({ visible: true, related: false, edgeFloor: -1 });
    expect(canvasEdgeNodeStates([node('run', undefined, { zIndex: -1 }), node('child', 'run')], new Set()).get('child')?.edgeFloor).toBe(0);
  });
  it('hides edges through hidden or missing ancestors and restores them when expanded', () => {
    const nodes = [node('group', undefined, { hidden: true }), node('nested', 'group'), node('child', 'nested'), node('orphan', 'missing')];
    expect(canvasEdgeNodeStates(nodes, new Set()).get('child')?.visible).toBe(false);
    expect(canvasEdgeNodeStates(nodes, new Set()).get('orphan')?.visible).toBe(false);
    nodes[0] = node('group');
    expect(canvasEdgeNodeStates(nodes, new Set()).get('child')?.visible).toBe(true);
  });
});
