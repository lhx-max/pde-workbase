import { assetInspectorCopy } from '../i18n/locales/asset-inspector-copy';
import { detectInitialLocale } from '../i18n';
import { PROJECT_LAYOUT, projectLayoutPath } from '@bezier/contracts';
import type { BezierHostBrowserCapture, BezierHostBrowserCaptureContext } from '@bezier/host';
import type { BrowserAssetInspectorData, BrowserAssetInspectorOperation, WorkspaceCollabContext } from '@bezier/contracts';
import { writeProjectTextFileDetailed } from '../providers/registry';
import { getActiveAssetLibraryAdapter, PersonalAssetRequestError, type AssetLibraryAdapter } from '../providers/asset-library';
const optionalAnalysisStatus = <T,>(request: Promise<T>): Promise<T | undefined> => request.catch(error => {
  if (error instanceof PersonalAssetRequestError && error.status === 503) return undefined;
  throw error;
});
import { randomUUID } from '../utils/uuid';
import { tActive } from '../i18n';

/**
 * Turns one already-parsed `BezierHostBrowserCapture` from the DA Browser
 * Extension bridge into durable storage.
 *
 * Two destinations, chosen by `intent`:
 * - `save_personal_asset` → the personal-asset library, via the same
 *   `assets.upload` the in-app SaveAssetDialog calls, so a capture
 *   from the browser is indistinguishable from one saved inside DA.
 * - anything else → a project file + `.source.json` sidecar under
 *   `inputs/collected/`, following the shared project layout.
 *
 * `selection` writes markdown; `image` writes the original picture bytes
 * through the same personal-asset upload the in-app dialog uses. Other
 * kinds are rejected instead of writing a partial file.
 */
export interface PersistBrowserCaptureResult {
  ok: boolean;
  message: string;
  files?: string[];
  assetData?: BrowserAssetInspectorData;
}

export async function persistBrowserCapture(
  projectId: string,
  capture: BezierHostBrowserCapture,
  workspaceContext?: WorkspaceCollabContext | null,
): Promise<PersistBrowserCaptureResult> {
  // An inspector transaction belongs to one source, including reads after writes.
  const assets = getActiveAssetLibraryAdapter();
  if (capture.assetOperation) {
    const operation = capture.assetOperation as BrowserAssetInspectorOperation;
    if (!operation.assetId || !['read','update','analyze','prompt'].includes(operation.action)) return {ok: false, message: assetInspectorCopy(detectInitialLocale()).invalidAction};
    try {
      if (operation.action === 'update') await assets.patch(operation.assetId, operation.patch ?? {});
      if (operation.action === 'analyze') await assets.analyze(operation.assetId);
      if (operation.action === 'prompt') await assets.generatePrompt(operation.assetId);
      const [assetResult, analysis, promptStatus] = await Promise.all([
        assets.get(operation.assetId), optionalAnalysisStatus(assets.analysisStatus(operation.assetId)), optionalAnalysisStatus(assets.promptStatus(operation.assetId)),
      ]);
      return {ok: true, message: assetInspectorCopy(detectInitialLocale()).updated, assetData: {asset: assetResult.asset, analysis, promptStatus}};
    } catch (error) {return {ok: false, message: error instanceof Error ? error.message : assetInspectorCopy(detectInitialLocale()).actionFailed};}
  }
  // `selection` and `image` are the two implemented kinds; anything else still
  // falls through to the project-file path which has no handler for it.
  if (capture.kind !== 'selection' && capture.kind !== 'image') {
    return { ok: false, message: tActive('browserCapture.unsupportedKind', { kind: capture.kind }) };
  }
  if (capture.kind === 'selection' && !capture.selection?.text) {
    return { ok: false, message: tActive('browserCapture.emptySelection') };
  }

  if (capture.intent === 'save_personal_asset') {
    return persistAsPersonalAsset(projectId, capture, assets);
  }

  const id = randomUUID();
  const fileName = projectLayoutPath(PROJECT_LAYOUT.collected, `selection-${id}.md`);
  const sidecarName = `${fileName}.source.json`;

  // The project-file (collected/) path only makes sense for a text selection;
  // an image capture routes through save_personal_asset above, so reaching
  // here without a selection is a protocol misuse rather than a missing file.
  if (!capture.selection?.text) {
    return { ok: false, message: tActive('browserCapture.emptySelection') };
  }
  const fileResult = await writeProjectTextFileDetailed(projectId, fileName, capture.selection.text, undefined, workspaceContext);
  if (!fileResult.ok) {
    return { ok: false, message: fileResult.message || tActive('browserCapture.selectionSaveFail') };
  }

  const sidecar = {
    schema: 'bezier-design.browser-capture.v1',
    captureId: capture.captureId,
    kind: capture.kind,
    intent: capture.intent,
    captureMode: 'selection',
    capturedAt: capture.capturedAt,
    source: capture.source,
  };
  const sidecarResult = await writeProjectTextFileDetailed(
    projectId,
    sidecarName,
    JSON.stringify(sidecar, null, 2),
    undefined,
    workspaceContext,
  );
  if (!sidecarResult.ok) {
    // Main file succeeded but the source record didn't: per the plan's §10.2
    // rule ("main file + sidecar together or it isn't complete"), this must
    // not be reported as a success even though the text file itself landed.
    return { ok: false, message: tActive('browserCapture.selectionMetaFail'), files: [fileName] };
  }

  return { ok: true, message: tActive('browserCapture.selectionSaved'), files: [fileName, sidecarName] };
}

/**
 * Saves the capture into the personal-asset library through the same upload
 * call the in-app SaveAssetDialog uses, so provenance, AI enrichment and space
 * placement behave identically no matter where the save was initiated.
 */
async function persistAsPersonalAsset(
  projectId: string,
  capture: BezierHostBrowserCapture,
  assets: AssetLibraryAdapter,
): Promise<PersistBrowserCaptureResult> {
  const built = personalAssetFileFrom(capture);
  if (!built.ok) return built;
  const meta = capture.asset;
  try {
    const { asset } = await assets.upload(
      built.file,
      null,
      { url: built.sourceUrl, projectId, filename: built.file.name },
      meta?.spaceId,
      {
        name: built.name,
        ...(meta?.description !== undefined ? { description: meta.description } : {}),
        ...(meta?.style !== undefined ? { style: meta.style } : {}),
        ...(meta?.usage !== undefined ? { usage: meta.usage } : {}),
        ...(meta?.tags !== undefined ? { tags: meta.tags } : {}),
        ...(meta?.rating !== undefined ? { rating: meta.rating } : {}),
        ...(meta?.aiFill !== undefined ? { aiFill: meta.aiFill } : {}),
        kind: built.kind,
        captureId: capture.captureId,
      },
    );
    return { ok: true, message: assetInspectorCopy(detectInitialLocale()).savedNamed(asset.name || built.name), assetData: {asset} };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : tActive('browserCapture.saveAssetFail') };
  }
}

function personalAssetFileFrom(capture: BezierHostBrowserCapture):
  | { ok: true; file: File; name: string; kind: 'text' | 'image'; sourceUrl: string }
  | { ok: false; message: string } {
  const meta = capture.asset;
  const safe = (raw: string, fallback: string) =>
    `${raw.replace(/[\\/:*?"<>|]/g, '_').slice(0, 120) || fallback}`;
  if (capture.kind === 'selection') {
    const text = capture.selection?.text ?? '';
    if (!text) return { ok: false, message: tActive('browserCapture.emptySelection') };
    const name = (meta?.name || capture.source.title || tActive('browserCapture.defaultSelectionName')).trim().slice(0, 240);
    const file = new File([text], `${safe(name, 'selection')}.md`, { type: 'text/markdown' });
    return { ok: true, file, name, kind: 'text', sourceUrl: capture.source.pageUrl };
  }
  if (capture.kind === 'image') {
    if (!capture.payload || !capture.resource) {
      return { ok: false, message: tActive('browserCapture.imageMissingResource') };
    }
    const bytes = capture.payload.bytes;
    if (!bytes || bytes.byteLength === 0) return { ok: false, message: tActive('browserCapture.imageMissingBytes') };
    const name = (meta?.name || capture.resource.alt || tActive('browserCapture.defaultImageName')).trim().slice(0, 240);
    const ext = (capture.payload.mime.split('/')[1] || 'bin').replace('jpeg', 'jpg');
    const file = new File([new Uint8Array(bytes).buffer], `${safe(name, 'image')}.${ext}`, { type: capture.payload.mime });
    return { ok: true, file, name, kind: 'image', sourceUrl: capture.resource.url };
  }
  return { ok: false, message: tActive('browserCapture.unsupportedKind', { kind: capture.kind }) };
}

/** Narrows renderer project/collab state into the minimal shape the main process needs. */
export function browserCaptureContextFrom(input: {
  projectId: string | null;
  projectName?: string;
  canWrite: boolean;
  spaces?: Array<{ id: string; name: string }>;
  defaultSpaceId?: string;
  tags?: string[];
}): BezierHostBrowserCaptureContext {
  return {
    projectId: input.projectId,
    ...(input.projectName !== undefined ? { projectName: input.projectName } : {}),
    canWrite: input.canWrite,
    ...(input.spaces !== undefined ? { spaces: input.spaces } : {}),
    ...(input.defaultSpaceId !== undefined ? { defaultSpaceId: input.defaultSpaceId } : {}),
    ...(input.tags !== undefined ? { tags: input.tags } : {}),
  };
}
