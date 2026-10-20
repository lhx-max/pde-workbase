import type { BrowserAssetInspectorData, PersonalAsset } from '@bezier/contracts';
type InspectorReply = {ok: boolean; message: string; inspectorId?: string; assetData?: BrowserAssetInspectorData};
import { icons, APP_LOGO } from './icons.js';
import { collectImageUrls } from './image-candidates.js';
import { IMAGE_HOVER_PAD, inImageHoverZone, pointInRect } from './image-hover.js';
import { matchTagOptions } from './tag-options.js';
import { DEFAULT_CAPTURE_PREFS, parseCapturePrefs, type CapturePrefs } from './capture-prefs.js';
import { bindExtensionLocale, detectExtensionLocale, eu } from './locales/extension-ui.js';
bindExtensionLocale(detectExtensionLocale());
/**
 * Loom 网页采集 — content script (all sites).
 *
 * Renders two things, both inside a closed-ish Shadow DOM so no page CSS can
 * reach them and none of our CSS leaks into the page:
 *   1. a selection toolbar that appears next to the user's own selection;
 *   2. a full replica of DA's in-app "保存到资产" dialog.
 *
 * Design constraints that shaped this file:
 * - It runs on `<all_urls>`, so it must stay inert until the user actually
 *   selects text. No observers on page mutation, no network, no storage reads
 *   at idle — only a `selectionchange`/`mouseup` listener.
 * - It never reads the page beyond `window.getSelection()`.
 * - All DA communication goes through the service worker; this script has no
 *   host permissions of its own.
 */

type Space = { id: string; name: string };
type CaptureContext = {
  ok: boolean;
  message: string;
  projectName?: string | null;
  canWrite?: boolean;
  spaces?: Space[];
  defaultSpaceId?: string;
  tags?: string[];
};

declare const chrome: {
  runtime: {
    id?: string;
    sendMessage(message: unknown): Promise<unknown>;
    onMessage: {
      addListener(fn: (message: { type?: string; context?: CaptureContext; srcUrl?: string }, sender: unknown, reply: (value: unknown) => void) => boolean | void): void;
    };
  };
  storage?: {
    session?: {
      get(keys: string): Promise<Record<string, unknown>>;
    };
    local?: {
      get(keys: string): Promise<Record<string, unknown>>;
    };
    onChanged?: {
      addListener(fn: (changes: Record<string, { newValue?: unknown }>, area: string) => void): void;
      removeListener(fn: (changes: Record<string, { newValue?: unknown }>, area: string) => void): void;
    };
  };
};

const TOOLBAR_OFFSET = 10;
chrome.runtime.onMessage.addListener((message) => {
  const locale = (message as { type?: string; locale?: unknown } | null)?.locale;
  if ((message as { type?: string } | null)?.type === "locale" && typeof locale === "string") {
    bindExtensionLocale(locale);
    refreshVisibleLocale();
  }
});
void chrome.runtime.sendMessage({ type: "locale" }).then((value) => {
  const locale = (value as { locale?: unknown } | null)?.locale;
  if (typeof locale === "string") {
    bindExtensionLocale(locale);
    refreshVisibleLocale();
  }
}).catch(() => undefined);
// Mirror of @bezier/contracts' ALLOWED_IMAGE_MIMES. The content script cannot
// import the contracts package (it is not bundled here), so the list is
// duplicated and intentionally narrow; SVG stays out until sanitisation lands
// (see docs/plans/da-browser-extension-mvp.md §9.5).
const ALLOWED_IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif'];
const IMAGE_BYTES_CAP = 25 * 1024 * 1024;
let capturePrefs: CapturePrefs = DEFAULT_CAPTURE_PREFS;
let host: HTMLDivElement | null = null;
let root: ShadowRoot | null = null;
let toolbar: HTMLDivElement | null = null;
let toolbarProbeTimer: ReturnType<typeof setTimeout> | null = null;
let dialogOpen = false;
/**
 * Snapshot taken at click time so a later selection collapse can't change it.
 * `rect` is kept because the panel is a popover anchored to that selection —
 * once the panel opens the live selection may well be gone.
 */
let pending: { text: string; title: string; url: string; rect: DOMRect } | null = null;

/** Change only extension-owned labels; keep typed form values and selected tags intact. */
function refreshVisibleLocale(): void {
  if (!root) return;
  const copy = eu();
  const label = toolbar?.querySelector('.barLabel');
  if (label) label.textContent = copy.saveToApp;
  if (imageBadge) {
    imageBadge.setAttribute('aria-label', copy.saveImageToApp);
    const imageLabel = imageBadge.querySelector('.imgLabel');
    if (imageLabel) imageLabel.textContent = copy.saveToApp;
  }
  const panel = root.querySelector<HTMLElement>('.panel');
  if (!panel) return;
  panel.setAttribute('aria-label', panel.dataset.kind === 'image' ? copy.saveImageToLibrary : copy.saveToLibrary);
  const set = (selector: string, value: string) => {
    const node = panel.querySelector<HTMLElement>(selector);
    if (node) node.textContent = value;
  };
  const placeholder = (selector: string, value: string) => {
    const node = panel.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector);
    if (node) node.placeholder = value;
  };
  panel.querySelector('.close')?.setAttribute('aria-label', copy.close);
  const spaceTitle = panel.querySelector('.spaceWrap')?.previousElementSibling;
  if (spaceTitle) spaceTitle.textContent = copy.space;
  set('label[for="da-name"]', copy.name);
  const tagsTitle = panel.querySelector('.tagWrap')?.previousElementSibling;
  if (tagsTitle) tagsTitle.textContent = copy.tags;
  set('.moreLabel', copy.moreInfo);
  set('label[for="da-desc"]', copy.description);
  set('label[for="da-style"]', copy.style);
  set('label[for="da-usage"]', copy.usage);
  set('.ratingSection .sectionTitle', copy.rating);
  panel.querySelector('.rating')?.setAttribute('aria-label', copy.ratingAria);
  panel.querySelectorAll('.star').forEach((node, index) => node.setAttribute('aria-label', copy.star(index + 1)));
  set('.fileInfo summary span', copy.fileInfo);
  set('.dimLabel', copy.dimensions);
  const fileTerms = panel.querySelectorAll('.fileMeta dt');
  if (fileTerms[1]) fileTerms[1].textContent = copy.kind;
  if (fileTerms[2]) fileTerms[2].textContent = copy.size;
  if (fileTerms[3]) fileTerms[3].textContent = copy.addedAt;
  set('.kindValue', copy.imageKind);
  panel.querySelector('.swatches')?.setAttribute('aria-label', copy.imageColors);
  const sourceLink = panel.querySelector('.sourceLink');
  if (sourceLink) sourceLink.innerHTML = `${copy.viewSource} ${icons.ArrowUpRight}`;
  set('.aifill span', copy.aiFill);
  set('.cancel', copy.cancel);
  const save = panel.querySelector<HTMLElement>('.save');
  if (save) save.textContent = save.dataset.saving === 'true' ? copy.saving : copy.saveToLibrary;
  placeholder('#da-tag', copy.tagSearch);
  placeholder('#da-desc', copy.descriptionPlaceholder);
  placeholder('#da-style', copy.stylePlaceholder);
  placeholder('#da-usage', copy.usagePlaceholder);
  panel.querySelector('.tagAdd')?.setAttribute('aria-label', copy.addTag);
  set('.tagAdd span', copy.addTag);
  set('.tagEmpty', copy.firstTagHint);
  panel.querySelectorAll('.tagList .tag').forEach((chip) => {
    const tag = chip.firstChild?.textContent?.trim();
    if (tag) chip.setAttribute('aria-label', copy.removeTag(tag));
  });
  const tagHint = panel.querySelector('.tagPickerHint');
  if (tagHint) tagHint.innerHTML = `${copy.enterAdd}<span>${copy.escClose}</span>`;
  const tagInput = panel.querySelector<HTMLInputElement>('#da-tag');
  if (tagInput?.value.trim()) set('.tagCreate', copy.createTag(tagInput.value.trim()));
}

function ensureRoot(): ShadowRoot {
  if (root) return root;
  host = document.createElement('div');
  host.id = 'da-capture-root';
  // Full-viewport host so position:fixed children still receive hits, but
  // pointer-events:none so the page stays clickable underneath. Each piece of
  // chrome (.bar / .imgBadge / .panel / .toast) turns pointer-events back on.
  host.style.cssText = 'all:initial;position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:2147483647';
  root = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = STYLES;
  root.append(style);
  document.documentElement.append(host);
  return root;
}

function currentSelection(): { text: string; rect: DOMRect } | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const text = String(selection).trim();
  if (!text) return null;
  const rect = selection.getRangeAt(0).getBoundingClientRect();
  if (!rect || (rect.width === 0 && rect.height === 0)) return null;
  return { text, rect };
}

function hideToolbar(): void {
  if (toolbarProbeTimer) clearTimeout(toolbarProbeTimer);
  toolbarProbeTimer = null;
  toolbar?.remove();
  toolbar = null;
}

function showToolbar(rect: DOMRect): void {
  if (!capturePrefs.selectionBar) return;
  hideImageBadge();
  const shadow = ensureRoot();
  hideToolbar();
  toolbar = document.createElement('div');
  toolbar.className = 'bar';
  const save = document.createElement('button');
  save.className = 'barBtn primary';
  save.innerHTML = `${LOGO}<span class="barLabel">${eu().saveToApp}</span>`;
  save.addEventListener('mousedown', event => event.preventDefault());
  save.addEventListener('click', () => {
    const active = currentSelection();
    if (!active) return;
    pending = { text: active.text, title: document.title, url: location.href, rect: active.rect };
    hideToolbar();
    void openDialog();
  });
  toolbar.append(save);
  shadow.append(toolbar);

  // Place above the selection, flipping below when there isn't room.
  place(toolbar, rect, TOOLBAR_OFFSET);

  // Ask DA whether saving is actually possible, and say so on the button
  // itself. This is a status probe, not a claim — it costs nothing and does
  // not consume the one-time upload credential, so it is safe per selection.
  const own = toolbar;
  const refreshProbe = async () => {
    const result = await ask<{ ok: boolean; message: string }>({ type: 'probe' });
    if (!result || own !== toolbar || !own.isConnected) return;
    const dot = own.querySelector('.barDot') as HTMLElement | null;
    if (dot) dot.className = `barDot ${result.ok ? 'ok' : 'bad'}`;
    own.title = result.message;
    own.classList.toggle('barOffline', !result.ok);
    toolbarProbeTimer = setTimeout(refreshProbe, result.ok ? 5000 : 1500);
  };
  void refreshProbe();
}

/**
 * Pins a fixed-position element next to the selection rect: horizontally
 * centred on it, above it when there's room and below it otherwise, always
 * clamped inside the viewport. Shared by the toolbar and the popover so the
 * two never disagree about where "next to the selection" is.
 */
function place(node: HTMLElement, rect: DOMRect, offset: number): void {
  const margin = 8;
  const width = node.offsetWidth || 150;
  const height = node.offsetHeight || 40;
  let left = rect.left + rect.width / 2 - width / 2;
  left = Math.max(margin, Math.min(left, window.innerWidth - width - margin));
  let top = rect.top - height - offset;
  if (top < margin) top = rect.bottom + offset;
  top = Math.max(margin, Math.min(top, window.innerHeight - height - margin));
  node.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
}

/** Park the save panel on the right of the viewport so a full-bleed image
 *  does not shove it into the middle of the picture. */
function placeAside(node: HTMLElement): void {
  const margin = 16;
  const width = node.offsetWidth || 400;
  const height = node.offsetHeight || 520;
  const left = Math.max(margin, window.innerWidth - width - margin);
  const top = Math.max(margin, Math.min(Math.round((window.innerHeight - height) / 2), window.innerHeight - height - margin));
  node.style.transform = `translate(${left}px, ${top}px)`;
}

function clampPanel(node: HTMLElement, left: number, top: number): void {
  const margin = 8;
  const width = node.offsetWidth || 400;
  const height = node.offsetHeight || 40;
  const x = Math.max(margin, Math.min(left, window.innerWidth - width - margin));
  const y = Math.max(margin, Math.min(top, window.innerHeight - height - margin));
  node.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
}

function enablePanelDrag(panel: HTMLElement, handle: HTMLElement): () => boolean {
  let dragged = false;
  let dragging = false;
  let startX = 0;
  let startY = 0;
  let origLeft = 0;
  let origTop = 0;
  handle.addEventListener('pointerdown', (event) => {
    if ((event.target as HTMLElement | null)?.closest('button')) return;
    const rect = panel.getBoundingClientRect();
    dragging = true;
    dragged = true;
    startX = event.clientX;
    startY = event.clientY;
    origLeft = rect.left;
    origTop = rect.top;
    handle.setPointerCapture(event.pointerId);
    handle.style.cursor = 'grabbing';
    event.preventDefault();
  });
  handle.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    clampPanel(panel, origLeft + event.clientX - startX, origTop + event.clientY - startY);
  });
  const endDrag = (event: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    handle.style.cursor = '';
    try { handle.releasePointerCapture(event.pointerId); } catch { /* already released */ }
  };
  handle.addEventListener('pointerup', endDrag);
  handle.addEventListener('pointercancel', endDrag);
  return () => dragged;
}

type AssetFormFields = {
  name: string;
  description: string;
  style: string;
  usage: string;
  tags: string[];
  rating: number;
  aiFill: boolean;
  spaceId?: string;
};

type ImageFilePreview = {
  width?: number;
  height?: number;
  size: number;
  colors: Array<{ hex: string; weight: number }>;
};

/** Shared inspector: spaces, tags, YAML, DA connection, save button. */
function setupAssetForm(
  panel: HTMLElement,
  opts: {
    isClosed: () => boolean;
    onSave: (asset: AssetFormFields) => Promise<InspectorReply | null>;
  },
): { dispose: () => void } {
  const q = <T extends HTMLElement>(sel: string) => panel.querySelector(sel) as T;
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let lastContextSignature = '';
  const tags: string[] = [];
  let availableTags: string[] = [];
  const tagList = q('.tagList');
  const tagAdd = q<HTMLButtonElement>('.tagAdd');
  const tagPicker = q('.tagPicker');
  const tagInput = q<HTMLInputElement>('#da-tag');
  const tagOptions = q('.tagOptions');
  let tagPickerOpen = false;
  function renderTags(): void {
    tagList.querySelectorAll('.tag').forEach(node => node.remove());
    for (const tag of tags) {
      const chip = document.createElement('button');
      chip.className = 'tag';
      chip.type = 'button';
      chip.textContent = tag;
      chip.insertAdjacentHTML('beforeend', icons.X);
      chip.setAttribute('aria-label', eu().removeTag(tag));
      chip.addEventListener('click', () => {
        tags.splice(tags.indexOf(tag), 1);
        renderTags();
        renderTagOptions();
      });
      tagList.insertBefore(chip, tagAdd);
    }
    tagAdd.innerHTML = icons.Plus + (tags.length ? '' : `<span>${eu().addTag}</span>`);
    tagAdd.classList.toggle('wide', tags.length === 0);
  }
  const addTag = (raw: string) => {
    const tag = raw.trim().slice(0, 80);
    if (tag && !tags.includes(tag) && tags.length < 30) tags.push(tag);
    tagInput.value = '';
    renderTags();
    renderTagOptions();
  };
  const toggleTag = (tag: string) => {
    const index = tags.indexOf(tag);
    if (index >= 0) tags.splice(index, 1);
    else if (tags.length < 30) tags.push(tag);
    tagInput.value = '';
    renderTags();
    renderTagOptions();
  };
  function renderTagOptions(): void {
    const query = tagInput.value;
    const matched = matchTagOptions(availableTags, query);
    tagOptions.replaceChildren();
    if (matched.canCreate) {
      const create = document.createElement('button');
      create.type = 'button';
      create.className = 'tagCreate';
      create.textContent = eu().createTag(query.trim());
      create.addEventListener('click', () => addTag(query));
      tagOptions.append(create);
    }
    for (const tag of matched.options) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = `tagOption${tags.includes(tag) ? ' on' : ''}`;
      item.setAttribute('aria-pressed', tags.includes(tag) ? 'true' : 'false');
      item.textContent = tag;
      item.addEventListener('click', () => toggleTag(tag));
      tagOptions.append(item);
    }
    if (!query.trim() && !matched.options.length) {
      const empty = document.createElement('p');
      empty.className = 'tagEmpty';
      empty.textContent = eu().firstTagHint;
      tagOptions.append(empty);
    }
  }
  function setTagPickerOpen(open: boolean): void {
    tagPickerOpen = open;
    tagPicker.classList.toggle('hidden', !open);
    tagAdd.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) {
      renderTagOptions();
      tagInput.focus();
    } else {
      tagInput.value = '';
    }
  }
  tagAdd.addEventListener('click', (event) => {
    event.stopPropagation();
    setTagPickerOpen(!tagPickerOpen);
  });
  tagInput.addEventListener('input', () => renderTagOptions());
  tagInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      if (event.isComposing) return;
      event.preventDefault();
      const query = tagInput.value.trim();
      if (query) addTag(query);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setTagPickerOpen(false);
    } else if (event.key === 'Backspace' && !tagInput.value && tags.length) {
      tags.pop();
      renderTags();
      renderTagOptions();
    }
  });
  panel.addEventListener('mousedown', (event) => {
    if (!tagPickerOpen) return;
    const node = event.target as Node;
    if (tagPicker.contains(node) || tagAdd.contains(node) || tagList.contains(node)) return;
    setTagPickerOpen(false);
  });

  let spaceId = '';
  let spaces: Space[] = [];
  const spaceBtn = q<HTMLButtonElement>('.spaceBtn');
  const spaceMenu = q('.spaceMenu');
  const spaceName = q('.spaceName');
  function renderSpaces(): void {
    spaceMenu.innerHTML = '';
    for (const space of spaces) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = `spaceItem${space.id === spaceId ? ' on' : ''}`;
      item.textContent = space.name;
      item.addEventListener('click', () => {
        spaceId = space.id;
        spaceName.textContent = space.name;
        spaceMenu.classList.remove('open');
        renderSpaces();
      });
      spaceMenu.append(item);
    }
  }
  spaceBtn.addEventListener('click', () => {
    if (spaceBtn.disabled) return;
    spaceMenu.classList.toggle('open');
  });

  let rating = 0;
  const ratingRoot = q('.rating');
  function renderRating(): void {
    for (const button of ratingRoot.querySelectorAll<HTMLButtonElement>('.star')) {
      const star = Number(button.dataset.star);
      button.setAttribute('aria-pressed', star <= rating ? 'true' : 'false');
    }
  }
  ratingRoot.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest('button.star') as HTMLButtonElement | null;
    if (!button) return;
    const star = Number(button.dataset.star);
    rating = rating === star ? 0 : star;
    renderRating();
  });

  let yamlMode = false;
  const yamlBox = q<HTMLTextAreaElement>('#da-yaml');
  let view = 'info';
  const readFields = () => ({
    name: q<HTMLInputElement>('#da-name').value,
    description: q<HTMLTextAreaElement>('#da-desc').value,
    tags: [...tags],
    style: q<HTMLTextAreaElement>('#da-style').value,
    usage: q<HTMLTextAreaElement>('#da-usage').value,
  });
  function writeFields(value: Partial<PersonalAsset>): void {
    q<HTMLInputElement>('#da-name').value = value.name || '';
    q<HTMLTextAreaElement>('#da-desc').value = value.description || '';
    q<HTMLTextAreaElement>('#da-style').value = value.style || '';
    q<HTMLTextAreaElement>('#da-usage').value = value.usage || '';
    tags.splice(0, tags.length, ...(value.tags || []));
    renderTags();
  }
  async function flushYaml(): Promise<boolean> {
    if (!yamlMode) return true;
    const parsed = await ask<{ok: boolean; value?: ReturnType<typeof readFields>; message?: string}>({type: 'from-yaml', yaml: yamlBox.value});
    if (!parsed?.ok || !parsed.value) {setError(parsed?.message || eu().yamlInvalidShort); return false;}
    writeFields(parsed.value);
    return true;
  }
  async function switchView(next: string): Promise<void> {
    if (next === view || !await flushYaml()) return;
    if (next === 'yaml') {
      const result = await ask<{ok: boolean; yaml?: string; message?: string}>({type: 'to-yaml', value: readFields()});
      if (!result?.ok || !result.yaml) {setError(result?.message || eu().yamlBuildFailed); return;}
      yamlBox.value = result.yaml;
      yamlMode = true;
    }
    view = next;
    yamlMode = next === 'yaml';
    q('.infoView').classList.toggle('hidden', next !== 'info');
    q('.promptView').classList.toggle('hidden', next !== 'prompt');
    yamlBox.classList.toggle('hidden', !yamlMode);
    q('.inspectorTools').classList.toggle('hidden', next === 'prompt');
    q('.yamlToggle').setAttribute('aria-pressed', String(yamlMode));
    panel.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(button => {
      button.setAttribute('aria-selected', String(button.dataset.view === next));
      button.tabIndex = button.dataset.view === next ? 0 : -1;
    });
  }
  const tabs = Array.from(panel.querySelectorAll<HTMLButtonElement>('[data-view]'));
  tabs.forEach((button, index) => {
    button.addEventListener('click', () => void switchView(button.dataset.view!));
    button.addEventListener('keydown', event => {
      const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : -1;
      if (next < 0) return;
      event.preventDefault(); tabs[next]!.focus(); void switchView(tabs[next]!.dataset.view!);
    });
  });

  const statusEl = q('.status');
  const statusTextEl = q('.statusText');
  const setStatus = (text: string, tone: 'idle' | 'ok' | 'bad'): void => {
    statusTextEl.textContent = text;
    statusEl.className = tone === 'idle' ? 'status' : `status ${tone}`;
    statusEl.title = text;
  };
  const errorEl = q('.error');
  const saveBtn = q<HTMLButtonElement>('.save');
  function setError(message: string): void {
    errorEl.textContent = message;
    errorEl.classList.toggle('hidden', !message);
  }

  let saving = false;
  let connectionReady = false;
  const applyContext = (context: CaptureContext | null): boolean => {
    connectionReady = context?.ok === true;
    const signature = JSON.stringify(context);
    if (signature === lastContextSignature) {
      saveBtn.disabled = saving || !connectionReady;
      return connectionReady;
    }
    lastContextSignature = signature;
    if (!context?.ok) {
      setStatus(context?.message || eu().waitingForApp, 'bad');
      spaceBtn.disabled = true;
      saveBtn.disabled = true;
      return false;
    }
    spaces = context.spaces?.length ? context.spaces : [{ id: '', name: eu().defaultSpace }];
    if (!spaces.some(space => space.id === spaceId)) {
      spaceId = context.defaultSpaceId && spaces.some(space => space.id === context.defaultSpaceId)
        ? context.defaultSpaceId
        : spaces[0]!.id;
    }
    spaceName.textContent = spaces.find(space => space.id === spaceId)?.name || eu().defaultSpace;
    renderSpaces();
    availableTags = context.tags ?? [];
    renderTagOptions();
    spaceBtn.disabled = false;
    saveBtn.disabled = saving;
    setStatus(context.projectName ? eu().connectedProject(context.projectName) : eu().connectedPlain, 'ok');
    return true;
  };
  const refreshConnection = async () => {
    if (opts.isClosed()) return;
    try {
      const context = await ask<CaptureContext>({ type: 'connect' });
      const ready = applyContext(context);
      if (!opts.isClosed()) pollTimer = setTimeout(refreshConnection, ready ? 5000 : 1500);
    } catch (error) {
      applyContext({ ok: false, message: error instanceof Error ? error.message : eu().waitingForApp });
      if (!opts.isClosed()) pollTimer = setTimeout(refreshConnection, 1500);
    }
  };
  setStatus(eu().checking, 'idle');
  saveBtn.disabled = true;
  spaceBtn.disabled = true;
  void chrome.storage?.session?.get('daContext').then((got) => {
    const stored = got?.daContext as CaptureContext | undefined;
    if (stored && !opts.isClosed()) applyContext(stored);
  }).catch(() => undefined);
  const onStored = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    if (area !== 'session' || opts.isClosed()) return;
    const next = changes.daContext?.newValue as CaptureContext | undefined;
    if (next) applyContext(next);
  };
  chrome.storage?.onChanged?.addListener(onStored);
  void refreshConnection();

  let inspectorId: string | undefined;
  let savedAsset: PersonalAsset | undefined;
  let captureSaved = false;
  let savedSignature = '';
  let currentData: BrowserAssetInspectorData | undefined;
  let readTimer: ReturnType<typeof setTimeout> | null = null;
  let readFailures = 0;
  const actionButtons = Array.from(panel.querySelectorAll<HTMLButtonElement>('[data-action]'));
  const active = (status: BrowserAssetInspectorData['analysis']) => status?.status === 'queued' || status?.status === 'running';
  const signature = () => JSON.stringify({ ...readFields(), rating, spaceId });
  function renderData(data: BrowserAssetInspectorData): void {
    currentData = data;
    // Background analysis may fill fields, but must never overwrite local edits.
    if (!yamlMode && signature() === savedSignature) {
      writeFields(data.asset);
      rating = data.asset.rating ?? 0;
      renderRating();
      savedAsset = data.asset;
      savedSignature = signature();
    }
    // Keep the original revision while a user has unsaved edits: the API will detect conflicts.
    if (!savedAsset) savedAsset = data.asset;
    const prompt = data.asset.prompt?.text || '';
    q('.promptText').textContent = prompt || eu().promptPlaceholder;
    q('.promptText').classList.toggle('empty', !prompt);
    q<HTMLButtonElement>('.copyPrompt').disabled = !prompt;
    q('.promptStatus').textContent = active(data.promptStatus) ? (data.promptStatus?.status === 'queued' ? eu().promptQueued : eu().promptExtracting) : data.promptStatus?.status === 'failed' ? (data.promptStatus.error || eu().promptFailed) : prompt ? eu().promptSaved : eu().promptHint;
    q('.promptStatus').classList.toggle('failed', data.promptStatus?.status === 'failed');
    for (const button of actionButtons) {
      const isPrompt = button.dataset.action === 'prompt';
      const working = active(isPrompt ? data.promptStatus : data.analysis);
      button.disabled = saving || working;
      button.textContent = working ? (isPrompt ? eu().extracting : eu().analyzing) : isPrompt ? (prompt ? eu().extractAgain : eu().extractPrompt) : eu().analyzeAgain;
    }
    if (data.analysis?.status === 'failed') setError(data.analysis.error || eu().analysisFailed);
    q('.aifill').classList.add('hidden');
    q('.cancel').textContent = eu().close;
    saveBtn.textContent = eu().saveEdits;
  }
  async function inspect(action: string, patch?: unknown): Promise<InspectorReply> {
    const reply = await ask<InspectorReply>({type: 'inspect-asset', inspectorId, action, ...(patch ? {patch} : {})});
    if (!reply?.ok) throw new Error(reply?.message || eu().connectionDropped);
    return reply;
  }
  function scheduleRead(): void {
    if (readTimer) clearTimeout(readTimer);
    if (!opts.isClosed()) readTimer = setTimeout(() => void readStatus(), 2000);
  }
  async function readStatus(): Promise<void> {
    if (opts.isClosed() || saving) {if (!opts.isClosed()) scheduleRead(); return;}
    try {
      const reply = await inspect('read');
      if (opts.isClosed()) return;
      if (saving) {scheduleRead(); return;}
      readFailures = 0;
      q('.retryRead').classList.add('hidden');
      if (reply.assetData) {
        renderData(reply.assetData);
        if (active(reply.assetData.analysis) || active(reply.assetData.promptStatus)) scheduleRead();
      }
    } catch (error) {
      if (opts.isClosed()) return;
      q('.promptStatus').textContent = error instanceof Error ? error.message : eu().readFailed;
      if (++readFailures <= 15) scheduleRead();
      else q('.retryRead').classList.remove('hidden');
    }
  }
  q('.retryRead').addEventListener('click', () => {readFailures = 0; void readStatus();});
  async function saveCurrent(): Promise<boolean> {
    if (captureSaved && !inspectorId) throw new Error(eu().savedUpdateApp);
    if (!await flushYaml()) return false;
    const meta = readFields();
    if (!meta.name.trim()) {setError(eu().nameRequired); return false;}
    const asset = {...meta, name: meta.name.trim(), rating, ...(spaceId ? {spaceId} : {})};
    const requestedSignature = signature();
    const result = savedAsset
      ? await inspect('update', {...asset, revision: savedAsset.revision})
      : await opts.onSave({...asset, aiFill: q<HTMLInputElement>('#da-aifill').checked});
    if (!result?.ok) throw new Error(result?.message || eu().saveFailedRetry);
    captureSaved = true;
    if (result.inspectorId) inspectorId = result.inspectorId;
    if (result.assetData) {
      savedAsset = result.assetData.asset;
      savedSignature = requestedSignature;
      renderData(result.assetData);
    }
    if (!inspectorId) {setError(eu().savedNeedUpdate); return false;}
    setStatus(eu().savedToAssets, 'ok');
    scheduleRead();
    return true;
  }
  async function perform(action: 'save' | 'analyze' | 'prompt'): Promise<void> {
    if (saving || opts.isClosed()) return;
    saving = true; saveBtn.disabled = true; setError('');
    actionButtons.forEach(button => {button.disabled = true;});
    try {
      if (action === 'save' || !savedAsset || signature() !== savedSignature) {
        if (!await saveCurrent()) return;
      }
      if (action !== 'save') {
        const reply = await inspect(action);
        if (reply.assetData && !opts.isClosed()) renderData(reply.assetData);
        scheduleRead();
      }
    } catch (error) {setError(error instanceof Error ? error.message : eu().actionFailed); if (savedAsset && inspectorId) scheduleRead();}
    finally {
      saving = false; saveBtn.disabled = !connectionReady;
      if (currentData) renderData(currentData);
      else actionButtons.forEach(button => {button.disabled = false;});
    }
  }
  saveBtn.addEventListener('click', () => void perform('save'));
  actionButtons.forEach(button => button.addEventListener('click', () => {
    if (button.dataset.action === 'analyze' || button.dataset.action === 'prompt') void perform(button.dataset.action);
  }));
  q('.yamlToggle').addEventListener('click', () => void switchView(yamlMode ? 'info' : 'yaml'));
  q('.copyPrompt').addEventListener('click', () => {
    const prompt = currentData?.asset.prompt?.text;
    if (prompt) void navigator.clipboard.writeText(prompt).catch(error => setError(String(error)));
  });

  return {
    dispose: () => {
      if (readTimer) clearTimeout(readTimer);
      chrome.storage?.onChanged?.removeListener(onStored);
      if (pollTimer) clearTimeout(pollTimer);
      pollTimer = null;
    },
  };
}

document.addEventListener('mouseup', () => {
  if (dialogOpen) return;
  window.setTimeout(() => {
    if (dialogOpen) return;
    const active = currentSelection();
    if (active) showToolbar(active.rect);
    else hideToolbar();
  }, 10);
}, true);

document.addEventListener('selectionchange', () => {
  if (dialogOpen) return;
  if (!currentSelection()) hideToolbar();
});

window.addEventListener('scroll', () => { if (!dialogOpen) hideToolbar(); }, true);
window.addEventListener('resize', () => { if (!dialogOpen) hideToolbar(); });

chrome.runtime.onMessage.addListener((message, _sender, reply) => {
  if (message?.type !== 'open-dialog') return;
  const active = currentSelection();
  if (!active) { reply({ ok: false, message: eu().selectTextFirst }); return true; }
  pending = { text: active.text, title: document.title, url: location.href, rect: active.rect };
  hideToolbar();
  void openDialog();
  reply({ ok: true });
  return true;
});

let imageBadge: HTMLButtonElement | null = null;
let imageBadgeTimer: ReturnType<typeof setTimeout> | null = null;
let imageBadgeHideTimer: ReturnType<typeof setTimeout> | null = null;
let badgeForImg: HTMLImageElement | null = null;
let pendingImage: { img: HTMLImageElement | null; url: string } | null = null;

function imageUrlOf(img: HTMLImageElement): string {
  return img.currentSrc || img.src || '';
}

function hideImageBadge(): void {
  if (imageBadgeTimer) { clearTimeout(imageBadgeTimer); imageBadgeTimer = null; }
  if (imageBadgeHideTimer) { clearTimeout(imageBadgeHideTimer); imageBadgeHideTimer = null; }
  imageBadge?.remove();
  imageBadge = null;
  badgeForImg = null;
}

function keepImageBadge(): void {
  if (imageBadgeHideTimer) { clearTimeout(imageBadgeHideTimer); imageBadgeHideTimer = null; }
}

function isEligibleImg(img: HTMLImageElement): boolean {
  const rect = img.getBoundingClientRect();
  if (rect.width < 64 && rect.height < 64) return false;
  return !!imageUrlOf(img);
}

function pointerOnPicture(x: number, y: number, img: HTMLImageElement): boolean {
  return inImageHoverZone(
    x,
    y,
    img.getBoundingClientRect(),
    imageBadge && badgeForImg === img ? imageBadge.getBoundingClientRect() : null,
  );
}

function imgAtPoint(x: number, y: number): HTMLImageElement | null {
  if (badgeForImg && isEligibleImg(badgeForImg) && pointerOnPicture(x, y, badgeForImg)) return badgeForImg;
  let best: HTMLImageElement | null = null;
  let bestArea = Infinity;
  const images = document.images;
  for (let i = 0; i < images.length; i += 1) {
    const img = images[i]!;
    if (!isEligibleImg(img)) continue;
    const rect = img.getBoundingClientRect();
    if (!pointInRect(x, y, rect, IMAGE_HOVER_PAD)) continue;
    const area = rect.width * rect.height;
    if (area < bestArea) { best = img; bestArea = area; }
  }
  return best;
}

function positionImageBadge(badge: HTMLElement, rect: DOMRect): void {
  // Reserve the expanded label width so hovering never pushes it offscreen.
  const w = Math.max(badge.offsetWidth, 132);
  const h = badge.offsetHeight || 36;
  const inset = 12;
  let left = rect.left + inset;
  let top = rect.top + inset;
  if (rect.width > w + inset * 2) left = Math.min(left, rect.right - w - inset);
  if (rect.height > h + inset * 2) top = Math.min(top, rect.bottom - h - inset);
  left = Math.max(rect.left + Math.min(inset, 4), left);
  top = Math.max(rect.top + Math.min(inset, 4), top);
  left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
  top = Math.max(8, Math.min(top, window.innerHeight - h - 8));
  badge.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
}

function showImageBadge(img: HTMLImageElement, rect: DOMRect): void {
  const url = imageUrlOf(img);
  if (!url) return;
  if (imageBadge && badgeForImg === img) {
    positionImageBadge(imageBadge, rect);
    return;
  }
  hideToolbar();
  const shadow = ensureRoot();
  hideImageBadge();
  const badge = document.createElement('button');
  badge.type = 'button';
  badge.className = 'imgBadge';
  badge.setAttribute('aria-label', eu().saveImageToApp);
  badge.innerHTML = `<span class="imgBadgeMark">${LOGO}</span><span class="imgLabel">${eu().saveToApp}</span>`;
  badge.addEventListener('pointerenter', keepImageBadge);
  badge.addEventListener('mousedown', event => event.preventDefault());
  badge.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    pendingImage = { img, url };
    hideImageBadge();
    void openImageDialog();
  });
  shadow.append(badge);
  imageBadge = badge;
  badgeForImg = img;
  positionImageBadge(badge, rect);
}

function pointerOnCapsule(event: PointerEvent): boolean {
  if (!imageBadge) return false;
  if (event.composedPath().includes(imageBadge)) return true;
  if (!badgeForImg) return false;
  return inImageHoverZone(
    event.clientX,
    event.clientY,
    badgeForImg.getBoundingClientRect(),
    imageBadge.getBoundingClientRect(),
  );
}

function onPointerSample(event: PointerEvent): void {
  if (dialogOpen) return;
  if (!capturePrefs.imageHover) {
    hideImageBadge();
    return;
  }
  if (!extensionContextAlive()) {
    hideImageBadge();
    return;
  }
  // Reaching the capsule must win over "left the <img> node". Site chips sit
  // on the photo; composedPath + the photo∪capsule corridor keep it clickable.
  if (pointerOnCapsule(event)) {
    keepImageBadge();
    return;
  }
  const img = imgAtPoint(event.clientX, event.clientY);
  if (img) {
    keepImageBadge();
    if (badgeForImg === img && imageBadge) {
      positionImageBadge(imageBadge, img.getBoundingClientRect());
      return;
    }
    if (imageBadgeTimer) clearTimeout(imageBadgeTimer);
    imageBadgeTimer = setTimeout(() => showImageBadge(img, img.getBoundingClientRect()), 80);
    return;
  }
  hideImageBadge();
}

document.addEventListener('pointermove', (event) => {
  if (event.pointerType === 'touch') return;
  onPointerSample(event);
}, { capture: true, passive: true });

// pointerleave capture on document fires for every descendant (img → overlay
// → capsule). That hides the button before the pointer can land on it.
document.documentElement.addEventListener('pointerleave', () => {
  if (!dialogOpen) hideImageBadge();
});

window.addEventListener('scroll', () => { if (!dialogOpen) hideImageBadge(); }, true);

chrome.runtime.onMessage.addListener((message, _sender, reply) => {
  if (message?.type !== 'capture-image') return;
  const srcUrl = String(message.srcUrl || '');
  if (!srcUrl) { reply({ ok: false, message: eu().imageUrlMissing }); return true; }
  const img = Array.from(document.images).find(i => imageUrlOf(i) === srcUrl) || null;
  pendingImage = { img, url: srcUrl };
  void openImageDialog().then(result => reply(result));
  return true;
});

function fillFileInfo(panel: HTMLElement, preview: ImageFilePreview | undefined, sourceUrl: string): void {
  const info = panel.querySelector('.fileInfo') as HTMLElement | null;
  if (!info) return;
  info.classList.remove('hidden');
  const dimLabel = info.querySelector('.dimLabel') as HTMLElement;
  const dimValue = info.querySelector('.dimValue') as HTMLElement;
  if (preview?.width && preview.height) {
    dimLabel.classList.remove('hidden');
    dimValue.classList.remove('hidden');
    dimValue.textContent = `${preview.width} × ${preview.height}`;
  }
  const sizeValue = info.querySelector('.sizeValue') as HTMLElement;
  sizeValue.textContent = `${((preview?.size || 0) / 1024 / 1024).toFixed(2)} MB`;
  (info.querySelector('.addedValue') as HTMLElement).textContent = new Date().toLocaleDateString();
  const swatches = info.querySelector('.swatches') as HTMLElement;
  swatches.replaceChildren();
  for (const color of preview?.colors ?? []) {
    const chip = document.createElement('span');
    chip.className = 'swatch';
    chip.title = color.hex;
    chip.setAttribute('aria-label', color.hex);
    chip.style.background = color.hex;
    swatches.append(chip);
  }
  const link = info.querySelector('.sourceLink') as HTMLAnchorElement;
  if (/^https?:\/\//i.test(sourceUrl)) {
    link.href = sourceUrl;
    link.classList.remove('hidden');
  }
}

async function openImageDialog(): Promise<{ ok: boolean; message: string }> {
  if (dialogOpen || !pendingImage) return { ok: false, message: eu().noPendingImage };
  hideToolbar();
  hideImageBadge();
  dialogOpen = true;
  const shadow = ensureRoot();
  const target = pendingImage;
  pendingImage = null;
  let stashId = '';
  let mime = '';
  let preview: ImageFilePreview | undefined;
  try {
    const read = await readOriginalImage(target.url, target.img);
    stashId = read.stashId;
    mime = read.mime;
    preview = read.preview;
  } catch (error) {
    dialogOpen = false;
    const captureMessage = captureFailureMessage(error);
    toast(captureMessage);
    return { ok: false, message: captureMessage };
  }

  const panel = document.createElement('div');
  panel.className = 'panel';
  panel.dataset.kind = 'image';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', eu().saveImageToLibrary);
  panel.innerHTML = panelHtml();
  shadow.append(panel);
  const q = <T extends HTMLElement>(sel: string) => panel.querySelector(sel) as T;
  let closed = false;
  let formDispose: (() => void) | null = null;
  const wasDragged = enablePanelDrag(panel, q('.head'));
  const close = () => {
    if (closed) return;
    closed = true;
    formDispose?.();
    panel.remove();
    dialogOpen = false;
    document.removeEventListener('mousedown', onOutside, true);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', reposition);
  };
  const onKey = (event: KeyboardEvent) => {
    // Let the tag picker consume its first Escape before dismissing the panel.
    if (event.key === 'Escape' && panel.querySelector('.tagPicker:not(.hidden)')) {
      event.stopPropagation();
      (panel.querySelector('.tagAdd') as HTMLButtonElement).click();
      (panel.querySelector('.tagAdd') as HTMLButtonElement).focus();
      return;
    }
    if (event.key === 'Escape') { event.stopPropagation(); close(); }
  };
  const onOutside = (event: MouseEvent) => {
    const node = event.target as Node | null;
    if (node && (host === node || host?.contains(node))) return;
    close();
  };
  const reposition = () => {
    if (wasDragged()) {
      const rect = panel.getBoundingClientRect();
      clampPanel(panel, rect.left, rect.top);
      return;
    }
    placeAside(panel);
  };
  document.addEventListener('keydown', onKey, true);
  document.addEventListener('mousedown', onOutside, true);
  window.addEventListener('resize', reposition);
  placeAside(panel);
  q('.previewText').textContent = target.img?.alt || (target.url.split('/').pop() || eu().webOriginal);
  q<HTMLInputElement>('#da-name').value = (target.img?.alt || target.url.split('/').pop() || eu().webOriginal).slice(0, 240);
  q('.sourceUrl').textContent = target.url;
  q('.sourceUrl').setAttribute('title', target.url);
  if (target.img) {
    const thumbnail = document.createElement('img');
    thumbnail.className = 'previewImage';
    thumbnail.alt = target.img.alt || eu().pendingImage;
    thumbnail.src = target.img.currentSrc || target.img.src;
    thumbnail.addEventListener('error', () => thumbnail.remove(), { once: true });
    q('.preview').prepend(thumbnail);
    q('.preview').classList.add('imagePreview');
  }
  fillFileInfo(panel, preview, target.url);
  q('.close').addEventListener('click', close);
  q('.cancel').addEventListener('click', close);
  q('.more').addEventListener('toggle', reposition);
  const form = setupAssetForm(panel, {
    isClosed: () => closed,
    onSave: async (asset) => {
      const result = await ask<InspectorReply>({
        type: 'save-capture',
        kind: 'image',
        capture: { pageUrl: location.href, title: document.title, imageUrl: target.url, alt: target.img?.alt, mime, filenameHint: asset.name },
        stashId,
        asset,
      });
      return result;
    },
  });
  formDispose = form.dispose;
  return { ok: true, message: eu().panelOpened };
}

async function decodeImageResponse(resp: Response): Promise<{ bytes: ArrayBuffer; mime: string }> {
  if (!resp.ok) throw new Error(eu().imageResponse(resp.status));
  const bytes = await resp.arrayBuffer();
  let mime = (resp.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!ALLOWED_IMAGE_MIMES.includes(mime)) mime = sniffImageMime(bytes) || mime;
  if (!ALLOWED_IMAGE_MIMES.includes(mime)) throw new Error(eu().unsupportedImage(mime));
  if (bytes.byteLength > IMAGE_BYTES_CAP) throw new Error(eu().imageTooLarge);
  return { bytes, mime };
}

async function readViaPageFetch(url: string): Promise<{ bytes: ArrayBuffer; mime: string }> {
  return decodeImageResponse(await fetch(url, { credentials: 'include', redirect: 'follow', cache: 'force-cache' }));
}

async function stashLocalBytes(bytes: ArrayBuffer, mime: string): Promise<{ stashId: string; mime: string; preview?: ImageFilePreview }> {
  const result = await ask<{ ok: boolean; stashId?: string; mime?: string; preview?: ImageFilePreview; message?: string }>({
    type: 'stash-image',
    mime,
    bytes: new Uint8Array(bytes),
  });
  if (!result?.ok || !result.stashId) throw new Error(result?.message || eu().stashFailed);
  return { stashId: result.stashId, mime, preview: result.preview };
}

async function readViaWorker(url: string, pageUrl: string): Promise<{ stashId: string; mime: string; preview?: ImageFilePreview }> {
  const result = await ask<{ ok: boolean; stashId?: string; mime?: string; byteLength?: number; preview?: ImageFilePreview; message?: string }>({
    type: 'fetch-image',
    url,
    pageUrl,
  });
  if (!result?.ok || !result.stashId) throw new Error(result?.message || eu().extensionCannotDownload);
  const mime = result.mime || '';
  if (!ALLOWED_IMAGE_MIMES.includes(mime)) throw new Error(eu().unsupportedImage(mime));
  if ((result.byteLength ?? 0) > IMAGE_BYTES_CAP) throw new Error(eu().imageTooLarge);
  return { stashId: result.stashId, mime, preview: result.preview };
}

async function readViaCanvas(img: HTMLImageElement): Promise<{ bytes: ArrayBuffer; mime: string }> {
  if (!img.naturalWidth) throw new Error(eu().imageNotLoaded);
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error(eu().cannotReadFrame);
  ctx.drawImage(img, 0, 0);
  const blob = await new Promise<Blob>((resolve, reject) => {
    try {
      canvas.toBlob((value) => { if (value) resolve(value); else reject(new Error(eu().cannotExportFrame)); }, 'image/png');
    } catch {
      reject(new Error(eu().crossOriginBlocked));
    }
  });
  return { bytes: await blob.arrayBuffer(), mime: blob.type || 'image/png' };
}

async function readViaAnonymousClone(url: string): Promise<{ bytes: ArrayBuffer; mime: string }> {
  if (url.startsWith('blob:') || url.startsWith('data:')) throw new Error('skip');
  const probe = new Image();
  probe.crossOrigin = 'anonymous';
  probe.decoding = 'async';
  const loaded = new Promise<HTMLImageElement>((resolve, reject) => {
    probe.onload = () => resolve(probe);
    probe.onerror = () => reject(new Error(eu().anonymousLoadFailed));
  });
  probe.src = url;
  return readViaCanvas(await loaded);
}

const MAX_IMAGE_URL_ATTEMPTS = 6;

async function asStash(read: { bytes: ArrayBuffer; mime: string }): Promise<{ stashId: string; mime: string; preview?: ImageFilePreview }> {
  return stashLocalBytes(read.bytes, read.mime);
}

async function readOriginalImage(url: string, img: HTMLImageElement | null): Promise<{ stashId: string; mime: string; preview?: ImageFilePreview }> {
  const candidates: string[] = [];
  const seen = new Set<string>();
  const add = (value: string | null | undefined) => {
    if (!value || seen.has(value)) return;
    seen.add(value);
    candidates.push(value);
  };
  if (img) for (const candidate of collectImageUrls(img, location.href)) add(candidate);
  add(url);

  const errors: string[] = [];
  for (const candidate of candidates.slice(0, MAX_IMAGE_URL_ATTEMPTS)) {
    if (candidate.startsWith('blob:') || candidate.startsWith('data:')) {
      try { return await asStash(await readViaPageFetch(candidate)); } catch (error) {
        errors.push(error instanceof Error ? error.message : eu().localImageFailed);
      }
      continue;
    }
    try { return await readViaWorker(candidate, location.href); } catch (error) {
      errors.push(error instanceof Error ? error.message : eu().extensionDownloadFailed);
    }
    try { return await asStash(await readViaPageFetch(candidate)); } catch (error) {
      errors.push(error instanceof Error ? error.message : eu().pageDownloadFailed);
    }
    try { return await asStash(await readViaAnonymousClone(candidate)); } catch (error) {
      errors.push(error instanceof Error ? error.message : eu().canvasCrossOriginFailed);
    }
  }
  if (img) {
    try { return await asStash(await readViaCanvas(img)); } catch (error) {
      errors.push(error instanceof Error ? error.message : eu().frameExportFailed);
    }
  }
  throw new Error(errors[0] || eu().cannotDownloadImage);
}

function sniffImageMime(bytes: ArrayBuffer): string | null {
  const u = new Uint8Array(bytes.slice(0, 16));
  const matches = (sig: number[]) => sig.every((b, i) => u[i] === b);
  if (matches([0x89, 0x50, 0x4e, 0x47])) return 'image/png';
  if (matches([0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (matches([0x47, 0x49, 0x46, 0x38])) return 'image/gif';
  if (matches([0x52, 0x49, 0x46, 0x46]) && u[8] === 0x57 && u[9] === 0x45 && u[10] === 0x42 && u[11] === 0x50) return 'image/webp';
  if (u[4] === 0x66 && u[5] === 0x74 && u[6] === 0x79 && u[7] === 0x70 && (u[8] === 0x61 || u[8] === 0x61)) return 'image/avif';
  return null;
}

async function openDialog(): Promise<void> {
  if (!pending || dialogOpen) return;
  hideImageBadge();
  hideToolbar();
  dialogOpen = true;
  const shadow = ensureRoot();
  const snapshot = pending;
  const panel = document.createElement('div');
  panel.className = 'panel';
  panel.dataset.kind = 'selection';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', eu().saveToLibrary);
  panel.innerHTML = panelHtml();
  shadow.append(panel);

  const q = <T extends HTMLElement>(sel: string) => panel.querySelector(sel) as T;
  let closed = false;
  let formDispose: (() => void) | null = null;
  const close = () => {
    if (closed) return;
    closed = true;
    formDispose?.();
    panel.remove();
    dialogOpen = false;
    pending = null;
    document.removeEventListener('mousedown', onOutside, true);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', reposition);
  };

  q('.previewText').textContent = snapshot.text;
  q<HTMLInputElement>('#da-name').value = (snapshot.title || eu().webSelection).slice(0, 240);
  q('.sourceUrl').textContent = snapshot.url;
  q('.sourceUrl').setAttribute('title', snapshot.url);

  const wasDragged = enablePanelDrag(panel, q('.head'));
  const reposition = () => {
    if (wasDragged()) {
      const rect = panel.getBoundingClientRect();
      clampPanel(panel, rect.left, rect.top);
      return;
    }
    place(panel, snapshot.rect, TOOLBAR_OFFSET);
  };
  reposition();
  q('.more').addEventListener('toggle', reposition);
  window.addEventListener('resize', reposition);

  const onOutside = (event: MouseEvent) => {
    const target = event.target as Node | null;
    if (target && (host === target || host?.contains(target))) return;
    close();
  };
  document.addEventListener('mousedown', onOutside, true);
  q('.close').addEventListener('click', close);
  q('.cancel').addEventListener('click', close);
  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && panel.querySelector('.tagPicker:not(.hidden)')) {
      event.stopPropagation();
      q<HTMLButtonElement>('.tagAdd').click();
      q<HTMLButtonElement>('.tagAdd').focus();
      return;
    }
    if (event.key === 'Escape') { event.stopPropagation(); close(); }
  };
  document.addEventListener('keydown', onKey, true);

  const form = setupAssetForm(panel, {
    isClosed: () => closed,
    onSave: async (asset) => {
      const result = await ask<InspectorReply>({
        type: 'save-capture',
        kind: 'selection',
        capture: { text: snapshot.text, pageUrl: snapshot.url, title: snapshot.title },
        asset,
      });
      return result;
    },
  });
  formDispose = form.dispose;
}



function extensionContextAlive(): boolean {
  try { return Boolean(chrome.runtime?.id); }
  catch { return false; }
}

function isExtensionContextError(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error || '');
  return /extension context invalidated/i.test(text);
}

function captureFailureMessage(error: unknown): string {
  if (isExtensionContextError(error) || !extensionContextAlive()) return eu().refreshPage;
  return error instanceof Error ? eu().originalFailedDetail(error.message) : eu().originalFailed;
}

function ask<T>(message: unknown, timeoutMs = 2500): Promise<T | null> {
  if (!extensionContextAlive()) return Promise.reject(new Error(eu().refreshPage));
  try {
    const sent = chrome.runtime.sendMessage(message).then(value => value as T).catch((error: unknown) => {
      if (isExtensionContextError(error) || !extensionContextAlive()) throw new Error(eu().refreshPage);
      return null;
    });
    const timed = new Promise<T | null>((resolve, reject) => {
      window.setTimeout(() => {
        if (!extensionContextAlive()) reject(new Error(eu().refreshPage));
        else resolve(null);
      }, timeoutMs);
    });
    return Promise.race([sent, timed]);
  } catch (error) {
    if (isExtensionContextError(error) || !extensionContextAlive()) return Promise.reject(new Error(eu().refreshPage));
    return Promise.resolve(null);
  }
}

function toast(message: string): void {
  const shadow = ensureRoot();
  const node = document.createElement('div');
  node.className = 'toast';
  node.innerHTML = `${LOGO}<span></span>`;
  (node.querySelector('span') as HTMLSpanElement).textContent = message;
  shadow.append(node);
  window.setTimeout(() => node.classList.add('out'), 2200);
  window.setTimeout(() => node.remove(), 2600);
}

const LOGO = APP_LOGO;
const STAR = icons.Star;

/**
 * Popover contents. Single column by design: at ~400px there is no room for the
 * old preview/inspector split, and the selected text is better read as a short
 * quote above the fields than as a facing column.
 *
 * The root element is created in `openDialog` (it owns the positioning), so this
 * string is the panel's children only.
 */
function panelHtml(): string {
  return `
  <header class="head">
    <button class="close" type="button" aria-label="${eu().close}">${icons.X}</button>
  </header>
  <div class="body">
    <div class="infoView">
    <section class="preview">
      <div class="previewText"></div>
      <div class="sourceRow"><span class="sourceUrl"></span></div>
    </section>
    <div class="section">
      <div class="sectionTitle">${eu().space}</div>
      <div class="spaceWrap">
        <button class="spaceBtn" type="button" disabled>
          ${icons.Folder}
          <span class="spaceName">${eu().defaultSpace}</span>
          ${icons.ChevronDown}
        </button>
        <div class="spaceMenu"></div>
      </div>
    </div>
    <div class="fields">
      <div class="section">
        <label class="sectionTitle" for="da-name">${eu().name}</label>
        <input id="da-name" maxlength="240" />
      </div>
      <div class="section">
        <div class="sectionTitle">${eu().tags}</div>
        <div class="tagWrap">
          <div class="tagList">
            <button class="tagAdd wide" type="button" aria-label="${eu().addTag}" aria-expanded="false">${icons.Plus}<span>${eu().addTag}</span></button>
          </div>
          <div class="tagPicker hidden">
            <div class="tagEntry"><input id="da-tag" placeholder="${eu().tagSearch}" maxlength="80" /></div>
            <div class="tagOptions"></div>
            <div class="tagPickerHint">${eu().enterAdd}<span>${eu().escClose}</span></div>
          </div>
        </div>
      </div>
      <div class="section">
        <label class="sectionTitle" for="da-desc">${eu().description}</label>
        <textarea id="da-desc" rows="2" maxlength="4000" placeholder="${eu().descriptionPlaceholder}"></textarea>
      </div>
      <details class="more">
        <summary><span class="moreLabel">${eu().moreInfo}</span>${icons.ChevronDown}</summary>
        <div class="moreBody">
          <div class="section">
            <label class="sectionTitle" for="da-style">${eu().style}</label>
            <textarea id="da-style" rows="2" maxlength="4000" placeholder="${eu().stylePlaceholder}"></textarea>
          </div>
          <div class="section">
            <label class="sectionTitle" for="da-usage">${eu().usage}</label>
            <textarea id="da-usage" rows="2" maxlength="4000" placeholder="${eu().usagePlaceholder}"></textarea>
          </div>
        </div>
      </details>
    </div>
    <div class="section ratingSection">
      <div class="sectionTitle">${eu().rating}</div>
      <div class="rating" role="group" aria-label="${eu().ratingAria}">
        <button type="button" class="star" data-star="1" aria-label="${eu().star(1)}" aria-pressed="false">${STAR}</button>
        <button type="button" class="star" data-star="2" aria-label="${eu().star(2)}" aria-pressed="false">${STAR}</button>
        <button type="button" class="star" data-star="3" aria-label="${eu().star(3)}" aria-pressed="false">${STAR}</button>
        <button type="button" class="star" data-star="4" aria-label="${eu().star(4)}" aria-pressed="false">${STAR}</button>
        <button type="button" class="star" data-star="5" aria-label="${eu().star(5)}" aria-pressed="false">${STAR}</button>
      </div>
    </div>
    <details class="fileInfo hidden">
      <summary><span>${eu().fileInfo}</span>${icons.ChevronDown}</summary>
      <dl class="fileMeta">
        <dt class="dimLabel hidden">${eu().dimensions}</dt><dd class="dimValue hidden"></dd>
        <dt>${eu().kind}</dt><dd class="kindValue">${eu().imageKind}</dd>
        <dt>${eu().size}</dt><dd class="sizeValue">—</dd>
        <dt>${eu().addedAt}</dt><dd class="addedValue"></dd>
      </dl>
      <div class="swatches" aria-label="${eu().imageColors}"></div>
      <a class="sourceLink hidden" target="_blank" rel="noreferrer">${eu().viewSource} ${icons.ArrowUpRight}</a>
    </details>
    </div>
    <section class="promptView hidden">
      <div class="promptActions"><span>${eu().creationPrompt}</span><button class="copyPrompt" type="button" disabled>${eu().copy}</button><button type="button" data-action="prompt">${eu().saveAndExtract}</button></div>
      <p class="promptStatus" role="status">${eu().promptHint}</p>
      <button type="button" class="retryRead hidden">${eu().reconnect}</button>
      <div class="promptText empty">${eu().promptPlaceholder}</div>
    </section>
    <textarea aria-label="${eu().assetYaml}" id="da-yaml" class="hidden" rows="12" spellcheck="false"></textarea>
    <p class="error hidden" role="alert"></p>
  </div>
    <div class="inspectorTools">
      <label class="aifill" for="da-aifill"><input id="da-aifill" type="checkbox" />${icons.Sparkles}<span>${eu().aiFill}</span></label>
      <button class="yamlToggle" type="button">YAML</button>
    </div>
  <footer class="foot">
    <p class="status" role="status" aria-live="polite"><span class="dot" aria-hidden="true"></span><span class="statusText">${eu().connecting}</span></p>
    <div class="footActions">
      <button class="cancel" type="button">${eu().cancel}</button>
      <button class="save" type="button" disabled>${eu().saveToLibrary}</button>
    </div>
  </footer>`;
}

const STYLES = `
:host {
  all: initial;
  /* One spacing/colour scale for the whole popover. The accent is plain black
     rather than a brand hue: the panel floats over arbitrary sites, and neutral
     ink reads as part of the browser instead of competing with page colour. */
  --ink: #100f09;
  --ink-soft: #525251;
  --ink-mute: #7c7c79;
  --ink-faint: #a3a3a0;
  --line: #e5e5e5;
  --line-soft: #f0f0f0;
  --fill-quiet: #f5f5f5;
  --surface-sunk: #fafafa;
  --brand: #100f09;
  --brand-hover: #353535;
  --brand-tint: #f5f5f5;
  --brand-tint-hover: #e5e5e5;
  --ring: 0 0 0 3px rgba(15,23,42,.1);
  --gap-section: 16px;
}
* { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "SF Pro SC", "PingFang SC", "Segoe UI", sans-serif; }
.logo { width: 42px; height: 16px; flex: none; }


.bar {
  position: fixed; top: 0; left: 0; display: flex; padding: 0;
  animation: pop 140ms cubic-bezier(.23,1,.32,1);
}
@keyframes pop { from { opacity: 0; } }
.bar, .panel, .toast, .imgBadge { pointer-events: auto; }
/* One neutral capture control for text and images. The image action reveals
   its label on intent, leaving the artwork visible at rest. */
.barBtn, .imgBadge {
  display: inline-flex; align-items: center; justify-content: center;
  height: 40px; border: 1px solid rgba(255,255,255,.8); border-radius: 13px;
  background: rgba(255,255,255,.9); color: var(--ink); cursor: pointer; white-space: nowrap;
  backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
  box-shadow: 0 0 0 1px #00000006, 0 3px 8px #0000000a, 0 8px 24px #0000000d;
  font-size: 12px; font-weight: 500; line-height: 1;
  transition: background 140ms cubic-bezier(.23,1,.32,1), box-shadow 140ms cubic-bezier(.23,1,.32,1);
}
.barBtn { gap: 9px; padding: 0 12px 0 7px; }
.barBtn .logo, .imgBadgeMark .logo { width: 50px; height: 24px; display: block; }
.barBtn:hover, .imgBadge:hover { background: rgba(255,255,255,.98); box-shadow: 0 0 0 1px #00000008, 0 4px 10px #0000000c, 0 10px 28px #00000012; }
.barBtn:active, .imgBadge:active { background: #f5f5f5; box-shadow: 0 0 0 1px #0000000a, 0 2px 6px #0000000d; }
.barBtn:focus-visible, .imgBadge:focus-visible { outline: 1px solid var(--ink-mute); outline-offset: 3px; }
.barOffline .barLabel { color: var(--ink-mute); }
.imgBadge {
  position: fixed; top: 0; left: 0; padding: 0 7px; gap: 0;
  z-index: 2147483647; animation: pop 140ms cubic-bezier(.23,1,.32,1);
}
.imgBadge::before { content: ""; position: absolute; inset: -6px; }
.imgBadgeMark { width: 50px; height: 24px; flex: none; display: grid; place-items: center; }
.imgLabel {
  max-width: 0; opacity: 0; overflow: hidden; margin-left: 0;
  font-size: 12px; font-weight: 500; line-height: 20px;
  transition: max-width 200ms cubic-bezier(.23,1,.32,1), margin-left 200ms cubic-bezier(.23,1,.32,1), opacity 140ms cubic-bezier(.23,1,.32,1);
}
.imgBadge:hover .imgLabel, .imgBadge:focus-visible .imgLabel {
  max-width: 90px; margin-left: 9px; opacity: 1;
}

/* The panel positions itself exactly like the toolbar (fixed, translated onto
   the selection) — no scrim, so the page stays readable and clickable behind
   it. Dismissal is handled by an outside-click listener in JS, not by a
   full-viewport backdrop. */
.panel {
  position: fixed; top: 0; left: 0; width: 380px; max-width: calc(100vw - 16px);
  max-height: min(720px, calc(100vh - 32px)); display: flex; flex-direction: column;
  background: #fff; border: 1px solid rgba(15,23,42,.1); border-radius: 14px; overflow: hidden;
  box-shadow: 0 12px 36px #00000012, 0 2px 6px #00000006;
  animation: pop .12s ease-out;
}
.head { display: flex; align-items: center; justify-content: flex-end; padding: 6px 10px 0; flex: none; cursor: grab; user-select: none; touch-action: none; }
.head:active { cursor: grabbing; }
.head .close { cursor: pointer; }
.close {
  display: grid; place-items: center; width: 24px; height: 24px; flex: none;
  border: 0; border-radius: 7px; background: transparent; font-size: 17px; line-height: 1;
  color: var(--ink-mute); cursor: pointer; transition: background .14s cubic-bezier(.23,1,.32,1), color .12s ease;
}
.close:hover { background: var(--fill-quiet); color: var(--ink); }

/* Single scroll container: at this width the old two-column split can't fit,
   so the quote sits above the fields and the whole stack scrolls as one. */
.body { display: flex; flex-direction: column; gap: var(--gap-section); padding: 6px 20px 18px; overflow: auto; min-height: 0; flex: 1 1 auto; }
.preview {
  display: flex; flex-direction: column; gap: 7px; flex: none;
  padding: 9px 11px; border-radius: 9px; background: var(--surface-sunk); border: 1px solid var(--line-soft);
}
.sectionTitle { font-size: 11px; font-weight: 500; color: var(--ink-soft); }
/* The quote is clamped rather than scrollable: a popover this size should show
   enough to confirm what was grabbed, not host a reading pane. */
.previewText {
  font-size: 12px; line-height: 1.7; color: var(--ink-soft); white-space: pre-wrap; word-break: break-word;
  display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;
}
.sourceRow { display: flex; font-size: 11px; color: var(--ink-faint); min-width: 0; }
.sourceUrl { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* AI fill and YAML sit at the end of the stack: they act on the fields above
   them, and putting them there keeps the header free of controls. */
.inspectorTools { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex: none; padding-top: 2px; }

/* white-space:nowrap is load-bearing here: without it the AI fill label collapses to
   one character per line inside this narrow flex item. */
.aifill {
  display: inline-flex; align-items: center; gap: 6px; flex: none; white-space: nowrap;
  font-size: 12px; color: var(--ink-soft); cursor: pointer;
  padding: 4px 8px 4px 6px; border-radius: 7px; transition: background .12s ease;
}
.aifill:hover { background: var(--fill-quiet); }
.aifill input { margin: 0; width: 13px; height: 13px; accent-color: var(--brand); flex: none; cursor: pointer; }
.yamlToggle {
  border: 1px solid var(--line); background: #fff; border-radius: 7px;
  padding: 4px 10px; font-size: 12px; font-weight: 500; color: var(--ink-soft);
  cursor: pointer; white-space: nowrap; transition: background .12s ease, border-color .12s ease;
}
.yamlToggle:hover { background: var(--fill-quiet); border-color: #d4d4d4; }

.fields { display: flex; flex-direction: column; gap: var(--gap-section); }
.section { display: flex; flex-direction: column; gap: 5px; }
input, textarea {
  width: 100%; border: 1px solid var(--line); border-radius: 8px; padding: 7px 10px;
  font-size: 13px; color: var(--ink); background: #fff; resize: vertical; line-height: 1.6;
  transition: border-color .12s ease, box-shadow .12s ease;
}
input::placeholder, textarea::placeholder { color: #a3a3a0; }
input:hover:not(:focus), textarea:hover:not(:focus) { border-color: #d4d4d4; }
input:focus, textarea:focus { outline: none; border-color: #969693; box-shadow: none; }
#da-yaml { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; line-height: 1.7; }
button:focus-visible { outline: 1px solid var(--ink-mute); outline-offset: 2px; }
input:focus-visible, textarea:focus-visible { outline: none; border-color: #969693; box-shadow: none; }
@media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; } }
.more { border-top: 1px solid var(--line-soft); padding-top: 11px; }
.more summary {
  display: flex; align-items: center; gap: 5px; cursor: pointer; list-style: none;
  font-size: 12px; font-weight: 600; color: var(--ink-mute); width: fit-content;
}
.more summary::-webkit-details-marker { display: none; }
.more summary:hover { color: var(--ink-soft); }
.more summary .chev { transition: transform .15s ease; }
.more[open] summary .chev { transform: rotate(180deg); }
.moreBody { display: flex; flex-direction: column; gap: var(--gap-section); padding-top: 11px; }

.body::-webkit-scrollbar { width: 10px; }
.body::-webkit-scrollbar-thumb {
  background: #dedede; border-radius: 99px; border: 3px solid transparent; background-clip: content-box;
}
.body::-webkit-scrollbar-thumb:hover { background: #c5c5c5; background-clip: content-box; }
.body::-webkit-scrollbar-track { background: transparent; }

.spaceWrap { position: relative; }
.spaceBtn {
  display: flex; align-items: center; gap: 8px; width: 100%; padding: 7px 10px;
  border: 1px solid var(--line); border-radius: 8px; background: #fff; cursor: pointer;
  font-size: 13px; color: var(--ink); text-align: left;
  transition: border-color .12s ease, background .12s ease;
}
.spaceBtn:hover:not(:disabled) { border-color: #d4d4d4; background: #fcfdfe; }
.spaceBtn:disabled { opacity: .55; cursor: default; }
.spaceName { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.folder { width: 15px; height: 15px; fill: #a3a3a0; flex: none; }
.chev { width: 13px; height: 13px; fill: none; stroke: #a3a3a0; stroke-width: 1.6; flex: none; }
.spaceMenu {
  display: none; position: absolute; top: calc(100% + 5px); left: 0; right: 0; z-index: 5;
  background: #fff; border: 1px solid var(--line); border-radius: 10px; padding: 5px;
  box-shadow: 0 14px 36px rgba(15,23,42,.15); max-height: 200px; overflow: auto;
}
.spaceMenu.open { display: block; }
.spaceItem { display: block; width: 100%; text-align: left; border: 0; background: transparent; padding: 7px 9px; border-radius: 7px; font-size: 13px; color: var(--ink); cursor: pointer; transition: background .1s ease; }
.spaceItem:hover { background: var(--fill-quiet); }
.spaceItem.on { background: var(--brand-tint); color: var(--brand); font-weight: 500; }

.tagWrap { position: relative; }
.tagList {
  display: flex; flex-wrap: wrap; gap: 5px; align-items: center;
  border: 1px solid var(--line); border-radius: 8px; padding: 5px 6px; min-height: 34px;
  transition: border-color .12s ease, box-shadow .12s ease;
}
.tagList:hover { border-color: #d4d4d4; }
.tagAdd {
  display: inline-flex; align-items: center; justify-content: center; gap: 4px;
  border: 0; background: transparent; color: var(--ink-mute); cursor: pointer;
  font-size: 12px; font-weight: 500; padding: 3px 7px; border-radius: 6px; line-height: 1.2;
}
.tagAdd.wide { width: 100%; justify-content: flex-start; padding: 4px 6px; }
.tagAdd:hover { background: var(--fill-quiet); color: var(--ink-soft); }
.tagPicker {
  position: absolute; top: calc(100% + 5px); left: 0; right: 0; z-index: 6;
  background: #fff; border: 1px solid var(--line); border-radius: 10px;
  box-shadow: 0 8px 24px #00000012, 0 2px 6px #00000005; overflow: hidden;
}
.tagEntry { display: flex; align-items: center; padding: 6px 12px; border-bottom: 1px solid var(--line-soft); }
.tagEntry:focus-within { background: var(--surface-sunk); }
.tagEntry input { border: 0; border-radius: 0; padding: 4px 0; font-size: 12px; background: transparent; }
.tagEntry input:focus, .tagEntry input:focus-visible { outline: none; box-shadow: none; border: 0; }
.tagOptions {
  display: flex; flex-direction: column; gap: 2px;
  padding: 5px; max-height: 160px; overflow: auto;
}
.tagCreate { grid-column: 1 / -1; justify-content: flex-start; }
.tagOption, .tagCreate {
  display: flex; align-items: center; justify-content: space-between; gap: 6px;
  width: 100%; text-align: left; border: 0; background: transparent; cursor: pointer;
  padding: 7px 9px; border-radius: 5px; font-size: 12px; color: var(--ink);
}
.tagOption:hover, .tagCreate:hover { background: var(--fill-quiet); }
.tagOption.on { background: var(--brand-tint); color: var(--brand); font-weight: 500; }
.tagEmpty { grid-column: 1 / -1; margin: 0; padding: 8px; font-size: 12px; color: var(--ink-faint); }
.tagPickerHint {
  display: flex; justify-content: space-between; padding: 6px 12px;
  border-top: 1px solid var(--line-soft); font-size: 10px; color: var(--ink-faint);
}
.tag {
  display: inline-flex; align-items: center; gap: 4px; border: 0;
  background: var(--brand-tint); color: var(--brand); border-radius: 6px;
  padding: 3px 7px; font-size: 12px; line-height: 1.2; cursor: pointer;
  transition: background .12s ease;
}
.tag:hover { background: var(--brand-tint-hover); }

.rating { display: flex; gap: 2px; }
.rating .star {
  width: 26px; height: 28px; padding: 3px; border: 0; background: transparent; cursor: pointer;
  color: var(--ink-faint); opacity: .45;
}
.rating .star svg { width: 16px; height: 16px; fill: none; display: block; }
.rating .star[aria-pressed="true"] svg { fill: currentColor; }
.rating .star[aria-pressed="true"], .rating .star:hover { opacity: 1; color: var(--ink-soft); }
.fileInfo { display: flex; flex-direction: column; gap: 8px; padding-top: 2px; }
.fileMeta { display: grid; grid-template-columns: 62px minmax(0, 1fr); gap: 8px 10px; margin: 0; font-size: 11px; line-height: 1.5; color: var(--ink-mute); }
.fileMeta dt { color: var(--ink-faint); }
.fileMeta dd { margin: 0; overflow-wrap: anywhere; color: var(--ink-soft); }
.swatches { display: flex; flex-wrap: wrap; gap: 6px; }
.swatch {
  width: 22px; height: 22px; border-radius: 4px; border: 1px solid var(--line);
  display: inline-block;
}
.sourceLink {
  display: inline-flex; align-items: center; gap: 4px; margin-top: 4px; width: fit-content;
  color: var(--ink); font-size: 12px; text-decoration: none;
}
.sourceLink:hover { text-decoration: underline; }

.error {
  margin: 0; font-size: 12px; line-height: 1.6; color: #b91c1c;
  background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 8px 10px;
}
.hidden { display: none !important; }

/* Connection state lives bottom-left, next to the action it gates, instead of
   competing with the field labels at the top of the form. */
.foot {
  display: flex; align-items: center; justify-content: space-between; gap: 10px; flex: none;
  padding: 12px 20px 16px; border-top: 1px solid var(--line-soft); background: var(--surface-sunk);
}
.footActions { display: flex; gap: 6px; flex: none; }
.status {
  display: flex; align-items: center; gap: 6px; margin: 0; min-width: 0;
  font-size: 11px; color: var(--ink-mute);
}
.statusText { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dot { width: 6px; height: 6px; border-radius: 50%; background: #d4d4d4; flex: none; }
.status.ok { color: #047857; }
.status.ok .dot { background: #10b981;  }
.status.bad { color: #b91c1c; }
.status.bad .dot { background: #ef4444;  }
.foot button { border-radius: 8px; padding: 6px 13px; font-size: 12px; cursor: pointer; border: 1px solid transparent; white-space: nowrap; transition: background .12s ease, border-color .12s ease; }
.cancel { background: #fff; border-color: var(--line); color: var(--ink-soft); }
.cancel:hover { background: var(--fill-quiet); border-color: #d4d4d4; }
.save { background: var(--brand); color: #fff; font-weight: 500; }
.save:hover:not(:disabled) { background: var(--brand-hover); }
.save:disabled { opacity: .55; cursor: default; }

.toast {
  position: fixed; left: 50%; bottom: 28px; transform: translateX(-50%);
  display: flex; align-items: center; gap: 8px; padding: 10px 16px;
  background: #100f09; color: #fff; border-radius: 10px; font-size: 13px;
  box-shadow: 0 12px 32px rgba(15,23,42,.3); transition: opacity .3s, transform .3s;
}

.toast.out { opacity: 0; transform: translateX(-50%) translateY(6px); }
/* Asset inspector hierarchy, using DA's neutral surface and control geometry. */
.close { width: 28px; height: 28px; }
.lucide { flex: none; vertical-align: middle; }
.preview { border: 0; padding: 12px; gap: 4px; background: var(--fill-quiet); }
.imagePreview { display: grid; grid-template-columns: 64px minmax(0,1fr); column-gap: 12px; align-content: center; }
.previewImage { grid-row: 1 / 3; width: 64px; height: 64px; object-fit: contain; border-radius: 6px; background: #fff; }
.imagePreview .previewText { -webkit-line-clamp: 2; align-self: end; line-height: 1.5; }
.imagePreview .sourceRow { grid-column: 2; align-self: start; }
input, textarea, .spaceBtn { border-radius: 9px; font-size: 12px; }
input, .spaceBtn { min-height: 36px; }
textarea { min-height: 64px; }
.section { gap: 6px; }
.spaceBtn .lucide { color: var(--ink-mute); width: 15px; height: 15px; }
.tagList { min-height: 36px; border-style: dashed; }
.tagList:has(.tag) { border-style: solid; }
.tag .lucide { width: 12px; height: 12px; opacity: .65; }
.more { padding-top: 14px; }
.more summary { width: 100%; justify-content: space-between; font-weight: 500; }
.more[open] summary .lucide-chevron-down, .fileInfo[open] summary .lucide-chevron-down { transform: rotate(180deg); }
.ratingSection { flex-direction: row; align-items: center; justify-content: space-between; gap: 8px; border-top: 1px solid var(--line-soft); padding-top: 10px; }
.rating .star { display: grid; place-items: center; width: 25px; height: 28px; opacity: 1; color: var(--ink-faint); border-radius: 5px; }
.rating .star:hover { background: var(--fill-quiet); }
.fileInfo { display: block; border-top: 1px solid var(--line-soft); padding-top: 12px; }
.fileInfo summary { display: flex; justify-content: space-between; align-items: center; cursor: pointer; font-size: 11px; color: var(--ink-soft); list-style: none; }
.fileInfo summary::-webkit-details-marker { display: none; }
.fileMeta { margin-top: 12px; padding: 12px; background: var(--surface-sunk); border-radius: 8px; gap: 6px 10px; }
.swatches { gap: 0; margin-top: 10px; border-radius: 5px; overflow: hidden; width: fit-content; }
.swatch { border-radius: 0; width: 28px; height: 18px; border: 0; }
.sourceLink { margin-top: 10px; font-size: 11px; color: var(--ink-mute); }
.inspectorTools { padding: 10px 20px; border-top: 1px solid var(--line-soft); background: #fff; }
.aifill { padding-left: 0; font-size: 11px; }
.aifill input { min-height: 0; }
.yamlToggle { border: 0; background: var(--fill-quiet); font-size: 11px; }
.foot { background: #fff; border-top: 0; flex-wrap: wrap; }
.foot button { min-height: 34px; border-radius: 9px; padding: 6px 14px; }
.status.ok { color: var(--ink-mute); }
.status { flex: 1; min-width: 80px; }
.footActions { margin-left: auto; }
.save:disabled { opacity: .35; }
button, summary { -webkit-tap-highlight-color: transparent; }
summary:focus-visible { outline: 2px solid var(--brand); outline-offset: 3px; border-radius: 3px; }

.head { justify-content: space-between; padding: 14px 18px 12px; border-bottom: 1px solid var(--line-soft); }
.inspectorTabs { display: flex; align-items: center; gap: 18px; }
.inspectorTabs button { padding: 4px 0; background: transparent; border: 0; border-radius: 0; color: var(--ink-faint); font-size: 13px; font-weight: 500; letter-spacing: .02em; cursor: pointer; }
.inspectorTabs button[aria-selected="true"] { color: var(--ink); font-weight: 650; }
.inspectorTabs button:hover { color: var(--ink-soft); }
.infoView { display: flex; flex-direction: column; gap: 16px; }
.promptView { min-height: 280px; }
.promptActions { display: flex; align-items: center; gap: 12px; font-size: 12px; }
.promptActions > span { margin-right: auto; font-weight: 600; }
.promptActions button, .analyze, .retryRead { border: 0; background: transparent; padding: 5px 0; font-size: 11px; color: var(--ink-soft); cursor: pointer; }
.promptActions button:disabled { opacity: .4; cursor: default; }
.promptStatus { margin: 14px 0; color: var(--ink-mute); line-height: 1.7; font-size: 11px; }
.promptStatus.failed { color: #b43c30; }
.promptText { white-space: pre-wrap; overflow-wrap: anywhere; font-size: 13px; line-height: 1.9; color: var(--ink-soft); padding-top: 16px; border-top: 1px solid var(--line-soft); user-select: text; }
.promptText.empty { color: var(--ink-faint); }
#da-yaml { min-height: 300px; background: #fff; }
.hidden { display: none !important; }
`;

void chrome.storage?.local?.get('capturePrefs').then((got) => {
  capturePrefs = parseCapturePrefs(got?.capturePrefs);
  if (!capturePrefs.imageHover) hideImageBadge();
  if (!capturePrefs.selectionBar) hideToolbar();
}).catch(() => undefined);
chrome.storage?.onChanged?.addListener((changes, area) => {
  if (area !== 'local' || !changes.capturePrefs) return;
  capturePrefs = parseCapturePrefs(changes.capturePrefs.newValue);
  if (!capturePrefs.imageHover) hideImageBadge();
  if (!capturePrefs.selectionBar) hideToolbar();
});

export {};
