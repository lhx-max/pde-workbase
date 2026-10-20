import { PROJECT_LAYOUT } from '@bezier/contracts';
import type { ApiErrorResponse, UploadProjectFilesResponse } from '@bezier/contracts';
import type { TaskAttachment } from '../workbench/model/canvas-domain';
import { apiErrorMessage, getCanvasHostContext, projectFetch, type CanvasHostContext } from './api-base';
import { cr } from '../locales/canvas-remainder';
import { validateImageFile } from './validate-image-file';

/**
 * Canvas files are project resources, never an optional business capability.
 * Capture the owning context before any await; return only a confirmed file.
 */
export async function uploadCanvasAttachment(
  file: File,
  context: CanvasHostContext = getCanvasHostContext(),
): Promise<TaskAttachment> {
  if (file.type.startsWith('image/')) await validateImageFile(file);
  const form = new FormData();
  // Multer resolves the destination while streaming, so dir must precede files.
  form.append('dir', PROJECT_LAYOUT.attachments);
  form.append('files', file, file.name);
  const response = await projectFetch('/upload', { method: 'POST', body: form }, context);
  const payload = await response.json().catch(() => null) as Partial<UploadProjectFilesResponse & ApiErrorResponse> | null;
  if (!response.ok || payload?.error) {
    throw new Error(apiErrorMessage(payload?.error, cr().saveFileHttp(file.name, response.status)));
  }
  const uploaded = payload?.files?.[0];
  if (typeof uploaded?.path !== 'string' || !uploaded.path.trim()) {
    throw new Error(cr().saveFileNoPath(file.name));
  }
  return {
    name: file.name,
    path: uploaded.path,
    size: typeof uploaded.size === 'number' ? uploaded.size : file.size,
    mimeType: file.type || 'application/octet-stream',
  };
}
