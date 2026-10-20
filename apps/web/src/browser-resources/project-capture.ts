import type { PersonalAsset, WorkspaceCollabContext } from '@bezier/contracts';
import { personalAssets } from '../providers/asset-library';
import type { SaveAssetDraft } from '../state/save-asset';

export type BrowserCaptureSource = PersonalAsset['source'];
export type BrowserSaveDraft = SaveAssetDraft;
export type BrowserSavedCapture = PersonalAsset;
export interface BrowserCaptureMetadata {
  name?: string; description?: string; tags?: string[]; style?: string; usage?: string; rating?: number;
  kind?: PersonalAsset['kind']; aiFill?: boolean; captureId?: string;
}

/** Browser bytes and metadata use the same durable local library as the original
 * Assets tab. The source project is provenance, not a forced destination. Keep
 * project collection/drag captures separate: those still write project files.
 */
export async function saveBrowserCaptureFile(file: File, source: BrowserCaptureSource, metadata: BrowserCaptureMetadata = {},
  _context?: WorkspaceCollabContext | null, destination: { parentId?: string | null; spaceId?: string } = {}): Promise<{ asset: PersonalAsset }> {
  if (!source.projectId) throw new Error('A source project is required to save browser captures.');
  if (metadata.captureId && !/^[a-zA-Z0-9-]{1,80}$/.test(metadata.captureId)) throw new Error('Invalid browser capture identity.');
  const filename = file.name.replace(/[\x00-\x1f\x7f/\\:*?"<>|]/g, '_').replace(/^\.+/, '').trim().slice(0, 180) || 'resource';
  const safeFile = filename === file.name ? file : new File([file], filename, { type: file.type });
  return personalAssets.upload(safeFile, destination.parentId ?? null, source, destination.spaceId, metadata);
}
