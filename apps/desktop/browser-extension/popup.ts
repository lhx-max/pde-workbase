import { bindExtensionLocale, currentExtensionLocale, detectExtensionLocale, eu, extensionLocaleStorageKey, localizeBridgeError } from "./locales/extension-ui.js";
/**
 * Official popup: connection card + the two capture surfaces.
 * Howto / privacy copy stays out — the in-page UI is the product.
 */
import { DEFAULT_CAPTURE_PREFS, parseCapturePrefs, type CapturePrefs } from './capture-prefs.js';

type WorkerState = {
  phase: 'idle' | 'ready' | 'sending' | 'done' | 'error';
  message: string;
  projectName?: string | null;
  canWrite?: boolean;
};

declare const chrome: {
  runtime: { sendMessage(message: { type: string }): Promise<WorkerState> };
  storage: {
    local: {
      get(keys: string): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
    };
  };
};

const statusEl = document.getElementById('status') as HTMLParagraphElement;
const labelEl = document.getElementById('state-label') as HTMLSpanElement;
const retryEl = document.getElementById('retry') as HTMLButtonElement;
const cardEl = document.getElementById('status-card') as HTMLElement;
const selectionEl = document.getElementById('pref-selection') as HTMLInputElement;
const imageEl = document.getElementById('pref-image') as HTMLInputElement;

function phaseLabel(phase: WorkerState['phase']): string {
  const copy = eu();
  if (phase === 'ready' || phase === 'done') return copy.connected;
  if (phase === 'sending') return copy.checkingShort;
  return copy.disconnected;
}

function applyPopupChrome(): void {
  const copy = eu();
  document.documentElement.lang = currentExtensionLocale();
  document.title = copy.popupTitle;
  const set = (id: string, value: string) => {
    const node = document.getElementById(id);
    if (node) node.textContent = value;
  };
  set('popup-title', copy.popupTitle);
  set('popup-tagline', copy.popupTagline);
  set('prefs-title', copy.prefsTitle);
  set('pref-selection-title', copy.selectionTitle);
  set('pref-selection-hint', copy.selectionHint);
  set('pref-image-title', copy.imageTitle);
  set('pref-image-hint', copy.imageHint);
  selectionEl.setAttribute('aria-label', copy.selectionTitle);
  imageEl.setAttribute('aria-label', copy.imageTitle);
  retryEl.title = copy.retry;
  retryEl.setAttribute('aria-label', copy.retryAria);
}

function render(state: WorkerState): void {
  statusEl.textContent = localizeBridgeError(state.message, state.phase === 'ready' || state.phase === 'done'
    ? eu().connectedPlain : state.phase === 'sending' ? eu().checking : eu().cannotOpenApp);
  labelEl.textContent = phaseLabel(state.phase);
  cardEl.classList.toggle('ok', state.phase === 'ready' || state.phase === 'done');
  cardEl.classList.toggle('bad', state.phase === 'error' || state.phase === 'idle');
  retryEl.disabled = state.phase === 'sending';
}

function renderPrefs(prefs: CapturePrefs): void {
  selectionEl.checked = prefs.selectionBar;
  imageEl.checked = prefs.imageHover;
}

let refreshing = false;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;

async function refresh(): Promise<void> {
  if (refreshing) return;
  refreshing = true;
  render({ phase: 'sending', message: eu().checking });
  try {
    render(await chrome.runtime.sendMessage({ type: 'status' }));
  } catch {
    render({ phase: 'error', message: eu().cannotOpenApp });
  } finally {
    refreshing = false;
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(refresh, 2000);
  }
}

async function persistPrefs(): Promise<void> {
  const prefs: CapturePrefs = {
    selectionBar: selectionEl.checked,
    imageHover: imageEl.checked,
  };
  await chrome.storage.local.set({ capturePrefs: prefs });
}

selectionEl.addEventListener('change', () => { void persistPrefs(); });
imageEl.addEventListener('change', () => { void persistPrefs(); });
retryEl.addEventListener('click', () => { void refresh(); });
bindExtensionLocale(detectExtensionLocale());
applyPopupChrome();
void chrome.storage.local.get(extensionLocaleStorageKey()).then((stored) => {
  const saved = stored[extensionLocaleStorageKey()];
  if (typeof saved === 'string') {
    bindExtensionLocale(saved);
    applyPopupChrome();
  }
}).catch(() => undefined);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) void refresh();
});
window.addEventListener('pagehide', () => {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = null;
});

void chrome.storage.local.get('capturePrefs').then((got) => {
  renderPrefs(parseCapturePrefs(got.capturePrefs) ?? DEFAULT_CAPTURE_PREFS);
}).catch(() => { renderPrefs(DEFAULT_CAPTURE_PREFS); });
void refresh();

export {};
