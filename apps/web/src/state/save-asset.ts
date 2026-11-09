import { tActive } from '../i18n';
import type { PersonalAsset, WorkspaceCollabContext } from '@bezier/contracts';

export interface SaveAssetDraft {
  name: string;
  filename: string;
  /** Stable idempotency key for this save intent, including retries after lost responses. */
  captureId?: string;
  mime?: string;
  kind?: PersonalAsset['kind'];
  text?: string;
  url?: string;
  /** Read fresh content on save instead of fetching url; text drafts retain precedence. */
  readContent?: (signal: AbortSignal) => Promise<Blob>;
  /** Initial AI metadata fill preference; defaults to true. */
  aiFill?: boolean;
  /** Whether this content may use AI metadata fill; defaults to true. */
  allowAiFill?: boolean;
  source?: PersonalAsset['source'];
  /** Convenience project association; an explicit source.projectId takes precedence. */
  projectId?: string;
  workspaceContext?: WorkspaceCollabContext | null;
  /** Keep product asset details open after saving; the promise still resolves at save completion. */
  inspectAfterSave?: boolean;
}
type Request = {draft: SaveAssetDraft; resolve: (asset: PersonalAsset | null) => void};
let handler: ((request: Request) => void) | undefined;
export function registerSaveAssetHandler(next: (request: Request) => void) {
  handler = next;
  return () => { if (handler === next) handler = undefined; };
}
/** Opening the inspector never writes an asset. null means the user cancelled. */
export function requestSaveAsset(draft: SaveAssetDraft): Promise<PersonalAsset | null> {
  if (!handler) return Promise.reject(new Error(tActive('asset.error.windowNotReady')));
  return new Promise(resolve => handler!({draft, resolve}));
}
