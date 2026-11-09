import type { ReleaseChannel } from "@bezier/release";

/**
 * @module protocol
 *
 * The Bezier Design renderer host-bridge wire contract: the injected-global name
 * and version, client/updater constant registries, and every request/result
 * type that crosses the host bridge — including the {@link BezierHostBridge}
 * shape itself. Pure declarations only; depends on nothing else in the package.
 */

export const BEZIER_HOST_GLOBAL = "__bezier__";
export const BEZIER_HOST_VERSION = 2;

export const BEZIER_HOST_CLIENT_TYPES = Object.freeze({
  DESKTOP: "desktop",
} as const);

export type BezierHostClientType =
  (typeof BEZIER_HOST_CLIENT_TYPES)[keyof typeof BEZIER_HOST_CLIENT_TYPES];

export type BezierHostClient = {
  // BCP-47 locale string (e.g. "zh-CN", "pt-BR") the host process read from
  // the OS at startup. The renderer uses this so the packaged desktop app
  // can follow the OS language even when Chromium's built-in
  // `navigator.language` would have defaulted to en-US.
  osLocale?: string;
  platform?: string;
  type: BezierHostClientType;
};

export type BezierHostFailure = {
  details?: unknown;
  ok: false;
  reason: string;
};

export type BezierHostActionResult =
  | { ok: true }
  | BezierHostFailure;

/**
 * The workspace attribution the renderer gives the host so a folder import
 * lands in the caller's current workspace instead of the host's ambient one.
 *
 * This is a deliberate structural subset of the daemon/web
 * `WorkspaceCollabContext`, redeclared here rather than imported: this package
 * is the renderer host-bridge wire contract and must stay independent of the
 * daemon/web contracts package (enforced by the "stays independent from
 * daemon/web contracts" test). A full `WorkspaceCollabContext` is structurally
 * assignable to this type, so callers pass theirs unchanged.
 *
 * Only the fields the host actually forwards are modelled, and the enum-like
 * fields stay `string` because the host treats them as opaque pass-through
 * values — the daemon remains the authority that parses and validates them.
 * Deliberately no index signature: an interface never satisfies one, so adding
 * it would reject the very `WorkspaceCollabContext` callers pass. Callers hand
 * over a variable, not a fresh literal, so the extra fields ride along fine.
 */
export type BezierHostWorkspaceContext = {
  lifecycleState: string;
  memberStatus: string;
  permissions: {
    canShareProjects: boolean;
    canWriteSyncedFiles: boolean;
  };
  role: string;
  workspaceId: string;
  workspaceMemberId: string;
  workspaceType: string;
};

export type BezierHostProjectImportInit = {
  designSystemId?: string | null;
  name?: string;
  skillId?: string | null;
  workspaceContext?: BezierHostWorkspaceContext | null;
};

export type BezierHostProjectImportSuccess = {
  conversationId: string;
  entryFile: string | null;
  ok: true;
  projectId: string;
};

export type BezierHostProjectImportResult =
  | BezierHostProjectImportSuccess
  | {
      canceled: true;
      ok: false;
    }
  | BezierHostFailure;

export type BezierHostProjectReplaceWorkingDirSuccess = {
  baseDir: string;
  entryFile: string | null;
  ok: true;
};

export type BezierHostProjectReplaceWorkingDirResult =
  | BezierHostProjectReplaceWorkingDirSuccess
  | {
      canceled: true;
      ok: false;
    }
  | BezierHostFailure;

export type BezierHostPickWorkingDirSuccess = {
  baseDir: string;
  ok: true;
  // Single-use HMAC token (minted by the host main process for `baseDir`)
  // that the renderer threads into POST /api/projects/:id/working-dir once
  // the project exists. Lets the Home flow pick a folder before the project
  // is created without exposing the daemon's desktop-auth gate.
  token: string;
};

export type BezierHostPickWorkingDirResult =
  | BezierHostPickWorkingDirSuccess
  | {
      canceled: true;
      ok: false;
    }
  | BezierHostFailure;

export type BezierHostPdfPrintOptions = {
  deck?: boolean;
};

export type BezierHostCaptureClip = { x: number; y: number; width: number; height: number };
export type BezierHostCaptureOptions = { clip?: BezierHostCaptureClip };
export type BezierHostCaptureSuccess = { dataUrl: string; h: number; ok: true; w: number };
export type BezierHostCaptureResult = BezierHostCaptureSuccess | BezierHostFailure;

export type BezierHostBrowserClearDataOptions = {
  cookies?: boolean;
  storage?: boolean;
};

/**
 * App theme values the renderer may pin the host window appearance to.
 * `light`/`dark` force the native window material (macOS under-window
 * vibrancy glass follows the OS appearance by default, which reads as a
 * muddy gray when the OS is dark but the app theme is explicitly light);
 * `system` restores following the OS.
 */
export const BEZIER_HOST_APPEARANCE_THEMES = Object.freeze({
  DARK: "dark",
  LIGHT: "light",
  SYSTEM: "system",
} as const);

export type BezierHostAppearanceTheme =
  (typeof BEZIER_HOST_APPEARANCE_THEMES)[keyof typeof BEZIER_HOST_APPEARANCE_THEMES];

export const BEZIER_HOST_UPDATER_ACTIONS = Object.freeze({
  CANCEL_DOWNLOAD: "cancel-download",
  CHECK: "check",
  CLEAR_CACHE: "clear-cache",
  DOWNLOAD: "download",
  INSTALL: "install",
  QUIT: "quit",
  STATUS: "status",
} as const);

export type BezierHostUpdaterAction =
  (typeof BEZIER_HOST_UPDATER_ACTIONS)[keyof typeof BEZIER_HOST_UPDATER_ACTIONS];

/** @internal Updater actions that return a status snapshot (every action except `quit`). */
export type BezierHostUpdaterStatusAction = Exclude<
  BezierHostUpdaterAction,
  | typeof BEZIER_HOST_UPDATER_ACTIONS.CANCEL_DOWNLOAD
  | typeof BEZIER_HOST_UPDATER_ACTIONS.QUIT
>;

export const BEZIER_HOST_UPDATER_STATES = Object.freeze({
  AVAILABLE: "available",
  CHECKING: "checking",
  DOWNLOADED: "downloaded",
  DOWNLOADING: "downloading",
  ERROR: "error",
  IDLE: "idle",
  INSTALLING: "installing",
  NOT_AVAILABLE: "not-available",
  UNSUPPORTED: "unsupported",
} as const);

export type BezierHostUpdaterState =
  (typeof BEZIER_HOST_UPDATER_STATES)[keyof typeof BEZIER_HOST_UPDATER_STATES];

export type BezierHostUpdaterMode = "js-incremental" | "package-launcher";
export type BezierHostUpdaterChannel = ReleaseChannel;

export type BezierHostUpdaterActionOptions = {
  payload?: Record<string, unknown>;
};

export type BezierHostUpdaterCapabilitySet = {
  canApplyInPlace: boolean;
  canDownload: boolean;
  canOpenInstaller: boolean;
  requiresManualInstall: boolean;
};

export type BezierHostUpdaterPathSnapshot = {
  downloadRoot?: string;
  manifestPath?: string;
};

export type BezierHostUpdaterChecksumSnapshot = {
  algorithm: "sha256" | "sha512";
  url?: string;
  value?: string;
};

export type BezierHostUpdaterArtifactSnapshot = {
  name?: string;
  platformKey?: string;
  size?: number;
  type?: string;
  url: string;
};

export type BezierHostUpdaterProgressSnapshot = {
  receivedBytes: number;
  totalBytes?: number;
};

export type BezierHostUpdaterErrorSnapshot = {
  code: string;
  details?: unknown;
  message: string;
};

export type BezierHostUpdaterInstallResult = {
  activeVersion?: string;
  artifactPath?: string;
  dryRun?: boolean;
  helperLogPath?: string;
  launcherRuntimePath?: string;
  launchPath?: string;
  openedAt: string;
  path: string;
};

export type BezierHostUpdaterReleaseSnapshot = {
  arch: string;
  artifact: BezierHostUpdaterArtifactSnapshot;
  checksum: BezierHostUpdaterChecksumSnapshot;
  channel: BezierHostUpdaterChannel;
  downloadedAt: string;
  key: string;
  metadata?: Record<string, unknown>;
  path: string;
  platformKey: string;
  version: string;
};

export type BezierHostUpdaterIncomingSnapshot = {
  arch: string;
  artifact: BezierHostUpdaterArtifactSnapshot;
  channel: BezierHostUpdaterChannel;
  key?: string;
  metadata?: Record<string, unknown>;
  progress?: BezierHostUpdaterProgressSnapshot;
  startedAt: string;
  version: string;
};

export type BezierHostUpdaterCacheLifecycleTrigger = "cold-start" | "manual" | "next-version-ready";

export type BezierHostUpdaterReleaseLifecycleState =
  | "cleanup-deferred"
  | "cleanup-removed"
  | "deprecated"
  | "retained"
  | "unknown";

export type BezierHostUpdaterCacheLifecycleSummary = {
  lastRunAt?: string;
  lastTrigger?: BezierHostUpdaterCacheLifecycleTrigger;
  platform: string;
  releases: {
    cleanupDeferred: number;
    cleanupRemoved: number;
    deprecated: number;
    errors: number;
    retained: number;
    total: number;
    unknown: number;
  };
};

export type BezierHostUpdaterCacheSnapshot = {
  lifecycle?: BezierHostUpdaterCacheLifecycleSummary;
};

export type BezierHostUpdaterReinstallReason =
  | "launcher-schema"
  | "outer-below-min"
  | "outer-version-unreadable";

/**
 * Present when the release feed requires a full installer reinstall instead of
 * an in-place payload update. `installedVersion` is the physically installed
 * outer package version; `url` is an optional operator-supplied explanation
 * link.
 */
export type BezierHostUpdaterReinstallSnapshot = {
  installedVersion?: string;
  minVersion?: string;
  reason: BezierHostUpdaterReinstallReason;
  url?: string;
};

export type BezierHostUpdaterStatusSnapshot = {
  active?: BezierHostUpdaterReleaseSnapshot;
  arch: string;
  artifact?: BezierHostUpdaterArtifactSnapshot;
  artifactUrl?: string;
  availableVersion?: string;
  cache?: BezierHostUpdaterCacheSnapshot;
  capabilities: BezierHostUpdaterCapabilitySet;
  channel: BezierHostUpdaterChannel;
  checksum?: BezierHostUpdaterChecksumSnapshot;
  currentVersion: string;
  downloadPath?: string;
  enabled: boolean;
  error?: BezierHostUpdaterErrorSnapshot;
  incoming?: BezierHostUpdaterIncomingSnapshot;
  installResult?: BezierHostUpdaterInstallResult;
  lastCheckedAt?: string;
  metadata?: Record<string, unknown>;
  mode: BezierHostUpdaterMode;
  paths?: BezierHostUpdaterPathSnapshot;
  platform: string;
  progress?: BezierHostUpdaterProgressSnapshot;
  reinstall?: BezierHostUpdaterReinstallSnapshot;
  state: BezierHostUpdaterState;
  supported: boolean;
};

export type BezierHostUpdaterResult =
  | { ok: true; status: BezierHostUpdaterStatusSnapshot }
  | BezierHostFailure;

export type BezierHostUpdaterStatusListener = (status: BezierHostUpdaterStatusSnapshot) => void;

export type BezierHostUpdaterMenuLabels = {
  check: string;
  checking: string;
  downloading: string;
  install: string;
  installing: string;
  restart: string;
};

export type BezierHostUpdaterOpenDialogRequest = {
  source: string;
};

export type BezierHostUpdaterOpenDialogListener = (request: BezierHostUpdaterOpenDialogRequest) => void;

/**
 * Minimal renderer-facing shape of a browser-extension capture. Only the
 * fields the renderer's persistence layer needs; the full validated wire
 * envelope (defined in the daemon/web contracts package) never crosses this
 * boundary — main has already parsed and size-checked it before calling
 * `onBrowserCapture`, so this package intentionally does not depend on that
 * package to describe it again, keeping the host protocol independent.
 */
export type BezierHostBrowserCapture = {
  /** Opaque shared-contract DTO, validated and scoped by the desktop capture host. */
  assetOperation?: unknown;
  captureId: string;
  kind: 'selection' | 'image';
  intent: string;
  source: { pageUrl: string; title?: string };
  selection?: { text: string };
  /** Present only for `kind: 'image'`: the image's own address and MIME. */
  resource?: { url: string; mime: string; alt?: string };
  /** Present only for `kind: 'image'`: the original picture bytes. */
  payload?: { mime: string; bytes: Uint8Array; filenameHint?: string };
  /** Present only when `intent === 'save_personal_asset'`. */
  asset?: {
    name: string;
    spaceId?: string;
    description?: string;
    style?: string;
    usage?: string;
    tags?: string[];
    rating?: number;
    aiFill?: boolean;
  };
  capturedAt: string;
};

export type BezierHostBrowserExtensionStatus = {
  connected: boolean;
  browserName: string | null;
  message: string;
};

export type BezierHostBrowserCaptureRecord = {
  id: string;
  at: number;
  kind: 'selection' | 'image';
  title: string;
  sourceUrl?: string;
  ok: boolean;
  message: string;
};

export type BezierHostBrowserExtensionInstallResult =
  | { ok: true; message: string }
  | { ok: false; reason: string };

/** Structural twin of the app grant DTO; host remains independent of app contracts. */
export type BrowserResourceGrant = { sessionId: string; accessToken: string };

/** Original image bytes read from an enabled embedded-browser document. */
export type BezierHostBrowserImage = {
  url: string;
  pageUrl: string;
  title: string;
  base64: string;
  mime: string;
};

export type BezierHostBrowserCaptureContext = {
  projectId: string | null;
  projectName?: string;
  canWrite: boolean;
  /**
   * Personal-asset spaces the extension may offer as save targets. Pushed from
   * the renderer (which owns space state) so the extension's dialog shows the
   * same list as the in-app one instead of guessing. Optional: a host that
   * never pushes it simply gets a dialog with only the default space.
   */
  spaces?: Array<{ id: string; name: string }>;
  defaultSpaceId?: string;
  /** Unique tags already used in the personal-asset library. */
  tags?: string[];
};

export type BezierHostBridge = {
  // Optional so older host builds still satisfy the bridge shape; callers
  // must feature-detect before invoking.
  appearance?: {
    setTheme(theme: BezierHostAppearanceTheme): void;
  };
  // Optional. The desktop main process uses this so native menus and dialogs
  // follow the in-app language when it differs from the OS language.
  ui?: {
    setLocale(locale: string): void;
  };
  browser: {
    /** Development-only, user-confirmed Pinterest auth handoff experiment. */
    connectPinterest?(guestId: number): Promise<BezierHostActionResult>;
    cancelPinterest?(guestId: number): Promise<void>;
    onPinterestAuthStatus?(listener: (status: { guestId: number; message: string; active?: boolean }) => void): () => void;
    setCollector?(guestId: number, enabled: boolean): Promise<void>;
    collectImage?(guestId: number, url: string): Promise<void>;
    /** Optional native read only: no collected-resource event or project write. */
    readImage?(guestId: number, url: string): Promise<BezierHostBrowserImage>;
    /** Issues a disabled, ephemeral grant from the trusted main frame only. */
    openResourceCapture?(guestId: number, projectId: string, tabId: string): Promise<BrowserResourceGrant>;
    closeResourceCapture?(sessionId: string, accessToken: string): Promise<void>;
    onCollectedResource?(listener: (resource: { guestId: number; url: string; pageUrl: string; title: string; base64?: string; mime?: string; error?: string }) => void): () => void;
    clearData(options?: BezierHostBrowserClearDataOptions): Promise<BezierHostActionResult>;
    /**
     * New external-browser-extension capture bridge (Chrome/Edge, not the
     * embedded design browser above). All optional so older host builds
     * still satisfy this type; callers must feature-detect.
     */
    startCaptureBridge?(): Promise<BezierHostActionResult>;
    stopCaptureBridge?(): Promise<void>;
    onBrowserCapture?(listener: (capture: BezierHostBrowserCapture) => void): () => void;
    setBrowserCaptureContext?(context: BezierHostBrowserCaptureContext): void;
    completeBrowserCapture?(input: { captureId: string; ok: boolean; message: string; files?: string[]; assetData?: unknown }): Promise<void>;
    getCaptureExtensionStatus?(): Promise<BezierHostBrowserExtensionStatus>;
    installCaptureExtension?(): Promise<BezierHostBrowserExtensionInstallResult>;
    onCaptureExtensionStatus?(listener: (status: BezierHostBrowserExtensionStatus) => void): () => void;
    listCaptureRecords?(): Promise<BezierHostBrowserCaptureRecord[]>;
    onCaptureRecord?(listener: (record: BezierHostBrowserCaptureRecord) => void): () => void;
  };
  capture: {
    page(options?: BezierHostCaptureOptions): Promise<BezierHostCaptureResult>;
  };
  client: BezierHostClient;
  pdf: {
    print(html: string, nonce?: string, options?: BezierHostPdfPrintOptions): Promise<BezierHostActionResult>;
  };
  project: {
    pickAndImport(init?: BezierHostProjectImportInit): Promise<BezierHostProjectImportResult>;
    pickAndReplaceWorkingDir(projectId: string): Promise<BezierHostProjectReplaceWorkingDirResult>;
    // Optional so older host builds still satisfy the bridge shape; callers
    // must feature-detect before invoking.
    pickWorkingDir?(): Promise<BezierHostPickWorkingDirResult>;
  };
  shell: {
    openExternal(url: string): Promise<BezierHostActionResult>;
    openPath(projectId: string): Promise<BezierHostActionResult>;
  };
  updater: {
    "cancel-download"?(options?: BezierHostUpdaterActionOptions): Promise<BezierHostUpdaterStatusSnapshot>;
    check(options?: BezierHostUpdaterActionOptions): Promise<BezierHostUpdaterStatusSnapshot>;
    "clear-cache"(options?: BezierHostUpdaterActionOptions): Promise<BezierHostUpdaterStatusSnapshot>;
    download(options?: BezierHostUpdaterActionOptions): Promise<BezierHostUpdaterStatusSnapshot>;
    install(options?: BezierHostUpdaterActionOptions): Promise<BezierHostUpdaterStatusSnapshot>;
    quit(options?: BezierHostUpdaterActionOptions): Promise<BezierHostActionResult>;
    setMenuLabels(labels: BezierHostUpdaterMenuLabels): Promise<BezierHostActionResult>;
    status(options?: BezierHostUpdaterActionOptions): Promise<BezierHostUpdaterStatusSnapshot>;
    subscribe(listener: BezierHostUpdaterStatusListener): () => void;
    subscribeOpenDialog(listener: BezierHostUpdaterOpenDialogListener): () => void;
  };
  version: typeof BEZIER_HOST_VERSION;
};

export type BezierHostGlobalScope = Record<string, unknown> & {
  window?: unknown;
};
