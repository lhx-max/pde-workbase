import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CanvasStateService } from '../src/canvas/state.js';
import { registerCardOp, listCardOps } from '../src/canvas/card-ops.js';

let root = '';
let canvas: CanvasStateService;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'canvas-pack-'));
  canvas = new CanvasStateService(() => root);
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

it('creates a custom card via node.create and runs its card.* op', async () => {
  registerCardOp('card.acme.product.refresh', async (node, params, ctx) => {
    expect(node.kind).toBe('card.acme.product');
    expect(ctx.projectId).toBe('p1');
    await ctx.files.write('p1', 'card-assets/product-c1.json', JSON.stringify({ refreshed: true }));
    return { data: { price: params.region === 'cn' ? 9.9 : 19.9 } };
  });
  const created = await canvas.applyOperations('p1', {
    operationId: 'op-create', baseRevision: 0,
    operations: [{ type: 'node.create', node: { id: 'c1', kind: 'card.acme.product', x: 10, y: 20, title: '商品', data: { sku: 'A1' } } }],
  });
  expect(created.receipt.status).toBe('applied');
  const rev = created.revision;
  const run = await canvas.applyOperations('p1', {
    operationId: 'op-refresh', baseRevision: rev,
    operations: [{ type: 'card.acme.product.refresh', nodeId: 'c1', params: { region: 'cn' } }],
  });
  const card = (run.state.workbenchBasicNodes as Record<string, unknown>[]).find(n => n.id === 'c1')!;
  expect((card.data as Record<string, unknown>).sku).toBe('A1'); // 原 data 保留
  expect((card.data as Record<string, unknown>).price).toBe(9.9); // handler 补丁合并
  expect(listCardOps()).toContain('card.acme.product.refresh');
});

it('rejects card ops whose kind prefix mismatches the target card', async () => {
  registerCardOp('card.acme.other.ping', () => ({ data: {} }));
  const created = await canvas.applyOperations('p1', {
    operationId: 'op-c2', baseRevision: 0,
    operations: [{ type: 'node.create', node: { id: 'c2', kind: 'card.acme.product', x: 0, y: 0 } }],
  });
  await expect(canvas.applyOperations('p1', {
    operationId: 'op-ping', baseRevision: created.revision,
    operations: [{ type: 'card.acme.other.ping', nodeId: 'c2' }],
  })).rejects.toMatchObject({ code: 'CANVAS_OPERATION_UNSUPPORTED' });
});

it('rejects unregistered card ops and unknown op types', async () => {
  const created = await canvas.applyOperations('p1', {
    operationId: 'op-c3', baseRevision: 0,
    operations: [{ type: 'node.create', node: { id: 'c3', kind: 'card.acme.product', x: 0, y: 0 } }],
  });
  await expect(canvas.applyOperations('p1', {
    operationId: 'op-x', baseRevision: created.revision,
    operations: [{ type: 'card.acme.product.unregistered', nodeId: 'c3' }],
  })).rejects.toMatchObject({ code: 'CANVAS_ACTION_NOT_FOUND' });
});
