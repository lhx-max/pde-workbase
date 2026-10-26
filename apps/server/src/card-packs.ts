import { registerCardOp, registerCardPack, listRegisteredPacks, type CardOpHandler, type MountedCardPack } from './canvas/card-ops.js';
import type { CardRegistryStore } from './storage/card-registry.js';

/** Structural pack shape — packs compile against `CardPack` in the workbench
 * types; the server only needs kind + ops to wire the action pipeline.
 * `packId`/`name` are optional; the team segment of `card.<team>.<name>`
 * provides the default identity. */
type CardPackLike = {
  packId?: string;
  name?: string;
  cards: { kind: string; /** App id that owns this kind's deep editor (e.g. 'doc'). */
    editorApp?: string;
    /** Fields of this card the agent reads in canvas state, and the action that writes each. */
    agent?: { read: string[]; write?: Record<string, string> };
    ops?: Record<string, CardOpHandler | { handler: CardOpHandler; targets?: string }> }[];
};

/** Server-side card-pack mount: each pack's card ops register under
 * `card.<team>.<name>.<verb>`. One import line per pack (build-time, v1). */
import demoPackServer from '@bezier/canvas-pack-demo/server';
import imagePackServer from '@ks-designai/image-card-pack/server';

const CARD_PACKS: CardPackLike[] = [
  demoPackServer,
  imagePackServer, // Independent image App metadata; existing native renderer/actions stay in canvas.
  // import yourPack from '@team/canvas-pack-yourbiz/server';
  // yourPack,
];

function teamOf(kind: string): string {
  const match = /^card\.([a-z0-9-]+)\./.exec(kind);
  return match?.[1] ?? 'core';
}

for (const pack of CARD_PACKS) {
  const kinds = pack.cards.map(card => card.kind);
  const team = teamOf(kinds.find(kind => kind.startsWith('card.')) ?? '');
  const packId = pack.packId ?? team;
  const ops: string[] = [];
  for (const card of pack.cards) {
    for (const [verb, entry] of Object.entries(card.ops ?? {})) {
      const handler = typeof entry === 'function' ? entry : entry.handler;
      const targetKind = typeof entry === 'function' ? undefined : entry.targets;
      registerCardOp(`${card.kind}.${verb}`, handler, targetKind);
      ops.push(`${card.kind}.${verb}`);
    }
  }
  const editorApps = Object.fromEntries(pack.cards.filter(card => card.editorApp).map(card => [card.kind, card.editorApp!]));
  const agent = Object.fromEntries(pack.cards.filter(card => card.agent).map(card => [card.kind, { read: card.agent!.read, write: card.agent!.write ?? {} }]));
  registerCardPack({ packId, team, name: pack.name, kinds, ops, editorApps, agent });
}

/** Mirror mounted packs into the Appwrite `card_packs` collection so the
 * manage side can discover card capabilities without reaching this server.
 * Best-effort: sync failures must not block startup. */
export async function syncCardPackRegistry(store: CardRegistryStore): Promise<void> {
  for (const pack of listRegisteredPacks() satisfies MountedCardPack[]) {
    await store.upsertPack({ packId: pack.packId, team: pack.team, name: pack.name, kinds: pack.kinds, ops: pack.ops, editorApps: pack.editorApps, status: 'active' });
  }
}
