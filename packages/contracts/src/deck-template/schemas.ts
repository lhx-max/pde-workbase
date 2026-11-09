import { z } from 'zod';
import { zodToJsonSchema, type PostProcessCallback } from 'zod-to-json-schema';

export const DeckIdSchema = z.string().max(64).regex(/^(?!(?:constructor|prototype)$)[a-z0-9]+(?:-[a-z0-9]+)*(?![\s\S])/);
export const DeckVersionSchema = z.string().max(256).regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?(?![\s\S])/);
// Percent escapes are forbidden too: consumers must never decode a second path identity.
export const DeckPathSchema = z.string().min(1).max(1024).regex(/^(?!\/)(?!.*(?:^|\/)\.{1,2}(?:\/|$))[^\\:%?#\u0000-\u001f\u007f-\u009f/]+(?:\/[^\\:%?#\u0000-\u001f\u007f-\u009f/]+)*(?![\s\S])/);
const htmlPath = DeckPathSchema.regex(/\.html$/);
const digest = z.string().regex(/^[a-fA-F0-9]{64}(?![\s\S])/);
const finite = z.number().finite();
const mark = z.enum(['strong', 'em']);
const marks = z.array(mark).max(2);
// Display strings must survive UTF8/HTML serialization without replacement characters.
const shortText = z.string().max(10000).regex(/^(?![\s\S]*[\uD800-\uDFFF])[^\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]*(?![\s\S])/u);
const base = { id: DeckIdSchema, required: z.boolean() };
const textLimits = { maxChars: z.number().int().positive().max(5000), maxLines: z.number().int().min(1).max(100) };
const textSlot = z.object({ ...base, kind: z.literal('text'), minChars: z.number().int().min(0), ...textLimits }).strict();
const richTextSlot = z.object({ ...base, kind: z.literal('richText'), ...textLimits, marks }).strict();
const imageSlot = z.object({ ...base, kind: z.literal('image'), fit: z.enum(['cover', 'contain']) }).strict();
const numberSlot = z.object({ ...base, kind: z.literal('number'), min: finite, max: finite, unit: shortText }).strict();
const fieldUnion = z.discriminatedUnion('kind', [textSlot, richTextSlot, imageSlot, numberSlot]);
const repeatSlot = z.object({ ...base, kind: z.literal('repeat'), minItems: z.number().int().min(0).max(50), maxItems: z.number().int().min(1).max(50), fields: z.array(fieldUnion).min(1).max(64) }).strict();
const tableSlot = z.object({ ...base, kind: z.literal('table'), minRows: z.number().int().min(0).max(100), maxRows: z.number().int().min(1).max(100), columns: z.array(z.object({ id: DeckIdSchema, label: shortText, type: z.enum(['text', 'number']) }).strict()).min(1).max(64) }).strict();
const barChartSlot = z.object({ ...base, kind: z.literal('barChart'), minItems: z.number().int().min(1).max(50), maxItems: z.number().int().min(1).max(50), maxValue: finite.positive(), unit: shortText }).strict();
type Path = (string | number)[];
function issue(ctx: z.RefinementCtx, path: Path, message: string): void {
  ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });
}
function unique(values: string[], ctx: z.RefinementCtx, path: Path): void {
  const seen = new Set<string>();
  values.forEach((value, i) => { if (seen.has(value)) issue(ctx, [...path, i], `Duplicate identifier or path: ${value}`); seen.add(value); });
}
const slotUnion = z.discriminatedUnion('kind', [textSlot, richTextSlot, imageSlot, numberSlot, repeatSlot, tableSlot, barChartSlot]);
function checkSlot(slot: z.infer<typeof slotUnion>, ctx: z.RefinementCtx, path: Path = []): void {
  const range = (min: number, max: number) => { if (min > max) issue(ctx, path, 'Minimum exceeds maximum'); };
  switch (slot.kind) {
    case 'text': range(slot.minChars, slot.maxChars); break;
    case 'richText': unique(slot.marks, ctx, [...path, 'marks']); break;
    case 'number': range(slot.min, slot.max); break;
    case 'repeat':
      range(slot.minItems, slot.maxItems);
      unique(slot.fields.map((field) => field.id), ctx, [...path, 'fields']);
      slot.fields.forEach((field, i) => checkSlot(field, ctx, [...path, 'fields', i]));
      break;
    case 'table': range(slot.minRows, slot.maxRows); unique(slot.columns.map((column) => column.id), ctx, [...path, 'columns']); break;
    case 'barChart': range(slot.minItems, slot.maxItems); break;
  }
}
export const RepeatFieldSchema = fieldUnion.superRefine((slot, ctx) => checkSlot(slot, ctx));
export const SlotSchema = slotUnion.superRefine((slot, ctx) => checkSlot(slot, ctx));
export type RepeatField = z.infer<typeof RepeatFieldSchema>;
export type Slot = z.infer<typeof SlotSchema>;
export const DeckAssetSchema = z.object({ id: DeckIdSchema, path: DeckPathSchema, kind: z.enum(['image', 'font', 'style']), sha256: digest, mime: z.string().min(1).max(256), license: shortText.nullable() }).strict();
export const DeckLayoutSchema = z.object({
  id: DeckIdSchema, role: z.enum(['cover', 'body', 'data', 'closing', 'reference']), fragment: htmlPath,
  guidance: z.string().max(2000).optional(),
  editability: z.enum(['editable', 'partial', 'static']), slots: z.array(SlotSchema).max(64), staticAssets: z.array(DeckIdSchema).max(256),
}).strict().superRefine((layout, ctx) => {
  unique(layout.slots.map((slot) => slot.id), ctx, ['slots']);
  unique(layout.staticAssets, ctx, ['staticAssets']);
  if (layout.editability === 'static' ? layout.slots.length !== 0 : layout.slots.length === 0) issue(ctx, ['slots'], 'Slots incompatible with editability');
  if (layout.editability === 'partial' && !layout.staticAssets.length) issue(ctx, ['staticAssets'], 'Partial layouts require static assets');
});
const localized = z.object({ 'zh-CN': shortText, en: shortText }).strict();
export const DeckTemplateSchema = z.object({
  format: z.literal('bd-deck-template'), schemaVersion: z.literal(1), id: DeckIdSchema, version: DeckVersionSchema,
  metadata: z.object({ name: localized, description: localized, style: z.string().max(1000).optional(), usage: z.string().max(1000).optional(), narrative: z.string().max(2000).optional(), rhythm: z.string().max(2000).optional() }).strict(),
  canvas: z.object({ width: z.number().int().min(320).max(4096), height: z.number().int().min(240).max(4096) }).strict(),
  runtime: z.object({ id: z.literal('bd-deck'), version: z.literal(1) }).strict(),
  entries: z.object({ seed: htmlPath, preview: htmlPath, example: DeckPathSchema.regex(/\.json$/) }).strict(),
  assets: z.array(DeckAssetSchema).max(256), layouts: z.array(DeckLayoutSchema).min(1).max(64),
  provenance: z.object({
    kind: z.enum(['html', 'page', 'image', 'pptx', 'authored']), sourceDigest: digest, normalizedDigest: digest, sourceLocator: shortText,
    observations: z.array(z.object({ target: shortText, status: z.enum(['observed', 'inferred', 'unknown']), note: shortText }).strict()).max(256),
    review: z.enum(['pending', 'verified']), distribution: z.enum(['private', 'permitted', 'unknown']),
  }).strict(),
  checks: z.object({ overflow: z.literal('reject'), network: z.literal('deny'), minFontPx: finite.min(12).max(40) }).strict(),
}).strict().superRefine((template, ctx) => {
  unique(template.assets.map((asset) => asset.id), ctx, ['assets']);
  unique(template.layouts.map((layout) => layout.id), ctx, ['layouts']);
  const paths = new Set<string>(['deck.manifest.json']);
  const path = (value: string, at: Path) => { const canonical = value.normalize('NFC').toLowerCase(); if (paths.has(canonical)) issue(ctx, at, 'Package paths must be unique, including case/Unicode aliases'); paths.add(canonical); };
  Object.entries(template.entries).forEach(([role, value]) => path(value, ['entries', role]));
  template.assets.forEach((asset, i) => path(asset.path, ['assets', i, 'path']));
  const images = new Set(template.assets.filter((asset) => asset.kind === 'image').map((asset) => asset.id));
  template.layouts.forEach((layout, i) => {
    path(layout.fragment, ['layouts', i, 'fragment']);
    layout.staticAssets.forEach((id, j) => { if (!images.has(id)) issue(ctx, ['layouts', i, 'staticAssets', j], 'Expected an image asset'); });
  });
});
export type DeckAsset = z.infer<typeof DeckAssetSchema>;
export type DeckLayout = z.infer<typeof DeckLayoutSchema>;
export type DeckTemplate = z.infer<typeof DeckTemplateSchema>;

// Finite-depth, bounded value grammar; no arbitrary JSON, nested repeats, HTML or code nodes.
export const RichTextValueSchema = z.array(z.object({ text: shortText, marks }).strict()).max(5000);
export const ImageValueSchema = z.object({ assetId: DeckIdSchema, alt: shortText }).strict();
const leafValue = z.union([shortText, finite, RichTextValueSchema, ImageValueSchema]);
const valuesRecord = <T extends z.ZodTypeAny>(value: T) => z.record(DeckIdSchema, value).superRefine((values, ctx) => {
  if (Object.keys(values).length > 64) issue(ctx, [], 'At most 64 fields allowed');
});
export const RepeatValueSchema = z.array(z.object({ key: DeckIdSchema, values: valuesRecord(leafValue) }).strict()).max(50);
export const TableValueSchema = z.array(z.object({ key: DeckIdSchema, cells: valuesRecord(z.union([shortText, finite])) }).strict()).max(100);
export const BarChartValueSchema = z.array(z.object({ key: DeckIdSchema, label: shortText, value: finite }).strict()).max(50);
export const DeckValueSchema = z.union([leafValue, RepeatValueSchema, TableValueSchema, BarChartValueSchema]);
export const DeckInstanceSchema = z.object({
  format: z.literal('bd-deck-instance'), schemaVersion: z.literal(1), template: z.object({ id: DeckIdSchema, version: DeckVersionSchema }).strict(),
  locale: z.enum(['zh-CN', 'en']),
  slides: z.array(z.object({ id: DeckIdSchema, layoutId: DeckIdSchema, values: valuesRecord(DeckValueSchema), notes: z.string().max(10000) }).strict()).min(1).max(100),
}).strict().superRefine((instance, ctx) => unique(instance.slides.map((slide) => slide.id), ctx, ['slides']));
export type RichTextValue = z.infer<typeof RichTextValueSchema>;
export type ImageValue = z.infer<typeof ImageValueSchema>;
export type RepeatValue = z.infer<typeof RepeatValueSchema>;
export type TableValue = z.infer<typeof TableValueSchema>;
export type BarChartValue = z.infer<typeof BarChartValueSchema>;
export type DeckValue = z.infer<typeof DeckValueSchema>;
export type DeckInstance = z.infer<typeof DeckInstanceSchema>;

export function parseDeckTemplate(input: unknown): DeckTemplate { return DeckTemplateSchema.parse(input); }

/** Structural JSON Schema cannot express template-dependent references or range comparisons. */
const boundedRecords: PostProcessCallback = (schema, definition) => schema && 'typeName' in definition && definition.typeName === 'ZodRecord' ? { ...schema, maxProperties: 64 } : schema;
export const DeckTemplateJsonSchema = zodToJsonSchema(DeckTemplateSchema, { name: 'DeckTemplate', target: 'jsonSchema7', postProcess: boundedRecords });
export const DeckInstanceJsonSchema = zodToJsonSchema(DeckInstanceSchema, { name: 'DeckInstance', target: 'jsonSchema7', postProcess: boundedRecords });

/** Text stays literal; escaping and visual overflow measurement belong to the consumer. */
export function parseDeckInstance(input: unknown, template: DeckTemplate): DeckInstance {
  const parsedTemplate = parseDeckTemplate(template);
  return DeckInstanceSchema.superRefine((instance, ctx) => {
    if (instance.template.id !== parsedTemplate.id || instance.template.version !== parsedTemplate.version) issue(ctx, ['template'], 'Template identity/version mismatch');
    const layouts = new Map(parsedTemplate.layouts.map((layout) => [layout.id, layout]));
    const images = new Set(parsedTemplate.assets.filter((asset) => asset.kind === 'image').map((asset) => asset.id));
    const parse = <T>(schema: z.ZodType<T>, value: unknown, path: Path): T | undefined => {
      const result = schema.safeParse(value);
      if (result.success) return result.data;
      result.error.issues.forEach((error) => ctx.addIssue({ ...error, path: [...path, ...error.path] }));
      return undefined;
    };
    const text = (value: string, min: number, max: number, lines: number, path: Path) => {
      const length = Array.from(value).length;
      if (length < min || length > max) issue(ctx, path, 'Text character count outside slot bounds');
      if (value.split(/\r\n|\r|\n/).length > lines) issue(ctx, path, 'Text line count exceeds slot limit');
    };
    const count = (length: number, min: number, max: number, path: Path) => { if (length < min || length > max) issue(ctx, path, 'Cardinality outside slot bounds'); };
    const validate = (slots: readonly Slot[], values: Record<string, unknown>, path: Path) => {
      const ids = new Set(slots.map((slot) => slot.id));
      Object.keys(values).forEach((id) => { if (!ids.has(id)) issue(ctx, [...path, id], 'Unknown slot'); });
      slots.forEach((slot) => {
        const at = [...path, slot.id];
        if (!Object.prototype.hasOwnProperty.call(values, slot.id)) {
          if (slot.required) issue(ctx, at, 'Required slot missing');
          return; // Optional omission is preserved; consumers remove the bound node.
        }
        const value = values[slot.id];
        switch (slot.kind) {
          case 'text': { const v = parse(shortText, value, at); if (v !== undefined) text(v, slot.minChars, slot.maxChars, slot.maxLines, at); break; }
          case 'richText': {
            const v = parse(RichTextValueSchema, value, at);
            if (v) {
              text(v.map((span) => span.text).join(''), 0, slot.maxChars, slot.maxLines, at);
              v.forEach((span, i) => { unique(span.marks, ctx, [...at, i, 'marks']); span.marks.forEach((m) => { if (!slot.marks.includes(m)) issue(ctx, [...at, i, 'marks'], 'Mark not allowed by slot'); }); });
            }
            break;
          }
          case 'image': { const v = parse(ImageValueSchema, value, at); if (v && !images.has(v.assetId)) issue(ctx, [...at, 'assetId'], 'Expected an image asset'); break; }
          case 'number': { const v = parse(finite, value, at); if (v !== undefined && (v < slot.min || v > slot.max)) issue(ctx, at, 'Number outside slot bounds'); break; }
          case 'repeat': {
            const v = parse(RepeatValueSchema, value, at);
            if (v) { count(v.length, slot.minItems, slot.maxItems, at); unique(v.map((item) => item.key), ctx, at); v.forEach((item, i) => validate(slot.fields, item.values, [...at, i, 'values'])); }
            break;
          }
          case 'table': {
            const v = parse(TableValueSchema, value, at);
            if (v) {
              count(v.length, slot.minRows, slot.maxRows, at); unique(v.map((row) => row.key), ctx, at);
              const columns = new Map(slot.columns.map((column) => [column.id, column.type]));
              v.forEach((row, i) => {
                Object.keys(row.cells).forEach((id) => { if (!columns.has(id)) issue(ctx, [...at, i, 'cells', id], 'Unknown column'); });
                columns.forEach((type, id) => { if (!Object.prototype.hasOwnProperty.call(row.cells, id) || typeof row.cells[id] !== (type === 'text' ? 'string' : 'number')) issue(ctx, [...at, i, 'cells', id], 'Missing or incorrectly typed cell'); });
              });
            }
            break;
          }
          case 'barChart': {
            const v = parse(BarChartValueSchema, value, at);
            if (v) { count(v.length, slot.minItems, slot.maxItems, at); unique(v.map((item) => item.key), ctx, at); v.forEach((item, i) => { if (item.value < 0 || item.value > slot.maxValue) issue(ctx, [...at, i, 'value'], 'Bar value outside slot bounds'); }); }
            break;
          }
        }
      });
    };
    instance.slides.forEach((slide, i) => {
      const layout = layouts.get(slide.layoutId);
      if (!layout) issue(ctx, ['slides', i, 'layoutId'], 'Unknown layout');
      else validate(layout.slots, slide.values, ['slides', i, 'values']);
    });
  }).parse(input);
}
