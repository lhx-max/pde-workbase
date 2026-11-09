import type { ArtifactDescriptor, ResultRenderer } from '../api/workflows.js';
import { parseStoryboardGenerationResult } from '../api/storyboard-generation.js';

/** Adding a renderer requires an explicit canvas delivery decision at compile time. */
export const CANVAS_ARTIFACT_RENDERER_POLICY = {
  html: 'native', document: 'native', image: 'native', video: 'native',
  structured: 'native', audio: 'viewer', file: 'viewer', code: 'viewer',
} as const satisfies Record<ResultRenderer, 'native' | 'viewer'>;

/** Shared by server delivery and canvas imports; a known HTML output is never a file placeholder. */
export function canvasArtifactProjection(artifact: ArtifactDescriptor) {
  if (artifact.resource.kind !== 'project-file') return { kind: 'artifact' as const };
  const preview = artifact.preview && typeof artifact.preview === 'object' && !Array.isArray(artifact.preview) ? artifact.preview : {};
  if (preview.canvasKind === 'sketch') return { kind: 'sketch' as const, projectFilePath: artifact.resource.path };
  if (CANVAS_ARTIFACT_RENDERER_POLICY[artifact.renderer] === 'viewer') return { kind: 'artifact' as const };
  if (artifact.renderer === 'structured' && typeof preview.storyboard === 'string') {
    try {
      const storyboard = parseStoryboardGenerationResult(preview.storyboard, { aspectRatio: '16:9', visualStyle: '', referenceRoles: {} });
      storyboard.shots = storyboard.shots.map((shot, index) => ({ ...shot, id: `${artifact.id}:shot:${index}` }));
      return { kind: 'storyboard' as const, storyboard, storyboardEntryMode: 'edit' as const, projectFilePath: artifact.resource.path };
    } catch {
      // Corrupt historical metadata must not crash the entire canvas.
      return { kind: 'artifact' as const };
    }
  }
  if (artifact.renderer === 'html') return {
    kind: 'page' as const,
    artifactFormat: preview.artifactFormat === 'presentation' ? 'presentation' as const : 'html' as const,
    projectFilePath: artifact.resource.path,
  };
  if (artifact.renderer === 'video') return {
    kind: 'video' as const,
    projectFilePath: artifact.resource.path,
    videoTask: { id: artifact.id, status: 'done' as const, path: artifact.resource.path },
  };
  if (artifact.renderer === 'document' && typeof preview.markdown === 'string') return {
    kind: 'text' as const, text: preview.markdown, projectFilePath: artifact.resource.path,
  };
  return { kind: 'artifact' as const };
}
