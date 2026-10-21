import { listRegisteredPacks } from './card-ops.js';

/** What an agent can read on a card inside canvas state, and which action writes it.
 * There is no second channel: read the state JSON, then call the named action. */
export interface AgentCardSurface {
  read: string[];
  write: Record<string, string>;
  /** Set when a bound App owns the body. `readField` is still the copy inside canvas JSON. */
  boundApp?: { appId: string; readField: string; writeAction: string };
}

export const CORE_AGENT_SURFACE: Record<string, AgentCardSurface> = {
  text: {
    read: ['title', 'text', 'projectFilePath'],
    write: { title: 'node.rename', text: 'node.update' },
    boundApp: { appId: 'doc', readField: 'text', writeAction: 'doc.write' },
  },
  image: {
    read: ['name', 'path'],
    write: { path: 'image.replace' },
  },
  sketch: {
    read: ['title', 'projectFilePath'],
    write: { document: 'sketch.update', title: 'node.rename' },
  },
  storyboard: {
    read: ['title', 'storyboard'],
    write: { shot: 'storyboard.shot.update', title: 'node.rename' },
  },
  video: {
    read: ['title', 'text', 'projectFilePath', 'videoAspect', 'videoLength', 'videoResolution'],
    write: { config: 'video.configure', path: 'video.attach', title: 'node.rename' },
  },
  page: {
    read: ['title', 'projectFilePath', 'artifactFormat'],
    write: { path: 'document.select', title: 'node.rename' },
  },
  presentation: {
    read: ['title', 'projectFilePath', 'artifactFormat'],
    write: { path: 'document.select', title: 'node.rename' },
  },
};

export function listAgentSurface(): { readState: string; writeAction: string; cards: Record<string, AgentCardSurface> } {
  const cards: Record<string, AgentCardSurface> = { ...CORE_AGENT_SURFACE };
  for (const pack of listRegisteredPacks()) {
    for (const kind of pack.kinds) {
      const declared = pack.agent?.[kind];
      if (declared) {
        cards[kind] = declared;
        continue;
      }
      if (!kind.startsWith('card.')) continue;
      const write: Record<string, string> = {};
      for (const actionId of pack.ops) {
        if (!actionId.startsWith(`${kind}.`)) continue;
        write[actionId.slice(kind.length + 1)] = actionId;
      }
      cards[kind] = { read: ['title', 'data', 'projectFilePath'], write };
    }
  }
  return {
    readState: 'GET /api/apps/canvas/instances/{instanceId}/state',
    writeAction: 'POST /api/apps/canvas/instances/{instanceId}/actions/{actionId}',
    cards,
  };
}
