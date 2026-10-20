import { afterEach, describe, expect, it, vi } from 'vitest';
import { configuredCanvasModels, getCanvasMediaSnapshot, refreshCanvasMediaCatalog } from '../src/platform/media-catalog';
import { setCanvasMediaPolicy } from '../src/platform/media-policy';
import { setCanvasHostContext } from '../src/platform/api-base';
import { visualModelToNativeMediaModel, resolveCompanionVisualModel } from '../src/workbench/visual-model-routing';
import { buildAnnotationRegeneratePatch } from '../src/workbench/annotation-regenerate';

const catalog = {
  providers: [
    { id: 'openai', integrated: true, capabilities: ['image'] },
    { id: 'custom-image', integrated: true, capabilities: ['image'] },
    { id: 'grok', integrated: true, capabilities: ['video'] },
    { id: 'stub', integrated: false, capabilities: ['image'] },
  ],
  image: [
    { id: 'codex-gpt-image-2', label: 'Codex', provider: 'codex', caps: ['t2i'] },
    { id: 'gpt-image-2', label: 'OpenAI', provider: 'openai', caps: ['t2i'] },
    { id: 'custom-image', label: 'Custom', provider: 'custom-image', caps: ['t2i'] },
    { id: 'stub-image', label: 'Stub', provider: 'stub', caps: ['t2i'] },
  ],
  video: [{ id: 'grok-video', label: 'Grok', provider: 'grok', caps: ['t2v'] }],
};
afterEach(() => { setCanvasMediaPolicy([]); vi.unstubAllGlobals(); });

describe('configuration-backed canvas media models', () => {
  it('accepts arbitrary host-advertised providers without a product allowlist', () => {
    const model = { id: 'vendor-z/model-42', label: 'External model', provider: 'vendor-z', caps: ['t2i'] };
    expect(configuredCanvasModels({
      providers: [{ id: 'vendor-z', integrated: true, capabilities: ['image'] }], image: [model],
    }, { providers: { 'vendor-z': { configured: true } } }, false).image).toEqual([model]);
    setCanvasMediaPolicy(['vendor-z']);
    expect(configuredCanvasModels({
      providers: [{ id: 'vendor-z', integrated: true, capabilities: ['image'] }], image: [model],
    }, { providers: { 'vendor-z': { configured: true } } }, false).image).toEqual([]);
  });
  it('preserves server-supported aspect ratios and video lengths', () => {
    const result = configuredCanvasModels({ ...catalog, aspects: ['4:3'], videoLengthsSec: [6, 12] }, {}, false);
    expect(result.aspects).toEqual(['4:3']);
    expect(result.videoLengthsSec).toEqual([6, 12]);
  });
  it('hides unconfigured APIs and absent Codex', () => {
    expect(configuredCanvasModels(catalog, {}, false).image.map(m => m.id)).toEqual([]);
  });
  it('offers only configured, integrated models for the requested surface', () => {
    const result = configuredCanvasModels(catalog, { providers: {
      openai: { configured: true }, grok: { configured: true }, stub: { configured: true },
      'custom-image': { configured: true, model: 'my-model' },
    } }, true);
    expect(result.image.map(m => m.id)).toEqual(['codex-gpt2', 'gpt-image-2', 'custom-image']);
    expect(result.image.at(-1)?.label).toContain('my-model');
    expect(result.video.map(m => m.id)).toEqual(['grok-video']);
  });
  it('applies product exclusions even to configured providers ', () => {
    setCanvasMediaPolicy(['enterprise', 'openai', 'codex']);
    expect(configuredCanvasModels(catalog, { providers: { openai: { configured: true } } }, true).image).toEqual([]);
  });
  it('keeps native IDs through generation and refreshes revoked configuration without fallback', async () => {
    setCanvasHostContext({ projectId: 'test' });
    let configured = true;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(
      url.endsWith('/models') ? catalog : url.endsWith('/agents') ? { agents: [] } : { providers: { openai: { configured } } },
    ), { status: 200 })));
    await refreshCanvasMediaCatalog();
    expect(visualModelToNativeMediaModel('gpt-image-2')).toBe('gpt-image-2');
    expect(() => visualModelToNativeMediaModel('gpt2')).toThrow();
    expect(() => visualModelToNativeMediaModel('gemini')).toThrow();
    expect(visualModelToNativeMediaModel('codex-gpt2')).toBe('codex-gpt-image-2');
    configured = false;
    await refreshCanvasMediaCatalog();
    expect(() => visualModelToNativeMediaModel('gpt-image-2')).toThrow();
  });
  it('preserves native IDs when continuing and annotating an image', () => {
    expect(resolveCompanionVisualModel('gpt-image-2', 'gpt2')).toBe('gpt-image-2');
    expect(buildAnnotationRegeneratePatch({ model: 'gpt-image-2' }, { name: 'ref.png', path: 'ref.png' }, 'edit').models).toEqual(['gpt-image-2']);
  });
  it('fails closed when configuration cannot be loaded', async () => {
    setCanvasHostContext({ projectId: 'test' });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 503 })));
    await refreshCanvasMediaCatalog();
    expect(getCanvasMediaSnapshot().image.map(model => model.id)).toEqual([]);
    expect(getCanvasMediaSnapshot().video).toEqual([]);
    expect(() => visualModelToNativeMediaModel('missing-model')).toThrow();
  });
  it('does not hide configured APIs when local CLI detection fails', async () => {
    setCanvasHostContext({ projectId: 'test' });
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/agents')) throw new Error('CLI detection offline');
      return new Response(JSON.stringify(url.endsWith('/models') ? catalog : { providers: { openai: { configured: true } } }));
    }));
    await refreshCanvasMediaCatalog();
    expect(getCanvasMediaSnapshot().image.map(model => model.id)).toEqual(['gpt-image-2']);
  });
});

