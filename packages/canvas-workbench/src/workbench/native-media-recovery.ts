import { isGeneratedImagePath } from '@bezier/contracts';
import type { ProjectFile } from '@bezier/contracts';

/**
 * Resolve the durable output behind an expired native media task.
 * New tasks carry an exact path. The single-candidate branch only exists for
 * canvas state written before that path became part of the handoff contract.
 */
export function recoverNativeImageOutput(
  files: ProjectFile[],
  expectedPath: string | undefined,
  sourceInstanceId: string,
): ProjectFile | undefined {
  const images = files.filter(file => file.kind === 'image');
  if (expectedPath) {
    return images.find(file => (file.path || file.name) === expectedPath);
  }
  const legacyCandidates = images.filter(file => (
    isGeneratedImagePath(file.path || file.name, sourceInstanceId)
  ));
  return legacyCandidates.length === 1 ? legacyCandidates[0] : undefined;
}
