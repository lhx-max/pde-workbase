import { describe, expect, expectTypeOf, it } from 'vitest';
import { z, ZodError } from 'zod';
import Ajv from 'ajv';
import { DECK_RESOURCE_LIMITS } from '../src/deck-template/transport.js';

import {
  DeckIdSchema, DeckPathSchema, DeckVersionSchema, SlotSchema, RepeatFieldSchema,
  DeckTemplateSchema, DeckInstanceSchema, DeckTemplateJsonSchema, DeckInstanceJsonSchema,
  parseDeckTemplate, parseDeckInstance,
  type DeckTemplate, type DeckInstance, type Slot, type DeckValue,
} from '../src/deck-template/schemas.js';

it('publishes immutable explicit resource budgets', () => {
  expect(DECK_RESOURCE_LIMITS).toEqual({
    fileBytes:4 * 1024 * 1024,packageBytes:24 * 1024 * 1024,
    renderedBytes:40 * 1024 * 1024,httpBytes:48 * 1024 * 1024,domNodes:20_000,
  });
  expect(Object.isFrozen(DECK_RESOURCE_LIMITS)).toBe(true);
});

function template(): DeckTemplate {
  return {
    format: 'bd-deck-template', schemaVersion: 1, id: 'quarterly-deck', version: '1.0.0',
    metadata: { name: { 'zh-CN': '季度', en: 'Quarterly' }, description: { 'zh-CN': '', en: '' } },
    canvas: { width: 1280, height: 720 }, runtime: { id: 'bd-deck', version: 1 },
    entries: { seed: 'seed.html', preview: 'preview.html', example: 'example.json' },
    assets: [
      { id: 'photo', path: 'assets/photo.png', kind: 'image', sha256: 'a'.repeat(64), mime: 'image/png', license: null },
      { id: 'font', path: 'assets/font.woff2', kind: 'font', sha256: 'b'.repeat(64), mime: 'font/woff2', license: 'OFL' },
    ],
    layouts: [{ id: 'overview', role: 'body', fragment: 'layouts/overview.html', editability: 'partial', staticAssets: ['photo'], slots: [
      { id: 'heading', kind: 'text', required: true, minChars: 1, maxChars: 10, maxLines: 2 },
      { id: 'body', kind: 'richText', required: true, maxChars: 100, maxLines: 3, marks: ['strong', 'em'] },
      { id: 'hero', kind: 'image', required: true, fit: 'cover' },
      { id: 'metric', kind: 'number', required: true, min: -5, max: 100, unit: '%' },
      { id: 'items', kind: 'repeat', required: true, minItems: 1, maxItems: 2, fields: [
        { id: 'title', kind: 'text', required: true, minChars: 1, maxChars: 10, maxLines: 1 },
        { id: 'detail', kind: 'richText', required: false, maxChars: 20, maxLines: 1, marks: ['em'] },
        { id: 'photo', kind: 'image', required: false, fit: 'contain' },
        { id: 'amount', kind: 'number', required: true, min: 0, max: 5, unit: '' },
      ] },
      { id: 'table', kind: 'table', required: true, minRows: 1, maxRows: 2, columns: [{ id: 'name', label: 'Name', type: 'text' }, { id: 'count', label: 'Count', type: 'number' }] },
      { id: 'bars', kind: 'barChart', required: true, minItems: 1, maxItems: 2, maxValue: 50, unit: '%' },
      { id: 'optional', kind: 'text', required: false, minChars: 0, maxChars: 10, maxLines: 1 },
    ] }],
    provenance: { kind: 'authored', sourceDigest: 'c'.repeat(64), normalizedDigest: 'd'.repeat(64), sourceLocator: 'local source', observations: [{ target: 'heading', status: 'unknown', note: '' }], review: 'pending', distribution: 'private' },
    checks: { overflow: 'reject', network: 'deny', minFontPx: 12 },
  };
}
function instance(): DeckInstance {
  return {
    format: 'bd-deck-instance', schemaVersion: 1, template: { id: 'quarterly-deck', version: '1.0.0' }, locale: 'zh-CN',
    slides: [{ id: 'summary-stable', layoutId: 'overview', notes: '', values: {
      heading: '你好🙂', body: [{ text: '<script>&literal</script>', marks: ['strong'] }], hero: { assetId: 'photo', alt: 'Photo' }, metric: 42,
      items: [{ key: 'item-stable', values: { title: 'Title', detail: [{ text: 'detail', marks: ['em'] }], photo: { assetId: 'photo', alt: '' }, amount: 3 } }],
      table: [{ key: 'row-stable', cells: { name: 'A', count: 1 } }], bars: [{ key: 'bar-stable', label: 'A', value: 20 }],
    } }],
  };
}
function withValue(id: string, value: unknown): unknown {
  const deck = instance();
  return { ...deck, slides: [{ ...deck.slides[0]!, values: { ...deck.slides[0]!.values, [id]: value } }] };
}
function withSlot(slot: unknown): unknown {
  const t = template();
  return { ...t, layouts: [{ ...t.layouts[0]!, slots: [slot] }] };
}
const textSlot = { id: 'title', kind: 'text', required: true, minChars: 0, maxChars: 10, maxLines: 1 } as const;

describe('deck template v1 structure', () => {
  it('exports inferred discriminated types and parses every supported slot/value', () => {
    expectTypeOf<DeckTemplate>().toEqualTypeOf<z.infer<typeof DeckTemplateSchema>>();
    expectTypeOf<DeckInstance>().toEqualTypeOf<z.infer<typeof DeckInstanceSchema>>();
    expectTypeOf<Extract<Slot, { kind: 'repeat' }>['fields'][number]['kind']>().toEqualTypeOf<'text' | 'richText' | 'image' | 'number'>();
    // @ts-expect-error executable payloads are not contract slot types
    const unsupported: Slot['kind'] = 'html';
    expect(unsupported).toBe('html');
    const parsed = parseDeckInstance(instance(), parseDeckTemplate(template()));
    expect(parsed).toEqual(instance());
    expect(parsed.slides[0]!.values).not.toHaveProperty('optional');
    expect(parsed.slides[0]!.values.body).toEqual([{ text: '<script>&literal</script>', marks: ['strong'] }]);
  });
  it.each(['\u0000', '\u0001', '\uD800', '\uDC00'])('rejects display text that cannot survive HTML serialization %j', value => {
    expect(() => parseDeckInstance(withValue('heading', value), template())).toThrow();
    expect(new Ajv({ strict: false }).compile(JSON.parse(JSON.stringify(DeckInstanceJsonSchema)))(withValue('heading', value))).toBe(false);
  });
  it('generates both JSON Schemas from the exported Zod source', () => {
    const ajv = new Ajv({ strict: false });
    const checkTemplate = ajv.compile(JSON.parse(JSON.stringify(DeckTemplateJsonSchema)));
    const checkInstance = ajv.compile(JSON.parse(JSON.stringify(DeckInstanceJsonSchema)));
    expect(checkTemplate(template())).toBe(true);
    expect(checkInstance(instance())).toBe(true);
    expect(checkTemplate({ ...template(), schemaVersion: 2 })).toBe(false);
    expect(checkTemplate(withSlot({ ...textSlot, id: 'constructor' }))).toBe(false);
    const tooMany = instance();
    tooMany.slides[0]!.values = Object.fromEntries(Array.from({ length: 65 }, (_, index) => [`key-${index}`, 'text']));
    expect(checkInstance(tooMany)).toBe(false);
    expect(DeckInstanceSchema.safeParse(tooMany).success).toBe(false);
    expect(checkInstance(withValue('constructor', 'bad'))).toBe(false);
    expect(DeckTemplateJsonSchema.definitions?.DeckTemplate).toMatchObject({ type: 'object', additionalProperties: false, required: expect.arrayContaining(['format', 'entries', 'layouts']) });
    expect(DeckInstanceJsonSchema.definitions?.DeckInstance).toMatchObject({ type: 'object', additionalProperties: false });
  });
  it.each(['', 'A', '-id', 'id-', 'id--bad', 'two words', 'a'.repeat(65), '__proto__', 'constructor', 'prototype', 'valid\n'])('rejects unsafe ID %j', (id) => expect(DeckIdSchema.safeParse(id).success).toBe(false));
  it.each(['0.0.0', '1.2.3', '1.2.3-alpha.1+build.007', '1.2.3-rc-1'])('accepts SemVer %s', (version) => expect(DeckVersionSchema.parse(version)).toBe(version));
  it.each(['1', '1.2', 'v1.2.3', '01.2.3', '1.02.3', '1.2.3-01', '1.2.3+', '1.2.3-', '1.2.3\n'])('rejects bad version %s', (version) => expect(DeckVersionSchema.safeParse(version).success).toBe(false));
  it.each(['/abs.html', '\\abs.html', 'C:seed.html', 'a\\b.html', 'a//b.html', './seed.html', 'a/../seed.html', 'a/./seed.html', 'a/', '..', '.', 'https://host/a', 'seed.html?q', 'seed.html#id', 'seed\u0000.html', 'seed\u0085.html', 'seed.html\n', '%2e%2e/a.html', 'a/%252f.html'])('rejects unsafe path %j', (path) => expect(DeckPathSchema.safeParse(path).success).toBe(false));
  it('accepts safe nested paths', () => expect(DeckPathSchema.parse('layouts/cover.v1.html')).toBe('layouts/cover.v1.html'));
  it.each([
    { ...textSlot, kind: 'html' }, { ...textSlot, html: '<b>bad</b>' }, { ...textSlot, minChars: 11 }, { ...textSlot, maxChars: 5001 },
    { ...textSlot, maxLines: 0 }, { ...textSlot, maxLines: 101 }, { ...textSlot, minChars: 0.5 },
    { id: 'n', kind: 'number', required: true, min: 1, max: 0, unit: '' },
    { id: 'n', kind: 'number', required: true, min: 0, max: Infinity, unit: '' },
    { id: 'r', kind: 'richText', required: true, maxChars: 2, maxLines: 1, marks: ['strong', 'strong'] },
    { id: 'r', kind: 'richText', required: true, maxChars: 2, maxLines: 1, marks: ['link'] },
    { id: 'r', kind: 'repeat', required: true, minItems: 2, maxItems: 1, fields: [textSlot] },
    { id: 'r', kind: 'repeat', required: true, minItems: 0, maxItems: 1, fields: [textSlot, textSlot] },
    { id: 'r', kind: 'repeat', required: true, minItems: 0, maxItems: 1, fields: [{ ...textSlot, minChars: 11 }] },
    { id: 'r', kind: 'repeat', required: true, minItems: 0, maxItems: 1, fields: [{ id: 'nested', kind: 'repeat', required: true, minItems: 0, maxItems: 1, fields: [textSlot] }] },
    { id: 't', kind: 'table', required: true, minRows: 2, maxRows: 1, columns: [{ id: 'x', label: '', type: 'text' }] },
    { id: 't', kind: 'table', required: true, minRows: 0, maxRows: 1, columns: [{ id: 'x', label: '', type: 'text' }, { id: 'x', label: '', type: 'number' }] },
    { id: 'b', kind: 'barChart', required: true, minItems: 2, maxItems: 1, maxValue: 1, unit: '' },
    { id: 'b', kind: 'barChart', required: true, minItems: 1, maxItems: 1, maxValue: 0, unit: '' },
  ])('rejects invalid slot definition %#', (slot) => {
    expect(SlotSchema.safeParse(slot).success).toBe(false);
    expect(() => parseDeckTemplate(withSlot(slot))).toThrow(ZodError);
  });
  it('validates standalone repeat field ranges', () => expect(RepeatFieldSchema.safeParse({ ...textSlot, minChars: 11 }).success).toBe(false));
  it.each([
    (t: DeckTemplate) => ({ ...t, extra: true }),
    (t: DeckTemplate) => ({ ...t, runtime: { ...t.runtime, code: 'x' } }),
    (t: DeckTemplate) => ({ ...t, metadata: { ...t.metadata, name: { ...t.metadata.name, fr: 'x' } } }),
    (t: DeckTemplate) => ({ ...t, schemaVersion: 2 }),
    (t: DeckTemplate) => ({ ...t, runtime: { id: 'reveal', version: 1 } }),
    (t: DeckTemplate) => ({ ...t, entries: { ...t.entries, seed: 'seed.js' } }),
    (t: DeckTemplate) => ({ ...t, entries: { ...t.entries, example: 'example.html' } }),
    (t: DeckTemplate) => ({ ...t, entries: { ...t.entries, preview: t.entries.seed } }),
    (t: DeckTemplate) => ({ ...t, layouts: [{ ...t.layouts[0], fragment: t.entries.seed }] }),
    (t: DeckTemplate) => ({ ...t, assets: [t.assets[0], t.assets[0]] }),
    (t: DeckTemplate) => ({ ...t, assets: [t.assets[0], { ...t.assets[1], path: t.assets[0]!.path }] }),
    (t: DeckTemplate) => ({ ...t, assets: [{ ...t.assets[0], sha256: 'not-a-digest' }] }),
    (t: DeckTemplate) => ({ ...t, assets: [{ ...t.assets[0], sha256: `${'a'.repeat(64)}\n` }] }),
    (t: DeckTemplate) => ({ ...t, assets: [{ ...t.assets[0], kind: 'script' }] }),
    (t: DeckTemplate) => ({ ...t, layouts: [t.layouts[0], t.layouts[0]] }),
    (t: DeckTemplate) => ({ ...t, layouts: [{ ...t.layouts[0], slots: [textSlot, textSlot] }] }),
    (t: DeckTemplate) => ({ ...t, layouts: [{ ...t.layouts[0], staticAssets: ['font'] }] }),
    (t: DeckTemplate) => ({ ...t, layouts: [{ ...t.layouts[0], staticAssets: ['missing'] }] }),
    (t: DeckTemplate) => ({ ...t, layouts: [{ ...t.layouts[0], staticAssets: ['photo', 'photo'] }] }),
    (t: DeckTemplate) => ({ ...t, layouts: [{ ...t.layouts[0], staticAssets: [] }] }),
    (t: DeckTemplate) => ({ ...t, layouts: [{ ...t.layouts[0], editability: 'static' }] }),
    (t: DeckTemplate) => ({ ...t, layouts: [{ ...t.layouts[0], editability: 'editable', slots: [] }] }),
    (t: DeckTemplate) => ({ ...t, provenance: { ...t.provenance, kind: 'pdf' } }),
    (t: DeckTemplate) => ({ ...t, provenance: { ...t.provenance, sourceDigest: '0' } }),
    (t: DeckTemplate) => ({ ...t, provenance: { ...t.provenance, normalizedDigest: 'g'.repeat(64) } }),
    (t: DeckTemplate) => ({ ...t, provenance: { ...t.provenance, observations: [{ target: '', status: 'trusted', note: '' }] } }),
    (t: DeckTemplate) => ({ ...t, canvas: { width: 319, height: 720 } }),
    (t: DeckTemplate) => ({ ...t, canvas: { width: 4097, height: 720 } }),
    (t: DeckTemplate) => ({ ...t, canvas: { width: 1280, height: 239 } }),
    (t: DeckTemplate) => ({ ...t, checks: { ...t.checks, minFontPx: 41 } }),
    (t: DeckTemplate) => ({ ...t, checks: { ...t.checks, network: 'allow' } }),
  ])('rejects strict shape and cross-reference violation %#', (mutate) => expect(() => parseDeckTemplate(mutate(template()))).toThrow(ZodError));
  it('leaves provenance publishing policy separate from static rendering', () => {
    const t = template();
    t.provenance.review = 'verified';
    t.provenance.distribution = 'unknown';
    t.layouts[0]!.editability = 'static';
    t.layouts[0]!.slots = [];
    expect(parseDeckTemplate(t)).toEqual(t);
    const d = instance(); d.slides[0]!.values = {};
    expect(parseDeckInstance(d, t)).toEqual(d);
  });
  it('bounds arrays independently of uniqueness', () => {
    const t = template();
    const assets = Array.from({ length: 257 }, (_, i) => ({ ...t.assets[0]!, id: `asset-${i}`, path: `a/${i}.png` }));
    const layouts = Array.from({ length: 65 }, (_, i) => ({ ...t.layouts[0]!, id: `layout-${i}`, fragment: `l/${i}.html` }));
    expect(() => parseDeckTemplate({ ...t, assets })).toThrow(ZodError);
    expect(() => parseDeckTemplate({ ...t, layouts })).toThrow(ZodError);
    expect(() => parseDeckTemplate({ ...t, layouts: [] })).toThrow(ZodError);
    expect(() => parseDeckTemplate({ ...t, layouts: [{ ...t.layouts[0], slots: Array.from({ length: 65 }, (_, i) => ({ ...textSlot, id: `s-${i}` })) }] })).toThrow(ZodError);
  });
});

describe('template-aware instance validation', () => {
  it.each([
    ['heading', 4], ['heading', ''], ['heading', 'a'.repeat(11)], ['heading', 'a\nb\nc'],
    ['body', 'not spans'], ['body', [{ text: 'a', marks: ['link'] }]], ['body', [{ text: 'a', marks: ['em', 'em'] }]],
    ['body', [{ text: 'a', marks: [], html: 'x' }]], ['body', [{ text: 'a'.repeat(101), marks: [] }]],
    ['body', [{ text: 'a\n', marks: [] }, { text: 'b\nc\nd', marks: [] }]],
    ['hero', { assetId: 'missing', alt: '' }], ['hero', { assetId: 'font', alt: '' }], ['hero', { assetId: 'photo', alt: '', src: 'https://example.com' }],
    ['metric', NaN], ['metric', Infinity], ['metric', -6], ['metric', 101], ['metric', '42'],
    ['items', []], ['items', [{ key: 'x', values: { title: 'x' } }]],
    ['items', [{ key: 'x', values: { title: 'x', amount: 6 } }]],
    ['items', [{ key: 'x', values: { title: 'x', amount: 1, photo: { assetId: 'font', alt: '' } } }]],
    ['items', [{ key: 'x', values: { title: 'x', amount: 1, detail: [{ text: 'x', marks: ['strong'] }] } }]],
    ['items', [{ key: 'x', values: { title: 'x', amount: 1, extra: 'no' } }]],
    ['items', [{ key: 'x', values: { title: 'x', amount: 1 } }, { key: 'x', values: { title: 'y', amount: 2 } }]],
    ['items', [{ key: 'x', values: { title: 'x', amount: 1, nested: [{ key: 'y', values: {} }] } }]],
    ['items', [{ key: 'bad key', values: { title: 'x', amount: 1 } }]],
    ['table', []], ['table', [{ key: 'x', cells: { name: 'a' } }]], ['table', [{ key: 'x', cells: { name: 'a', count: '1' } }]],
    ['table', [{ key: 'x', cells: { name: 1, count: 1 } }]], ['table', [{ key: 'x', cells: { name: 'a', count: 1, extra: 'x' } }]],
    ['table', [{ key: 'x', cells: { name: 'a', count: 1 } }, { key: 'x', cells: { name: 'b', count: 2 } }]],
    ['table', [{ key: 'x', cells: { name: 'a', count: Infinity } }]],
    ['bars', []], ['bars', [{ key: 'x', label: 'x', value: -1 }]], ['bars', [{ key: 'x', label: 'x', value: 51 }]],
    ['bars', [{ key: 'x', label: 'x', value: 1 }, { key: 'x', label: 'y', value: 2 }]],
    ['optional', null], ['optional', undefined], ['unknown', 'x'], ['heading', { html: '<b>x</b>' }],
    ['heading', () => 'x'], ['heading', Symbol('x')], ['heading', 1n],
  ])('rejects invalid %s value %#', (id, value) => expect(() => parseDeckInstance(withValue(id as string, value), template())).toThrow(ZodError));
  it('counts Unicode codepoints, including across rich text spans', () => {
    const t = template();
    t.layouts[0]!.slots[0] = { ...textSlot, id: 'heading', minChars: 2, maxChars: 2 };
    expect(() => parseDeckInstance(withValue('heading', '🙂🙂'), t)).not.toThrow();
    expect(() => parseDeckInstance(withValue('heading', '🙂'), t)).toThrow(ZodError);
    t.layouts[0]!.slots[1] = { id: 'body', kind: 'richText', required: true, maxChars: 2, maxLines: 1, marks: [] };
    const d = withValue('body', [{ text: '🙂', marks: [] }, { text: '🙂', marks: [] }]) as DeckInstance;
    d.slides[0]!.values.heading = '🙂🙂';
    expect(() => parseDeckInstance(d, t)).not.toThrow();
  });
  it('accepts inclusive numeric and cardinality boundaries', () => {
    const d = instance(); d.slides[0]!.values.metric = -5;
    d.slides[0]!.values.bars = [{ key: 'zero', label: '', value: 0 }, { key: 'max', label: '', value: 50 }];
    expect(() => parseDeckInstance(d, template())).not.toThrow();
  });
  it('rejects mismatching version, identity, unknown layout and duplicate slides', () => {
    const d = instance();
    for (const patch of [{ version: '1.0.1' }, { id: 'another' }]) expect(() => parseDeckInstance({ ...d, template: { ...d.template, ...patch } }, template())).toThrow(ZodError);
    expect(() => parseDeckInstance({ ...d, slides: [{ ...d.slides[0], layoutId: 'missing' }] }, template())).toThrow(ZodError);
    expect(() => parseDeckInstance({ ...d, slides: [d.slides[0], d.slides[0]] }, template())).toThrow(ZodError);
    expect(() => parseDeckInstance(d, { ...template(), version: 'invalid' })).toThrow(ZodError);
  });
  it('requires required fields and rejects unknown strict envelope fields', () => {
    const d = instance(); delete d.slides[0]!.values.heading;
    expect(() => parseDeckInstance(d, template())).toThrow(ZodError);
    expect(DeckInstanceSchema.safeParse({ ...instance(), code: 'x' }).success).toBe(false);
    expect(DeckInstanceSchema.safeParse({ ...instance(), template: { ...instance().template, source: 'x' } }).success).toBe(false);
    expect(DeckInstanceSchema.safeParse({ ...instance(), slides: [{ ...instance().slides[0], html: 'x' }] }).success).toBe(false);
  });
  it('bounds instance envelopes and collection counts', () => {
    const d = instance();
    expect(DeckInstanceSchema.safeParse({ ...d, slides: [] }).success).toBe(false);
    expect(DeckInstanceSchema.safeParse({ ...d, slides: Array.from({ length: 101 }, (_, i) => ({ ...d.slides[0], id: `s-${i}` })) }).success).toBe(false);
    expect(DeckInstanceSchema.safeParse({ ...d, slides: [{ ...d.slides[0], notes: 'a'.repeat(10001) }] }).success).toBe(false);
    for (const id of ['items', 'table', 'bars']) {
      const sample = (d.slides[0]!.values[id] as { key: string }[])[0]!;
      expect(() => parseDeckInstance(withValue(id, Array.from({ length: 3 }, (_, i) => ({ ...sample, key: `item-${i}` }))), template())).toThrow(ZodError);
    }
    const fields: Record<string, DeckValue> = Object.fromEntries(Array.from({ length: 65 }, (_, i) => [`s-${i}`, 'x']));
    expect(DeckInstanceSchema.safeParse({ ...d, slides: [{ ...d.slides[0], values: fields }] }).success).toBe(false);
  });
  it('reports semantic issues at the bound value path', () => {
    try { parseDeckInstance(withValue('hero', { assetId: 'font', alt: '' }), template()); throw new Error('Expected failure'); }
    catch (error) { expect(error).toBeInstanceOf(ZodError); expect((error as ZodError).issues).toEqual(expect.arrayContaining([expect.objectContaining({ path: ['slides', 0, 'values', 'hero', 'assetId'] })])); }
  });
});
