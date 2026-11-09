import {
  BEZIER_HOST_GLOBAL,
  BEZIER_HOST_VERSION,
  type BezierHostBridge,
  type BezierHostGlobalScope,
  type BezierHostUpdaterStatusSnapshot,
} from "./index.js";

export type MockBezierHost = Partial<Omit<BezierHostBridge, "capture" | "client" | "pdf" | "project" | "shell" | "updater">> & {
  browser?: Partial<BezierHostBridge["browser"]>;
  capture?: Partial<BezierHostBridge["capture"]>;
  client?: Partial<BezierHostBridge["client"]>;
  pdf?: Partial<BezierHostBridge["pdf"]>;
  project?: Partial<BezierHostBridge["project"]>;
  shell?: Partial<BezierHostBridge["shell"]>;
  updater?: Partial<BezierHostBridge["updater"]>;
};

export type MockBezierHostOptions = {
  host?: MockBezierHost;
  scope?: BezierHostGlobalScope;
};

function defaultHost(): BezierHostBridge {
  const updaterStatus: BezierHostUpdaterStatusSnapshot = {
    arch: "arm64",
    capabilities: {
      canApplyInPlace: false,
      canDownload: true,
      canOpenInstaller: true,
      requiresManualInstall: true,
    },
    channel: "beta",
    currentVersion: "1.0.0-beta.0",
    enabled: true,
    mode: "package-launcher",
    platform: "darwin",
    state: "idle",
    supported: true,
  };
  return {
    version: BEZIER_HOST_VERSION,
    browser: {
      clearData: async () => ({ ok: true }),
    },
    capture: {
      page: async () => ({ ok: true, dataUrl: "data:image/png;base64,", h: 1, w: 1 }),
    },
    client: {
      type: "desktop",
      platform: "test",
    },
    shell: {
      openExternal: async () => ({ ok: true }),
      openPath: async () => ({ ok: true }),
    },
    project: {
      pickAndImport: async () => ({
        ok: true,
        projectId: "project-test",
        conversationId: "conversation-test",
        entryFile: "index.html",
      }),
      pickAndReplaceWorkingDir: async () => ({
        ok: true,
        baseDir: "/tmp/bezier-test",
        entryFile: null,
      }),
    },
    pdf: {
      print: async () => ({ ok: true }),
    },
    updater: {
      "cancel-download": async () => updaterStatus,
      check: async () => updaterStatus,
      "clear-cache": async () => updaterStatus,
      download: async () => updaterStatus,
      install: async () => updaterStatus,
      quit: async () => ({ ok: true }),
      setMenuLabels: async () => ({ ok: true }),
      status: async () => updaterStatus,
      subscribe: () => () => undefined,
      subscribeOpenDialog: () => () => undefined,
    },
  };
}

export function createMockBezierHost(overrides: MockBezierHost = {}): BezierHostBridge {
  const base = defaultHost();
  return {
    ...base,
    ...overrides,
    browser: { ...base.browser, ...overrides.browser },
    capture: { ...base.capture, ...overrides.capture },
    client: { ...base.client, ...overrides.client },
    shell: { ...base.shell, ...overrides.shell },
    project: { ...base.project, ...overrides.project },
    pdf: { ...base.pdf, ...overrides.pdf },
    updater: { ...base.updater, ...overrides.updater },
  };
}

export function installMockBezierHost(options: MockBezierHostOptions = {}): () => void {
  const scope = (options.scope ?? globalThis) as BezierHostGlobalScope;
  const host = createMockBezierHost(options.host);
  const windowValue = scope.window;
  const targets = [
    scope,
    ...(typeof windowValue === "object" && windowValue != null && windowValue !== scope
      ? [windowValue as BezierHostGlobalScope]
      : []),
  ];
  const previous = targets.map((target) => ({
    had: Object.prototype.hasOwnProperty.call(target, BEZIER_HOST_GLOBAL),
    target,
    value: target[BEZIER_HOST_GLOBAL],
  }));

  for (const target of targets) {
    Object.defineProperty(target, BEZIER_HOST_GLOBAL, {
      configurable: true,
      value: host,
      writable: true,
    });
  }

  return () => {
    for (const entry of previous) {
      if (entry.had) {
        Object.defineProperty(entry.target, BEZIER_HOST_GLOBAL, {
          configurable: true,
          value: entry.value,
          writable: true,
        });
      } else {
        delete entry.target[BEZIER_HOST_GLOBAL];
      }
    }
  };
}
