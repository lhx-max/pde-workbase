import { PROJECT_LAYOUT, type WorkspaceCollabContext } from '@bezier/contracts';
import { writeProjectBase64File, writeProjectTextFile } from '../providers/registry';

export interface BrowserCaptureSource { url?: string; projectId?: string }
export interface BrowserCaptureMetadata {
  name?: string; description?: string; tags?: string[]; style?: string; usage?: string; rating?: number; kind?: string; aiFill?: boolean;
  /** Stable for one confirmed capture, so a provenance retry does not duplicate bytes. */
  captureId?: string;
}
export interface BrowserSavedCapture { id: string; name: string }
export interface BrowserSaveDraft {
  name: string; filename: string; mime?: string; kind?: 'image' | 'video' | 'audio' | 'file' | 'text' | 'webpage';
  text?: string; url?: string; source?: BrowserCaptureSource; workspaceContext?: WorkspaceCollabContext | null;
  aiFill?: boolean; allowAiFill?: boolean; inspectAfterSave?: boolean;
  readContent?: (signal: AbortSignal) => Promise<Blob>;
}

/** Bound captured bytes to the originating project. Never route them through a
 * personal asset service. Metadata lives beside the original project artifact. */
export async function saveBrowserCaptureFile(file: File, source: BrowserCaptureSource, metadata: BrowserCaptureMetadata = {}, context?: WorkspaceCollabContext | null): Promise<{ asset: BrowserSavedCapture }> {
  if (!source.projectId) throw new Error('A project is required to save browser captures.');
  if (metadata.aiFill) throw new Error('AI metadata generation requires an Agent adapter.');
  const filename = file.name.replace(/[\x00-\x1f\x7f/\\:*?"<>|]/g, '_').replace(/^\.+/, '').trim().slice(0, 180) || 'resource';
  const captureId = metadata.captureId ?? crypto.randomUUID();
  if (!/^[a-zA-Z0-9-]{1,80}$/.test(captureId)) throw new Error('Invalid browser capture identity.');
  const path = `${PROJECT_LAYOUT.collected}/browser/${captureId}-${filename}`;
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
  const saved = await writeProjectBase64File(source.projectId, path, btoa(binary), context);
  if (!saved) throw new Error('Browser capture could not be saved.');
  // Two independently durable project writes, not an atomic multi-file transaction.
  // Never remove successfully captured bytes if provenance fails. Surface their
  // exact path and refresh assets even when the registry rejects (rather than
  // returning null), so the partial persisted outcome cannot be hidden.
  try {
    const provenance = await writeProjectTextFile(source.projectId, `${path}.source.json`, JSON.stringify({ schema: 'canvas-workspace.browser-capture.v1', file: saved.name, capturedAt: Date.now(), ...source, ...metadata }, null, 2), undefined, context);
    if (!provenance) throw new Error('Metadata write returned no file.');
  } catch (cause) {
    throw new Error(`Capture saved as ${saved.name}, but metadata could not be saved.`, { cause });
  } finally {
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('canvas-workspace:files-changed', { detail: { projectId: source.projectId } }));
  }
  return { asset: { id: saved.name, name: metadata.name || file.name } };
}
