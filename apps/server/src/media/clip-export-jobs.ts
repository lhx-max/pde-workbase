import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ClipEditorExportJobStatusResponse } from '@bezier/contracts';

export type SavedClipExportJob = ClipEditorExportJobStatusResponse & { projectId: string };
/** Receipts survive browser refresh and daemon restart. In-flight work cannot
 * survive process death: report interruption, never an indefinitely running job. */
export class ClipExportJobReceipts {
  constructor(private readonly runtimeDataDir: string) {}
  private file(id: string) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error('invalid export job id');
    return path.join(this.runtimeDataDir, 'media-export-jobs', `${id}.json`);
  }
  async save(job: SavedClipExportJob): Promise<void> {
    const file = this.file(job.jobId);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(`${file}.tmp`, JSON.stringify(job), { mode: 0o600 });
    await rename(`${file}.tmp`, file);
  }
  async read(id: string, projectId: string): Promise<SavedClipExportJob | null> {
    try {
      const job = JSON.parse(await readFile(this.file(id), 'utf8')) as SavedClipExportJob;
      if (job.projectId !== projectId || job.jobId !== id) return null;
      if (job.status === 'running' || job.status === 'queued') return { ...job, status: 'failed', error: '服务重启，导出已中断，请重新导出' };
      return job;
    } catch { return null; }
  }
}
