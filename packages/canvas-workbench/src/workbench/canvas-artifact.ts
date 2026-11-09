import { cr } from '../locales/canvas-remainder';
import type {
  ArtifactDescriptor,
  ProjectFileDragPayload,
  ResultRenderer,
} from '@bezier/contracts';

/** One-shot host request for placing an already-generated output on the canvas. */
export type CanvasArtifactLaunchRequest = {
  nonce: string;
  artifact: ArtifactDescriptor;
  position?: { x: number; y: number };
};

/**
 * A canvas artifact is a reference to the editable project output, not a
 * second copy of that output. Keep this mapping small and deterministic so
 * generated HTML/decks and files dragged from the project resolve to the same
 * card shape.
 */
export function isCanvasArtifactFile(file: ProjectFileDragPayload): boolean {
  if (file.kind === 'document' && (/^text\//i.test(file.mime) || /\.(md|markdown|txt)$/i.test(file.name))) return false;
  return ['html', 'presentation', 'audio', 'pdf', 'document', 'spreadsheet', 'binary'].includes(file.kind);
}

export function projectFileArtifactDescriptor(
  projectId: string,
  file: ProjectFileDragPayload,
): ArtifactDescriptor {
  const title = file.name.split('/').pop() || file.name;
  const renderer = artifactRenderer(file);
  const editable = renderer === 'html';
  return {
    id: `project-file:${file.name}`,
    projectId,
    title,
    summary: `${artifactKindLabel(file)} · ${formatFileSize(file.size)}`,
    renderer,
    preview: { artifactFormat: file.artifactKind === 'deck' || file.kind === 'presentation' || file.sourceAsset?.kind === 'slides' ? 'presentation' : 'html' },
    resource: {
      kind: 'project-file',
      path: file.name,
      mimeType: file.mime,
    },
    capabilities: editable ? ['edit', 'export', 'download'] : ['download'],
    status: 'ready',
    updatedAt: new Date(Number.isFinite(file.mtime) && file.mtime > 0 ? file.mtime : 0).toISOString(),
  };
}

function artifactRenderer(file: ProjectFileDragPayload): ResultRenderer {
  if (file.kind === 'audio') return 'audio';
  if (file.kind === 'html') return 'html';
  // Some deck generators emit an HTML source but classify it as a presentation.
  // That source remains editable; a binary .pptx is correctly represented as a
  // file that opens in the project viewer instead.
  if (file.kind === 'presentation' && (file.mime.includes('html') || /\.html?$/i.test(file.name))) {
    return 'html';
  }
  return 'file';
}

function artifactKindLabel(file: ProjectFileDragPayload): string {
  if (artifactRenderer(file) === 'html') {
    return file.kind === 'presentation' || file.artifactKind === 'deck' || file.sourceAsset?.kind === 'slides' ? cr().demoPage : cr().webArtifact;
  }
  return file.kind === 'presentation' ? cr().presentation : cr().projectArtifact;
}

function formatFileSize(size: number): string {
  if (!Number.isFinite(size) || size <= 0) return cr().projectFile;
  if (size < 1024) return `${Math.round(size)} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}
