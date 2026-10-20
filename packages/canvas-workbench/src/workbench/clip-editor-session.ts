import type { CanvasHostContext } from '../platform/api-base';
import type { CanvasClipTimeline } from './clip-timeline';

/** Selection and scrubbing do not change the rendered composition. */
export function clipCompositionKey(timeline: CanvasClipTimeline): string {
  const { playhead: _p, selectedClipId: _c, ...composition } = timeline;
  return JSON.stringify(composition);
}

export function clipSessionKey(context: CanvasHostContext, nodeId: string): string {
  return JSON.stringify([context.workspaceContext?.workspaceId, context.workspaceContext?.workspaceMemberId, context.projectId, nodeId]);
}

type ClipHistory = { past: CanvasClipTimeline[]; future: CanvasClipTimeline[]; current: string };
const histories = new Map<string, ClipHistory>();

/** Metadata hydration is not a user edit and must not consume an undo step. */
export function hydrateClipDuration(history: ClipHistory, timeline: CanvasClipTimeline, path: string, duration: number): CanvasClipTimeline {
  const hydrate = (snapshot: CanvasClipTimeline): CanvasClipTimeline => ({
    ...snapshot,
    clips: snapshot.clips.map(clip => clip.path === path && !clip.sourceDuration
      ? { ...clip, sourceDuration: duration, duration: Math.min(clip.duration, Math.max(0, duration - clip.sourceIn) / (clip.playbackRate || 1)) }
      : clip),
  });
  history.past = history.past.map(hydrate);
  history.future = history.future.map(hydrate);
  const next = hydrate(timeline);
  history.current = clipCompositionKey(next);
  return next;
}

/** Survives mode switches, but never applies history to externally replaced content. */
export function clipHistoryFor(key: string, timeline: CanvasClipTimeline): ClipHistory {
  const current = clipCompositionKey(timeline);
  let history = histories.get(key);
  if (!history || history.current !== current) {
    history = { past: [], future: [], current };
    histories.set(key, history);
  }
  if (histories.size > 100) histories.delete(histories.keys().next().value!);
  return history;
}
