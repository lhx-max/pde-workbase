export interface AgentModelPrefs {
  model?: string;
  reasoning?: string;
  serviceTier?: string;
}

export type AgentCliEnvPrefs = Record<string, Record<string, string>>;
export type AgentCliEnvIntentPrefs = Record<string, { apiKeyOverride?: boolean }>;

export interface TelemetryPrefs {
  metrics?: boolean;
  content?: boolean;
  artifactManifest?: boolean;
}

export interface OrbitConfigPrefs {
  enabled: boolean;
  /** Local 24-hour clock time in HH:mm format. Defaults to 08:00. */
  time: string;
  /** Optional skill id from the examples gallery where scenario === "orbit". */
  templateSkillId?: string | null;
  /**
   * Workspace selected in the tab that configured Orbit. The daemon verifies
   * this pair when saving and again before every unattended run.
   */
  workspaceScope?: AutomationWorkspaceScope | null;
}

export interface AutomationWorkspaceScope {
  workspaceId: string;
  workspaceMemberId: string;
}

export interface ProjectLocationPrefs {
  id: string;
  name: string;
  path: string;
}

export interface BrowserBookmark {
  title: string;
  url: string;
}

export interface BrowserReferenceSite {
  id: string;
  title: string;
  url: string;
  description: string;
  category: string;
}

export interface BrowserReferencePreferences {
  customSites: BrowserReferenceSite[];
  hiddenUrls: string[];
}

export interface BrowserCapturePreferences {
  enabled: boolean;
  text: boolean;
  images: boolean;
}

export const DEFAULT_BROWSER_CAPTURE_PREFERENCES: Readonly<BrowserCapturePreferences> = { enabled: true, text: true, images: true };

/** Missing switches retain the default; malformed switches must not overwrite a saved choice. */
export function normalizeBrowserCapturePreferences(value: unknown): BrowserCapturePreferences | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (['enabled', 'text', 'images'].some(key => record[key] !== undefined && typeof record[key] !== 'boolean')) return undefined;
  return {
    enabled: typeof record.enabled === 'boolean' ? record.enabled : true,
    text: typeof record.text === 'boolean' ? record.text : true,
    images: typeof record.images === 'boolean' ? record.images : true,
  };
}

export interface AppConfigPrefs {
  /** Automatic browser overlays only; explicit context-menu capture remains available. */
  browserCapture?: BrowserCapturePreferences;
  /** Absent uses bundled defaults; an empty array intentionally clears the bar. */
  browserBookmarks?: BrowserBookmark[];
  /** Local browser catalogue customizations, independent of the bookmark bar. */
  browserReferences?: BrowserReferencePreferences;
  /** Nonsecret default execution intent; API credentials remain request-scoped. */
  executionMode?: 'cli' | 'api';
  onboardingCompleted?: boolean;
  agentId?: string | null;
  agentModels?: Record<string, AgentModelPrefs>;
  agentCliEnv?: AgentCliEnvPrefs;
  agentCliEnvIntent?: AgentCliEnvIntentPrefs;
  skillId?: string | null;
  designSystemId?: string | null;
  disabledSkills?: string[];
  disabledDesignSystems?: string[];
  installationId?: string | null;
  telemetry?: TelemetryPrefs;
  /**
   * Unix-millis timestamp of when the user resolved the first-run privacy
   * consent surface (Share or Decline). Set on first decision and on
   * subsequent toggles in Settings → Privacy. Independent of
   * installationId so that "Delete my data" can rotate the id without
   * re-popping the consent banner.
   */
  privacyDecisionAt?: number | null;
  allowSilentUpdates?: boolean;
  orbit?: OrbitConfigPrefs;
  customInstructions?: string | null;
  systemPrompt?: import('./system-prompt.js').SystemPromptOverride | null;
  /** External project library roots. The daemon adds its built-in .bezier/projects location at read time. */
  projectLocations?: ProjectLocationPrefs[];
  /** Project location id used for new projects when the create request does not choose one explicitly. */
  defaultProjectLocationId?: string | null;
  /**
   * Most-recently-used local working directories the user granted the agent
   * read access to (via the Home composer's working-directory picker). These
   * become a new project's `metadata.linkedDirs` — the agent perceives them
   * through `--add-dir`; they are NOT imported into Design Files. Stored
   * most-recent-first and capped by the daemon.
   */
  recentLinkedDirs?: string[];
}

export interface AppConfigResponse {
  config: AppConfigPrefs;
}

export type UpdateAppConfigRequest = Omit<Partial<AppConfigPrefs>, 'browserBookmarks' | 'browserReferences' | 'browserCapture'> & {
  browserCapture?: BrowserCapturePreferences | null;
  /** null restores the bundled default by removing the saved preference. */
  browserBookmarks?: BrowserBookmark[] | null;
  browserReferences?: BrowserReferencePreferences | null;
};

/** Response body for `GET /api/recent-dirs` — recent working directories
 *  pruned to those that still exist on disk, most-recent-first. */
export interface RecentLinkedDirsResponse {
  dirs: string[];
}
