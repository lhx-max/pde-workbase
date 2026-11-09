type GenerationIdentity = { requestId: string; status: string };

/** A late failure may settle its own running request, never replace a newer/cancelled delivery. */
export function acceptsCanvasGenerationPatch(current: GenerationIdentity | undefined, next: GenerationIdentity | undefined): boolean {
  return next?.status !== 'failed' || (current?.requestId === next.requestId && current.status === 'running');
}
