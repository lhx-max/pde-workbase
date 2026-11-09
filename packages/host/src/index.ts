/**
 * @module host
 *
 * Public barrel for `@bezier/host` — the Bezier Design renderer host-bridge
 * protocol. Re-exports the exact prior flat surface from the cohesive sibling
 * modules: the wire protocol (constants + types), bridge detection/validation,
 * adapter-result normalizers, and the renderer-facing action wrappers. This
 * file contains no logic.
 */

// --- protocol: constant registries + wire types ---
export {
  BEZIER_HOST_GLOBAL,
  BEZIER_HOST_VERSION,
  BEZIER_HOST_APPEARANCE_THEMES,
  BEZIER_HOST_CLIENT_TYPES,
  BEZIER_HOST_UPDATER_ACTIONS,
  BEZIER_HOST_UPDATER_STATES,
} from "./protocol.js";
export type {
  BezierHostClientType,
  BezierHostClient,
  BezierHostFailure,
  BezierHostActionResult,
  BezierHostWorkspaceContext,
  BezierHostProjectImportInit,
  BezierHostProjectImportSuccess,
  BezierHostProjectImportResult,
  BezierHostProjectReplaceWorkingDirSuccess,
  BezierHostProjectReplaceWorkingDirResult,
  BezierHostPickWorkingDirSuccess,
  BezierHostPickWorkingDirResult,
  BezierHostPdfPrintOptions,
  BezierHostCaptureClip,
  BezierHostCaptureOptions,
  BezierHostCaptureSuccess,
  BezierHostCaptureResult,
  BezierHostAppearanceTheme,
  BezierHostBrowserClearDataOptions,
  BezierHostBrowserCapture,
  BezierHostBrowserImage,
  BrowserResourceGrant,
  BezierHostBrowserCaptureContext,
  BezierHostBrowserCaptureRecord,
  BezierHostBrowserExtensionStatus,
  BezierHostBrowserExtensionInstallResult,
  BezierHostUpdaterAction,
  BezierHostUpdaterState,
  BezierHostUpdaterMode,
  BezierHostUpdaterChannel,
  BezierHostUpdaterActionOptions,
  BezierHostUpdaterCapabilitySet,
  BezierHostUpdaterPathSnapshot,
  BezierHostUpdaterChecksumSnapshot,
  BezierHostUpdaterArtifactSnapshot,
  BezierHostUpdaterProgressSnapshot,
  BezierHostUpdaterErrorSnapshot,
  BezierHostUpdaterInstallResult,
  BezierHostUpdaterReleaseSnapshot,
  BezierHostUpdaterIncomingSnapshot,
  BezierHostUpdaterCacheLifecycleTrigger,
  BezierHostUpdaterReleaseLifecycleState,
  BezierHostUpdaterCacheLifecycleSummary,
  BezierHostUpdaterCacheSnapshot,
  BezierHostUpdaterReinstallReason,
  BezierHostUpdaterReinstallSnapshot,
  BezierHostUpdaterStatusSnapshot,
  BezierHostUpdaterResult,
  BezierHostUpdaterStatusListener,
  BezierHostUpdaterMenuLabels,
  BezierHostUpdaterOpenDialogRequest,
  BezierHostUpdaterOpenDialogListener,
  BezierHostBridge,
  BezierHostGlobalScope,
} from "./protocol.js";

// --- detection: locate + validate the injected bridge ---
export {
  isBezierHostBridge,
  getBezierHost,
  isBezierHostAvailable,
  detectBezierHostClientType,
} from "./detection.js";

// --- normalize: adapter result -> renderer contract ---
export {
  normalizeBezierHostProjectImportResult,
  normalizeBezierHostProjectReplaceWorkingDirResult,
  normalizeBezierHostPickWorkingDirResult,
} from "./normalize.js";

// --- actions: renderer-facing host action wrappers ---
export {
  openHostExternalUrl,
  openHostProjectPath,
  clearHostBrowserData,
  captureHostPage,
  pickAndImportHostProject,
  pickAndReplaceHostProjectWorkingDir,
  pickHostWorkingDir,
  printHostPdf,
  getHostUpdaterStatus,
  checkHostUpdater,
  clearHostUpdaterCache,
  cancelHostUpdaterDownload,
  downloadHostUpdater,
  installHostUpdater,
  quitHostAfterUpdaterInstallerOpen,
  subscribeHostUpdater,
  subscribeHostUpdaterOpenDialog,
  setHostUpdaterMenuLabels,
} from "./actions.js";
