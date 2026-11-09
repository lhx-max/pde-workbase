import { useEffect, useSyncExternalStore } from 'react';
import { platformFetch } from './api-base';
import { isCanvasMediaProviderEnabled } from './media-policy';
import { cr } from '../locales/canvas-remainder';

export type CanvasMediaModel = { id: string; label: string; hint?: string; provider: string; caps: string[]; default?: boolean };
type Catalog = { aspects?: string[]; videoLengthsSec?: number[]; image?: CanvasMediaModel[]; video?: CanvasMediaModel[]; providers?: Array<{ id: string; integrated?: boolean; capabilities?: string[] }> };
type Config = { providers?: Record<string, { configured?: boolean; model?: string }> };
export type CanvasMediaSnapshot = { aspects?: string[]; videoLengthsSec?: number[]; image: CanvasMediaModel[]; video: CanvasMediaModel[]; ready: boolean };

const legacyImages: CanvasMediaModel[] = [];

/** Configuration is discovery, not proof that an upstream request will succeed. */
export function configuredCanvasModels(catalog: Catalog, config: Config, codexInstalled: boolean): CanvasMediaSnapshot {
  const select = (surface: 'image' | 'video') => (catalog[surface] ?? []).filter(model => {
    const provider = catalog.providers?.find(item => item.id === model.provider);
    if (!isCanvasMediaProviderEnabled(model.provider) || model.provider === 'hyperframes') return false;
    if (model.provider === 'codex') return surface === 'image' && codexInstalled;
    return provider?.integrated === true && provider.capabilities?.includes(surface) && config.providers?.[model.provider]?.configured === true;
  }).map(model => ({ ...model, id: model.id === 'codex-gpt-image-2' ? 'codex-gpt2' : model.id,
    label: model.provider === 'custom-image' && config.providers?.[model.provider]?.model
      ? cr().modelCustom(config.providers[model.provider]!.model!) : model.label }));
  return { image: [...legacyImages.filter(model => isCanvasMediaProviderEnabled(model.provider)), ...select('image')], video: select('video'), ready: true, ...(catalog.aspects ? { aspects: catalog.aspects } : {}), ...(catalog.videoLengthsSec ? { videoLengthsSec: catalog.videoLengthsSec } : {}) };
}

let snapshot: CanvasMediaSnapshot = { image: legacyImages, video: [], ready: false };
const listeners = new Set<() => void>();
let pending: Promise<void> | undefined;
let refreshAgain = false;
export function refreshCanvasMediaCatalog(): Promise<void> {
  if (pending) { refreshAgain = true; return pending; }
  pending = (async () => {
    try {
      const [models, config, agents] = await Promise.all([
        platformFetch('/api/media/models'), platformFetch('/api/media/config'), platformFetch('/api/agents').catch(() => null),
      ]);
      if (!models.ok || !config.ok) throw new Error('Media configuration unavailable');
      const agentData = agents?.ok ? await agents.json().catch(() => []) : [];
      const agentList = Array.isArray(agentData) ? agentData : agentData.agents ?? [];
      snapshot = configuredCanvasModels(await models.json(), await config.json(), agentList.some((agent: { id: string; available?: boolean }) => agent.id === 'codex' && agent.available));
    } catch {
      // Fail closed for configured APIs; never substitute another paid provider.
      snapshot = { image: legacyImages.filter(model => isCanvasMediaProviderEnabled(model.provider)), video: [], ready: true };
    }
    listeners.forEach(listener => listener());
  })().finally(() => {
    pending = undefined;
    if (refreshAgain) { refreshAgain = false; void refreshCanvasMediaCatalog(); }
  });
  return pending;
}
const subscribe = (listener: () => void) => {
  if (!listeners.size && typeof window !== 'undefined') {
    window.addEventListener('focus', refreshOnFocus);
    window.addEventListener('bezier:media-config-saved', refreshOnSave);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (!listeners.size && typeof window !== 'undefined') {
      window.removeEventListener('focus', refreshOnFocus);
      window.removeEventListener('bezier:media-config-saved', refreshOnSave);
    }
  };
};
function refreshOnFocus() { if (!pending) void refreshCanvasMediaCatalog(); }
function refreshOnSave() { void refreshCanvasMediaCatalog(); }
export function getCanvasMediaSnapshot(): CanvasMediaSnapshot { return snapshot; }
export function useCanvasMediaCatalog(): CanvasMediaSnapshot {
  const result = useSyncExternalStore(subscribe, getCanvasMediaSnapshot, getCanvasMediaSnapshot);
  useEffect(() => {
    if (listeners.size === 1 || !snapshot.ready) { if (!pending) void refreshCanvasMediaCatalog(); }
  }, []);
  return result;
}

export function useCanvasImageModels() {
  return useCanvasMediaCatalog().image.map(model => ({ value: model.id, label: model.label }));
}
