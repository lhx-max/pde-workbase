import { expect, it } from 'vitest';
import { acceptsCanvasGenerationPatch } from '../src/workbench/canvas-generation-patch';

it('settles only the originating running request', () => {
  const failed = { requestId: 'original', status: 'failed' };
  expect(acceptsCanvasGenerationPatch({ requestId: 'original', status: 'running' }, failed)).toBe(true);
  expect(acceptsCanvasGenerationPatch({ requestId: 'newer', status: 'running' }, failed)).toBe(false);
  expect(acceptsCanvasGenerationPatch(undefined, failed)).toBe(false);
});
it.each(['canceled', 'succeeded', 'failed'])('does not overwrite a terminal %s binding with an asynchronous failure', status => {
  expect(acceptsCanvasGenerationPatch({ requestId: 'original', status }, { requestId: 'original', status: 'failed' })).toBe(false);
});
it('preserves normal editing and explicitly started generation changes', () => {
  expect(acceptsCanvasGenerationPatch(undefined, undefined)).toBe(true);
  expect(acceptsCanvasGenerationPatch({ requestId: 'old', status: 'failed' }, { requestId: 'new', status: 'running' })).toBe(true);
});
