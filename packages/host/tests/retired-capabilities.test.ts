import { describe, expect, it } from 'vitest';
import * as hostApi from '../src/index.js';
import { createMockBezierHost } from '../src/testing.js';

describe('retired companion capability', () => {
  it('does not expose a pet capability or helper on new hosts', () => {
    expect(createMockBezierHost()).not.toHaveProperty('pet');
    expect(hostApi).not.toHaveProperty('setHostPetVisible');
  });
  it('recognizes desktop hosts without a retired companion bridge', () => {
    const host = {...createMockBezierHost()} as Record<string, unknown>;
    delete host.pet;
    expect(hostApi.isBezierHostBridge(host)).toBe(true);
    expect(hostApi.detectBezierHostClientType({[hostApi.BEZIER_HOST_GLOBAL]: host})).toBe('desktop');
  });
});
