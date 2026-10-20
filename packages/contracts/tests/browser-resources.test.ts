import { describe, expect, it } from 'vitest';
import { BROWSER_RESOURCE_SORTS, filterBrowserResources, parseBrowserResourceCommand, type BrowserResourceItem } from '../src/api/browser-resources.js';

const grant = { sessionId: 'session-1', accessToken: 'native-secret', projectId: 'project-1' };
describe('browser resource command contract', () => {
  it.each(['start', 'snapshot', 'scan', 'stop'] as const)('accepts the narrow %s operation', action => {
    expect(parseBrowserResourceCommand({ ...grant, action, url: 'https://untrusted.test/private' })).toEqual({ ...grant, action });
  });
  it('accepts a read by opaque resource and document generation only', () => {
    expect(parseBrowserResourceCommand({ ...grant, action: 'read', resourceId: 'resource-1', navigationId: 4 }))
      .toEqual({ ...grant, action: 'read', resourceId: 'resource-1', navigationId: 4 });
  });
  it.each([null, [], {}, { ...grant, action: 'fetch' }, { ...grant, action: 'start', accessToken: '' },
    { ...grant, action: 'start', sessionId: 'x'.repeat(129) }, { ...grant, action: 'start', projectId: 'one\ntwo' },
    { ...grant, action: 'read', resourceId: 'id', navigationId: -1 }, { ...grant, action: 'read', resourceId: 'id', navigationId: Infinity },
    { ...grant, action: 'read', resourceId: 'id', navigationId: 1.5 }, { ...grant, action: 'read', resourceId: '', navigationId: 0 },
  ])('rejects malformed commands', value => { expect(() => parseBrowserResourceCommand(value)).toThrow('Invalid browser resource command'); });
});

describe('shared UI/CLI resource filters', () => {
  const items: BrowserResourceItem[] = [
    { id: 'a', kind: 'image', name: 'Hero.PNG', url: 'https://example.test/hero.png', size: 4096, width: 800, height: 500, mime: 'image/png', source: 'document', readable: true },
    { id: 'b', kind: 'video', name: 'clip.mp4', url: 'https://cdn.test/clip.mp4', size: 10000, source: 'network', readable: true },
    { id: 'c', kind: 'image', name: 'unknown.png', url: 'https://cdn.test/unknown.png', source: 'document', readable: true },
  ];
  it('filters consistently without mutating the capture', () => {
    expect(filterBrowserResources(items, { kind: 'image', query: 'HERO', minWidth: 500, minHeight: 500, minSize: 1024 })).toEqual([items[0]]);
    expect(filterBrowserResources(items, { query: 'cdn.test' })).toEqual([items[1], items[2]]);
    expect(items).toHaveLength(3);
  });
  it('orders by pixel area, then bytes, with unknown values last without mutating the input', () => {
    const small = { ...items[0]!, id: 'small', width: 1200, height: 800, size: 9000 };
    const large = { ...items[0]!, id: 'large', width: 2000, height: 1500, size: 1000 };
    const tie = { ...large, id: 'tie', size: 2000 };
    const unknown = { ...items[2]!, id: 'unknown' };
    const input = Object.freeze([unknown, small, items[1]!, large, tie]);
    expect(filterBrowserResources(input).map(item => item.id)).toEqual(['tie', 'large', 'small', 'b', 'unknown']);
    expect(input.map(item => item.id)).toEqual(['unknown', 'small', 'b', 'large', 'tie']);
  });
  it('keeps equal-ranked resources stable and does not rank invalid dimensions as large', () => {
    const invalid = { ...items[2]!, id: 'invalid', width: Infinity, height: 100 };
    const input = [invalid, { ...items[0]!, id: 'first' }, { ...items[0]!, id: 'second' }];
    expect(filterBrowserResources(input).map(item => item.id)).toEqual(['first', 'second', 'invalid']);
  });
  it('exports the supported sort choices for both clients', () => {
    expect(BROWSER_RESOURCE_SORTS).toEqual(['resolution', 'size-desc', 'size-asc', 'name']);
  });
  it.each([
    ['resolution', ['a', 'b', 'c']],
    ['size-desc', ['b', 'a', 'c']],
    ['size-asc', ['a', 'b', 'c']],
    ['name', ['b', 'a', 'c']],
  ] as const)('supports %s ordering without mutating the capture', (sort, expected) => {
    const input = Object.freeze([...items]);
    expect(filterBrowserResources(input, { sort }).map(item => item.id)).toEqual(expected);
    expect(input).toEqual(items);
  });
  it.each(['size-desc', 'size-asc'] as const)('puts unknown and invalid sizes last for %s, including after zero bytes', sort => {
    const input = [
      { ...items[2]!, id: 'unknown' }, { ...items[0]!, id: 'zero', size: 0 },
      { ...items[0]!, id: 'invalid', size: Infinity }, { ...items[0]!, id: 'negative', size: -1 },
      { ...items[0]!, id: 'first', name: 'z', width: 1, size: 10 }, { ...items[0]!, id: 'second', name: 'a', size: 10 },
      { ...items[0]!, id: 'nan', size: NaN },
    ];
    expect(filterBrowserResources(input, { sort }).map(item => item.id)).toEqual([
      ...(sort === 'size-desc' ? ['first', 'second', 'zero'] : ['zero', 'first', 'second']),
      'unknown', 'invalid', 'negative', 'nan',
    ]);
  });
  it('sorts names case-insensitively with deterministic ordering and stable ties', () => {
    const input = ['zebra', 'Beta', 'alpha', 'ALPHA', 'éclair', '中'].map((name, index) => ({ ...items[0]!, name, id: String(index) }));
    expect(filterBrowserResources(input, { sort: 'name' }).map(item => item.id)).toEqual(['2', '3', '1', '0', '4', '5']);
  });
  it.each(['resolution', 'size-desc', 'size-asc', 'name'] as const)('combines all filters with %s ordering', sort => {
    expect(filterBrowserResources(items, { sort, kind: 'image', query: 'HERO', minWidth: 500, minHeight: 500, minSize: 1024 })).toEqual([items[0]]);
  });
  it('does not pretend unknown dimensions or sizes satisfy a minimum', () => {
    expect(filterBrowserResources(items, { minWidth: 1 })).toEqual([items[0]]);
    expect(filterBrowserResources(items, { minSize: 1 })).toEqual([items[0], items[1]]);
    expect(filterBrowserResources(items, { kind: 'all' })).toEqual(items);
  });
});
