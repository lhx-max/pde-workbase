import { randomUUID } from 'node:crypto';
import type { BezierHostBrowserCapture, BezierHostBrowserCaptureContext, BezierHostBrowserCaptureRecord } from '@bezier/host';
import { createBrowserAssetInspectorSessions } from './browser-asset-inspector.js';
import { startBrowserCaptureBridge, startBrowserDiscovery, type BrowserCaptureAcceptResult } from './browser-bridge.js';
import { isExtensionHeartbeatLive } from './browser-extension-heartbeat.js';
import { upsertCaptureRecord } from './browser-extension-records.js';

/** Original extension protocol behind the independent host's main-frame IPC
 * guard. Discovery grants no file/project/native access; each one-use receiver
 * can only save supplied content, or inspect an asset minted in this session. */
export function createBrowserExtensionHost(options: {
  alive(): boolean;
  send(channel: string, payload: unknown): void;
  confirmEnable(): Promise<boolean>;
  install(): Promise<{ ok: true; message: string } | { ok: false; reason: string }>;
  receiverOrigin(origin: string | null): void;
  startReceiver?: typeof startBrowserCaptureBridge;
  startDiscovery?: typeof startBrowserDiscovery;
}) {
  let context: BezierHostBrowserCaptureContext = { projectId: null, canWrite: false };
  let enabled = false, generation = 0, seenAt = 0;
  let discovery: Awaited<ReturnType<typeof startBrowserDiscovery>> | undefined;
  let receiver: Awaited<ReturnType<typeof startBrowserCaptureBridge>> | undefined;
  let starting: Promise<{ ok: true } | { ok: false; reason: string }> | undefined;
  let claiming = Promise.resolve<string | null>(null);
  let records: BezierHostBrowserCaptureRecord[] = [];
  const inspectors = createBrowserAssetInspectorSessions();
  const pending = new Map<string, { capture: BezierHostBrowserCapture; settle(result: BrowserCaptureAcceptResult): void }>();
  const status = () => ({ connected: enabled && isExtensionHeartbeatLive(seenAt || null, Date.now()),
    browserName: null, message: !enabled ? 'External capture is disabled. Enable it using Install extension.'
      : isExtensionHeartbeatLive(seenAt || null, Date.now()) ? 'Capture extension connected.' : 'Load the Canvas Workspace Capture extension in Chrome or Edge.' });
  const announce = () => { if (options.alive()) options.send('browser:extension-status', status()); };
  const readStatus = () => ({ connected: true as const, projectName: context.projectName ?? null,
    canWrite: enabled && options.alive() && context.canWrite, spaces: context.spaces ?? [], defaultSpaceId: context.defaultSpaceId, tags: context.tags ?? [] });
  const closeReceiver = () => { receiver?.close(); receiver = undefined; options.receiverOrigin(null); };
  const revoke = () => {
    generation++; closeReceiver(); inspectors.clear();
    for (const request of pending.values()) request.settle({ status: 'rejected', message: 'Capture session changed.' });
    pending.clear();
  };
  const deliver = (capture: BezierHostBrowserCapture): Promise<BrowserCaptureAcceptResult> => {
    if (!enabled || !options.alive() || !context.canWrite || pending.size) return Promise.resolve({ status: 'rejected', message: 'Capture receiver is unavailable or busy.' });
    return new Promise(resolve => {
      const timer = setTimeout(() => settle({ status: 'pending', message: 'Delivered; check the asset library for the persisted result.' }), 25000);
      const settle = (result: BrowserCaptureAcceptResult) => { clearTimeout(timer); pending.delete(capture.captureId); resolve(result); };
      pending.set(capture.captureId, { capture, settle });
      options.send('browser:capture-received', capture);
    });
  };
  const mint = async () => {
    if (!enabled || !options.alive() || !context.canWrite || pending.size) return null;
    const epoch = generation;
    closeReceiver();
    const next = await (options.startReceiver ?? startBrowserCaptureBridge)({ context: readStatus(),
      accept: async envelope => {
        if (epoch !== generation || envelope.intent !== 'save_personal_asset' || !['selection', 'image'].includes(envelope.kind)) return { status: 'rejected', message: 'Capture intent or session is unavailable.' };
        const result = await deliver({ captureId: envelope.captureId, kind: envelope.kind === 'image' ? 'image' : 'selection', intent: envelope.intent,
          source: envelope.source, selection: envelope.selection, resource: envelope.resource ? { ...envelope.resource, mime: envelope.payload?.mime ?? envelope.resource.mime ?? '' } : undefined, payload: envelope.payload,
          asset: envelope.asset, capturedAt: envelope.provenance.capturedAt });
        if (result.status === 'saved' && result.assetData && typeof result.assetData === 'object') {
          const id = (result.assetData as { asset?: { id?: unknown } }).asset?.id;
          if (typeof id === 'string' && epoch === generation) return { ...result, sessionId: inspectors.create(id) };
        }
        return result;
      },
      inspectAsset: async request => {
        if (epoch !== generation) return { status: 'rejected', message: 'Capture session expired.' };
        try { return await deliver({ captureId: randomUUID(), kind: 'selection', intent: 'inspect_personal_asset',
          source: { pageUrl: '' }, capturedAt: new Date().toISOString(), assetOperation: inspectors.resolve(request) }); }
        catch (error) { return { status: 'rejected', message: error instanceof Error ? error.message : 'Invalid inspector request.' }; }
      },
    });
    if (epoch !== generation || !enabled || !options.alive()) { next.close(); return null; }
    receiver = next; options.receiverOrigin(new URL(next.claim.uploadUrl).origin);
    return JSON.stringify(next.claim);
  };
  const start = () => starting ??= (async () => {
    if (enabled) return { ok: true as const };
    const epoch = generation;
    if (!await options.confirmEnable()) return { ok: false as const, reason: 'Cancelled.' };
    if (epoch !== generation || !options.alive()) return { ok: false as const, reason: 'Application document changed.' };
    enabled = true;
    try {
      const next = await (options.startDiscovery ?? startBrowserDiscovery)({ readStatus, mintClaim: () => {
        claiming = claiming.then(mint, mint); return claiming;
      }, onExtensionSeen: () => { seenAt = Date.now(); announce(); } });
      if (epoch !== generation || !enabled || !options.alive()) { next.close(); enabled = false; return { ok: false as const, reason: 'Application document changed.' }; }
      discovery = next; announce(); return { ok: true as const };
    } catch (error) { enabled = false; return { ok: false as const, reason: error instanceof Error ? error.message : 'Discovery unavailable.' }; }
  })().finally(() => { starting = undefined; });
  const stop = () => { enabled = false; seenAt = 0; revoke(); discovery?.close(); discovery = undefined; announce(); };
  return {
    start, stop, status, records: () => [...records],
    install: async () => { const result = await start(); return result.ok ? options.install() : result; },
    context(raw: unknown) {
      if (!raw || typeof raw !== 'object') throw new Error('Invalid capture context');
      const value = raw as BezierHostBrowserCaptureContext;
      if (typeof value.canWrite !== 'boolean' || value.projectId !== null && (typeof value.projectId !== 'string' || value.projectId.length > 256)) throw new Error('Invalid capture context');
      if (context.projectId !== value.projectId || !value.canWrite) revoke();
      context = { projectId: value.projectId, canWrite: value.canWrite,
        projectName: typeof value.projectName === 'string' ? value.projectName.slice(0, 256) : undefined,
        spaces: Array.isArray(value.spaces) ? value.spaces.filter(s => s && typeof s.id === 'string' && typeof s.name === 'string').slice(0, 500).map(s => ({ id: s.id.slice(0, 256), name: s.name.slice(0, 256) })) : [],
        tags: Array.isArray(value.tags) ? value.tags.filter(t => typeof t === 'string').slice(0, 1000).map(t => t.slice(0, 128)) : [],
        defaultSpaceId: typeof value.defaultSpaceId === 'string' ? value.defaultSpaceId.slice(0, 256) : undefined };
    },
    complete(raw: unknown) {
      if (!raw || typeof raw !== 'object' || !enabled || !options.alive()) return;
      const value = raw as { captureId: string; ok: boolean; message: string; assetData?: unknown };
      const entry = pending.get(value.captureId);
      if (!entry || typeof value.ok !== 'boolean' || typeof value.message !== 'string') return;
      const message = value.message.slice(0, 2048);
      entry.settle(value.ok ? { status: 'saved', message, assetData: value.assetData } : { status: 'rejected', message });
      if (entry.capture.assetOperation) return;
      const record: BezierHostBrowserCaptureRecord = { id: value.captureId, at: Date.now(), kind: entry.capture.kind,
        title: entry.capture.asset?.name || entry.capture.source.title || entry.capture.source.pageUrl,
        sourceUrl: entry.capture.source.pageUrl, ok: value.ok, message };
      records = upsertCaptureRecord(records, record); options.send('browser:capture-record', record);
    },
  };
}
