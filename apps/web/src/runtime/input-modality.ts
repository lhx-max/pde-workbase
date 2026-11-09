// Restored from Bezier/Loom 319e5eee556a3641d2ee68a6111a36ddc7a1eff7 (Apache-2.0).
// Standalone DOM input tracking; no product runtime dependencies.
type InputModality = 'keyboard' | 'pointer';

const ATTRIBUTE = 'data-input-modality';
const NAVIGATION_KEYS = new Set([
  'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', ' ',
  'Escape', 'Home', 'End', 'PageUp', 'PageDown',
]);
const NON_EDITABLE_INPUT_TYPES = new Set([
  'button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit',
]);

interface Installation {
  modality: InputModality;
  users: number;
  dispose: () => void;
}

const installations = new WeakMap<Document, Installation>();

function isEditable(event: KeyboardEvent): boolean {
  // composedPath preserves an editor inside an open shadow root.
  const target = event.composedPath()[0] ?? event.target;
  if (!target || (target as Node).nodeType !== 1) return false;
  const element = target as HTMLElement;
  if (element.localName === 'input') {
    const input = element as HTMLInputElement;
    return !input.readOnly && !input.disabled && !NON_EDITABLE_INPUT_TYPES.has(input.type);
  }
  if (element.localName === 'textarea') {
    const textarea = element as HTMLTextAreaElement;
    return !textarea.readOnly && !textarea.disabled;
  }
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    const editable = node.getAttribute('contenteditable')?.toLowerCase();
    if (editable === 'false') return false;
    if (editable === '' || editable === 'true' || editable === 'plaintext-only') return true;
  }
  return element.isContentEditable === true;
}

function trackDocument(doc: Document): Installation {
  const root = doc.documentElement;
  const priorAttribute = root.getAttribute(ATTRIBUTE);
  const forcedColors = doc.defaultView?.matchMedia?.('(forced-colors: active)');
  let physicalMode: InputModality = 'keyboard';
  let position: { x: number; y: number } | undefined;
  const state: Installation = { modality: 'keyboard', users: 0, dispose };

  function update() {
    state.modality = forcedColors?.matches ? 'keyboard' : physicalMode;
    if (root.getAttribute(ATTRIBUTE) !== state.modality) {
      root.setAttribute(ATTRIBUTE, state.modality);
    }
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.isComposing || event.keyCode === 229 || !NAVIGATION_KEYS.has(event.key)) return;
    if (event.key !== 'Tab' && event.key !== 'Escape' && isEditable(event)) return;
    // Modified navigation still counts (Shift+Tab, word/page navigation, and
    // assistive-technology arrow chords); letter/tool shortcuts never get here.
    physicalMode = 'keyboard';
    update();
  }

  function recordPosition(event: PointerEvent) {
    position = { x: event.clientX, y: event.clientY };
  }

  function onPointerDown(event: PointerEvent) {
    recordPosition(event);
    physicalMode = 'pointer';
    update();
  }

  function onPointerMove(event: PointerEvent) {
    // The first move is pointer evidence; thereafter require changed coordinates
    // so stationary events cannot erase a subsequent keyboard-navigation mode.
    const moved = position === undefined
      || event.clientX !== position.x || event.clientY !== position.y;
    recordPosition(event);
    if (moved) {
      physicalMode = 'pointer';
      update();
    }
  }

  function dispose() {
    doc.removeEventListener('keydown', onKeyDown, true);
    doc.removeEventListener('pointerdown', onPointerDown, true);
    doc.removeEventListener('pointermove', onPointerMove, true);
    forcedColors?.removeEventListener('change', update);
    if (root.getAttribute(ATTRIBUTE) !== priorAttribute) {
      if (priorAttribute === null) root.removeAttribute(ATTRIBUTE);
      else root.setAttribute(ATTRIBUTE, priorAttribute);
    }
  }

  doc.addEventListener('keydown', onKeyDown, true);
  doc.addEventListener('pointerdown', onPointerDown, true);
  doc.addEventListener('pointermove', onPointerMove, { capture: true, passive: true });
  forcedColors?.addEventListener('change', update);
  update();
  return state;
}

/** Effective focus-indicator mode; absent installation always fails safe. */
export function getInputModality(doc: Document): InputModality {
  return installations.get(doc)?.modality ?? 'keyboard';
}

/**
 * Observe physical input without changing focus or native event behavior.
 * Forced colors keeps indicators enabled while retaining the latest physical
 * mode. Installers share one document observer; the last cleanup restores the
 * original attribute, including during React StrictMode setup/cleanup cycles.
 */
export function installInputModality(doc: Document): () => void {
  let state = installations.get(doc);
  if (!state) {
    state = trackDocument(doc);
    installations.set(doc, state);
  }
  const installation = state;
  installation.users += 1;
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    installation.users -= 1;
    if (installation.users === 0) {
      installation.dispose();
      installations.delete(doc);
    }
  };
}
