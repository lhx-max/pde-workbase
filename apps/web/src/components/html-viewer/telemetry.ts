/** Local embedding telemetry, deliberately independent of product analytics/onboarding.
 * Events remain observable by the embedding host; no network or personal identity is sent.
 */
type Track = (name: string, ...args: unknown[]) => void;
export const HTML_VIEWER_EVENT = 'canvas-workspace:viewer-event';
export function emitViewerEvent(name:string,...payload:unknown[]) {
 if(typeof window!=='undefined') window.dispatchEvent(new CustomEvent(HTML_VIEWER_EVENT,{detail:{name,payload}}));
}
export function useAnalytics(){return {track:emitViewerEvent,newRequestId:()=>globalThis.crypto.randomUUID()};}
function event(name:string){return (track:Track,...payload:unknown[])=>track(name,...payload);}
export const trackArtifactExportResult=event('artifact-export-result');
export const trackArtifactDeployResult=event('artifact-deploy-result');
export const trackArtifactPublishResult=event('artifact-publish-result');
export const trackArtifactHeaderClick=event('artifact-header-click');
export const trackArtifactToolbarClick=event('artifact-toolbar-click');
export const trackCommentPopoverClick=event('comment-popover-click');
export const trackFileVersionModalClick=event('file-version-modal-click');
export const trackFileVersionModalSurfaceView=event('file-version-modal-view');
export const trackFileVersionRestoreResult=event('file-version-restore-result');
export const trackPresentPopoverClick=event('present-popover-click');
export const trackDeckViewerSurfaceView=event('deck-viewer-view');
export const trackDeckViewerClick=event('deck-viewer-click');
export const trackSpeakerNotesSaveResult=event('speaker-notes-save-result');
export const trackShareOptionPopoverClick=event('share-option-click');
export const recordFirstLoopStep=event('delivery-progress');
export function observeProjectDownload(...payload:unknown[]){emitViewerEvent('download-completed',...payload);}
export function exportErrorCode(error:unknown){return error&&typeof error==='object'&&'code' in error?String(error.code):'UNKNOWN';}
export const deployErrorCode=exportErrorCode;
export function publishErrorCode(_error:unknown):'publish_failed' {return 'publish_failed';}
export function reportSafetyEvent(name:string,...payload:unknown[]){emitViewerEvent(name,...payload);}
export function scrubFilePath(value:string){return value.replace(/(?:[A-Za-z]:)?(?:\/[^\s/:]+){2,}/g,'[path]');}
