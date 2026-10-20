import type { OnBeforeRequestListenerDetails, Session } from 'electron';

type State = { allow?: (details: OnBeforeRequestListenerDetails) => boolean; observers: Set<(details: OnBeforeRequestListenerDetails) => void> };
const states = new WeakMap<Session, State>();
function refresh(session: Session, state: State) {
  if (!state.allow && state.observers.size === 0) { session.webRequest.onBeforeRequest(null); states.delete(session); return; }
  session.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
    if (state.allow && !state.allow(details)) { callback({ cancel: true }); return; }
    try { for (const observe of state.observers) observe(details); }
    finally { callback({}); }
  });
}
function get(session: Session): State {
  let state = states.get(session);
  if (!state) { state = { observers: new Set() }; states.set(session, state); }
  return state;
}
/** Electron has only one onBeforeRequest listener: never replace security with capture observation. */
export function setBrowserRequestPolicy(session: Session, allow: (details: OnBeforeRequestListenerDetails) => boolean): void {
  const state = get(session); state.allow = allow; refresh(session, state);
}
export function observeBrowserRequests(session: Session, observe: (details: OnBeforeRequestListenerDetails) => void): () => void {
  const state = get(session); state.observers.add(observe); refresh(session, state);
  return () => { state.observers.delete(observe); refresh(session, state); };
}
