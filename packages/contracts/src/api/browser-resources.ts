/** First-party, opt-in resource capture for an owned embedded browser tab.
 * No extension runtime, arbitrary URL fetch, credentials export, or code execution.
 * Grants are issued by the trusted desktop UI, kept in memory, and explicitly
 * shared with CLI callers when desired. Both clients use the same HTTP commands.
 */
export const BROWSER_RESOURCE_PLUGIN_ID = 'resource-capture' as const;
export const BROWSER_RESOURCE_LIMITS = {
  items: 500,
  bytes: 25 * 1024 * 1024,
  readTimeoutMs: 30_000,
  grantLifetimeMs: 30 * 60 * 1000,
  batch: 50,
} as const;
export const BROWSER_RESOURCE_KINDS = ['image', 'svg', 'video', 'audio', 'font', 'stream'] as const;
export type BrowserResourceKind = typeof BROWSER_RESOURCE_KINDS[number];
export const BROWSER_RESOURCE_SORTS = ['resolution', 'size-desc', 'size-asc', 'name'] as const;
export type BrowserResourceSort = typeof BROWSER_RESOURCE_SORTS[number];
export type BrowserResourceUnavailableReason = 'unsupported' | 'too-large' | 'not-http' | 'not-get';
export interface BrowserResourceItem {
  id: string;
  kind: BrowserResourceKind;
  name: string;
  /** Display only: no credentials, query string or fragment. Never a read target. */
  url: string;
  mime?: string;
  size?: number;
  width?: number;
  height?: number;
  source: 'network' | 'document';
  readable: boolean;
  unavailableReason?: BrowserResourceUnavailableReason;
}
export interface BrowserResourceGrant {
  sessionId: string;
  /** Secret, never put in URLs, localStorage, logs, or asset metadata. */
  accessToken: string;
}
export interface BrowserResourceSnapshot {
  sessionId: string;
  projectId: string;
  tabId: string;
  /** Display/provenance URL with credentials, query and fragment removed. */
  pageUrl: string;
  title: string;
  navigationId: number;
  enabled: boolean;
  items: BrowserResourceItem[];
  limitReached: boolean;
}
export interface BrowserResourceRead {
  resourceId: string;
  navigationId: number;
  pageUrl: string;
  name: string;
  mime: string;
  base64: string;
}
export type BrowserResourceAction = 'start' | 'snapshot' | 'scan' | 'stop' | 'read';
export type BrowserResourceCommand = BrowserResourceGrant & { projectId: string } & (
  | { action: 'start' | 'snapshot' | 'scan' | 'stop' }
  | { action: 'read'; resourceId: string; navigationId: number }
);
export type BrowserResourceResult = BrowserResourceSnapshot | BrowserResourceRead;
export type BrowserResourceExecutor = (command: BrowserResourceCommand) => Promise<BrowserResourceResult>;
export type BrowserResourceErrorCode = 'unavailable' | 'invalid-request' | 'unauthorized' | 'stale-document'
  | 'unsupported-resource' | 'too-large' | 'timeout' | 'read-failed';
export class BrowserResourceError extends Error {
  constructor(readonly code: BrowserResourceErrorCode, message: string) { super(message); this.name = 'BrowserResourceError'; }
}
export function parseBrowserResourceCommand(value: unknown): BrowserResourceCommand {
  const fail = (): never => { throw new BrowserResourceError('invalid-request', 'Invalid browser resource command'); };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail();
  const input = value as Record<string, unknown>;
  const string = (key: string, max: number): string => {
    const result = input[key];
    if (typeof result !== 'string' || !result.trim() || result.length > max || /[\x00-\x1f]/.test(result)) return fail();
    return result;
  };
  const sessionId = string('sessionId', 128);
  const accessToken = string('accessToken', 256);
  const projectId = string('projectId', 256);
  const base = { sessionId, accessToken, projectId };
  if (input.action === 'read') {
    if (typeof input.navigationId !== 'number' || !Number.isSafeInteger(input.navigationId) || input.navigationId < 0) return fail();
    return { ...base, action: 'read', resourceId: string('resourceId', 128), navigationId: input.navigationId };
  }
  if (input.action === 'start' || input.action === 'snapshot' || input.action === 'scan' || input.action === 'stop') {
    return { ...base, action: input.action };
  }
  return fail();
}
function resourceMagnitude(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : 0;
}
function resourcePixels(item: BrowserResourceItem): number {
  return resourceMagnitude(resourceMagnitude(item.width) * resourceMagnitude(item.height));
}
/** Unknown/invalid sizes rank last in either direction; zero bytes is known. */
function compareResourceSizes(a: BrowserResourceItem, b: BrowserResourceItem, ascending: boolean): number {
  const aKnown = a.size !== undefined && Number.isFinite(a.size) && a.size >= 0;
  const bKnown = b.size !== undefined && Number.isFinite(b.size) && b.size >= 0;
  if (!aKnown || !bKnown) return Number(bKnown) - Number(aKnown);
  return ascending ? a.size! - b.size! : b.size! - a.size!;
}
/** Shared UI/CLI ordering defaults to pixel area descending, then bytes descending.
 * Equal ranks preserve discovery order. Names compare lowercased UTF-16 strings,
 * independent of the host locale. Filtering/sorting never mutates the capture.
 */
export function filterBrowserResources(items: readonly BrowserResourceItem[], filter: {
  kind?: BrowserResourceKind | 'all'; query?: string; minSize?: number; minWidth?: number; minHeight?: number;
  sort?: BrowserResourceSort;
} = {}): BrowserResourceItem[] {
  const query = filter.query?.trim().toLowerCase() ?? '';
  return items.filter(item => (!filter.kind || filter.kind === 'all' || item.kind === filter.kind)
    && (!query || `${item.name} ${item.url} ${item.mime ?? ''}`.toLowerCase().includes(query))
    && (!filter.minSize || (item.size !== undefined && item.size >= filter.minSize))
    && (!filter.minWidth || (item.width !== undefined && item.width >= filter.minWidth))
    && (!filter.minHeight || (item.height !== undefined && item.height >= filter.minHeight)))
    .sort((a, b) => {
      if (filter.sort === 'size-asc' || filter.sort === 'size-desc') return compareResourceSizes(a, b, filter.sort === 'size-asc');
      if (filter.sort === 'name') {
        const aName = a.name.toLowerCase();
        const bName = b.name.toLowerCase();
        return aName < bName ? -1 : aName > bName ? 1 : 0;
      }
      return resourcePixels(b) - resourcePixels(a) || resourceMagnitude(b.size) - resourceMagnitude(a.size);
    });
}
