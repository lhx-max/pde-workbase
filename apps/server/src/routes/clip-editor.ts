import type { Express } from 'express';
import { randomUUID } from 'node:crypto';
import type { ClipEditorExportJobStatusResponse, ClipEditorExportOptions, ClipEditorExportRequest, ClipEditorExportResponse, ProjectFile } from '@bezier/contracts';
import { clipCompositionDuration } from '@bezier/contracts';
import type { Request, Response } from 'express';
import type { ProjectRegistry } from '../storage/project-registry.js';
import { resolveProjectFilePath, writeProjectFile } from '../projects.js';
import { renderClipEditorTimeline, validateClipEditorTimeline } from '../media/clip-export.js';
import { ClipExportJobReceipts } from '../media/clip-export-jobs.js';

export interface RegisterClipEditorRoutesDeps {
  registry: ProjectRegistry;
  paths: { RUNTIME_DATA_DIR: string; PROJECTS_DIR: string };
  http: { sendApiError: (res: Response, status: number, code: string, message: string) => void };
  authorizeProjectRequest: (req: Request, res: Response, projectId: string, options: { mode: 'read' | 'write'; capability?: 'writeFiles' }) => Promise<boolean>;
}

function exportOptions(value: ClipEditorExportRequest['options']): ClipEditorExportOptions {
  const options = value || { format: 'mp4', quality: 'standard', fps: 30 };
  if (!['mp4', 'png', 'webp'].includes(options.format)) throw new Error('invalid export format');
  if (!['draft', 'standard', 'high'].includes(options.quality)) throw new Error('invalid export quality');
  if (![24, 30, 60].includes(options.fps)) throw new Error('invalid export fps');
  if (options.stillTime !== undefined && (!Number.isFinite(options.stillTime) || options.stillTime < 0 || options.stillTime > 3600)) throw new Error('invalid still time');
  return options;
}

function outputName(title: string | undefined, format: ClipEditorExportOptions['format']): string {
  const stem = String(title || '剪辑轴').trim().replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').slice(0, 48) || '剪辑轴';
  return `剪辑导出/${Date.now()}-${stem}.${format}`;
}

type ExportJob = ClipEditorExportJobStatusResponse & { projectId: string; abort: AbortController; updatedAt: number };

function publicJob(job: ExportJob): ClipEditorExportJobStatusResponse {
  const { abort: _abort, projectId: _projectId, updatedAt: _updatedAt, ...result } = job;
  return result;
}

export function registerClipEditorRoutes(app: Express, ctx: RegisterClipEditorRoutesDeps): void {
  const exportJobs = new Map<string, ExportJob>();
  const receipts = new ClipExportJobReceipts(ctx.paths.RUNTIME_DATA_DIR);
  app.post('/api/projects/:id/media/edit/export', async (req, res) => {
    const projectId = String(req.params.id || '');
    if (!await ctx.authorizeProjectRequest(req, res, projectId, { mode: 'write', capability: 'writeFiles' })) return;
    const project = ctx.registry.get(projectId);
    if (!project) return ctx.http.sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'project not found');
    try {
      const request = (req.body || {}) as Partial<ClipEditorExportRequest>;
      const timeline = validateClipEditorTimeline(request.timeline);
      const options = exportOptions(request.options);
      const sources = new Map<string, string>();
      for (const clip of timeline.clips) {
        if (sources.has(clip.path)) continue;
        const resolved = await resolveProjectFilePath(ctx.paths.PROJECTS_DIR, projectId, clip.path, project.metadata);
        sources.set(clip.path, resolved.filePath);
      }
      const bytes = await renderClipEditorTimeline({ runtimeDir: ctx.paths.RUNTIME_DATA_DIR, timeline, sources, options });
      const file = await writeProjectFile(ctx.paths.PROJECTS_DIR, projectId, outputName(request.title, options.format), bytes, {}, project.metadata);
      const exportedFile: ProjectFile = {
        name: file.name,
        path: file.path,
        size: file.size,
        mtime: file.mtime,
        kind: options.format === 'mp4' ? 'video' : 'image',
        mime: options.format === 'mp4' ? 'video/mp4' : `image/${options.format}`,
      };
      const body: ClipEditorExportResponse = {
        ok: true,
        file: exportedFile,
        duration: clipCompositionDuration(timeline),
      };
      res.json(body);
    } catch (error) {
      ctx.http.sendApiError(res, 400, 'CLIP_EXPORT_FAILED', error instanceof Error ? error.message : String(error));
    }
  });

  app.post('/api/projects/:id/media/edit/export-jobs', async (req, res) => {
    const projectId = String(req.params.id || '');
    if (!await ctx.authorizeProjectRequest(req, res, projectId, { mode: 'write', capability: 'writeFiles' })) return;
    const project = ctx.registry.get(projectId);
    if (!project) return ctx.http.sendApiError(res, 404, 'PROJECT_NOT_FOUND', 'project not found');
    try {
      const request = (req.body || {}) as Partial<ClipEditorExportRequest>;
      const timeline = validateClipEditorTimeline(request.timeline);
      const options = exportOptions(request.options);
      const sources = new Map<string, string>();
      for (const clip of timeline.clips) {
        if (sources.has(clip.path)) continue;
        const resolved = await resolveProjectFilePath(ctx.paths.PROJECTS_DIR, projectId, clip.path, project.metadata);
        sources.set(clip.path, resolved.filePath);
      }
      const jobId = randomUUID();
      const abort = new AbortController();
      const job: ExportJob = { ok: true, jobId, projectId, status: 'queued', progress: 0, abort, updatedAt: Date.now() };
      await receipts.save({ ...publicJob(job), projectId });
      exportJobs.set(jobId, job);
      res.status(202).json({ ok: true, jobId });
      void (async () => {
        try {
          job.status = 'running'; job.updatedAt = Date.now();
          const bytes = await renderClipEditorTimeline({ runtimeDir: ctx.paths.RUNTIME_DATA_DIR, timeline, sources, options, signal: abort.signal, onProgress: progress => {
            if (abort.signal.aborted || job.status !== 'running') return;
            job.progress = progress;
            job.updatedAt = Date.now();
          } });
          if (abort.signal.aborted) return;
          const file = await writeProjectFile(ctx.paths.PROJECTS_DIR, projectId, outputName(request.title, options.format), bytes, {}, project.metadata);
          job.file = { name: file.name, path: file.path, size: file.size, mtime: file.mtime, kind: options.format === 'mp4' ? 'video' : 'image', mime: options.format === 'mp4' ? 'video/mp4' : `image/${options.format}` };
          job.duration = clipCompositionDuration(timeline); job.progress = 1; job.status = 'complete'; job.updatedAt = Date.now();
        } catch (error) {
          job.status = abort.signal.aborted ? 'cancelled' : 'failed';
          if (abort.signal.aborted) delete job.error;
          else job.error = error instanceof Error ? error.message : String(error);
          job.updatedAt = Date.now();
        } finally {
          await receipts.save({ ...publicJob(job), projectId }).catch(error => {
            job.status = 'failed';
            job.error = `无法保存导出记录：${String(error)}`;
          });
          const cleanup = setTimeout(() => {
            if (exportJobs.get(jobId) === job) exportJobs.delete(jobId);
          }, 15 * 60 * 1000);
          cleanup.unref();
        }
      })();
    } catch (error) {
      ctx.http.sendApiError(res, 400, 'CLIP_EXPORT_FAILED', error instanceof Error ? error.message : String(error));
    }
  });

  app.get('/api/projects/:id/media/edit/export-jobs/:jobId', async (req, res) => {
    const projectId = String(req.params.id || '');
    if (!await ctx.authorizeProjectRequest(req, res, projectId, { mode: 'read' })) return;
    const job = exportJobs.get(String(req.params.jobId || ''));
    if (!job) {
      const saved = await receipts.read(String(req.params.jobId || ''), projectId);
      if (saved) { const { projectId: _project, ...result } = saved; return res.json(result); }
    }
    if (!job || job.projectId !== projectId) return ctx.http.sendApiError(res, 404, 'CLIP_EXPORT_JOB_NOT_FOUND', 'export job not found');
    res.json(publicJob(job));
  });

  app.delete('/api/projects/:id/media/edit/export-jobs/:jobId', async (req, res) => {
    const projectId = String(req.params.id || '');
    if (!await ctx.authorizeProjectRequest(req, res, projectId, { mode: 'write', capability: 'writeFiles' })) return;
    const job = exportJobs.get(String(req.params.jobId || ''));
    if (!job || job.projectId !== projectId) return ctx.http.sendApiError(res, 404, 'CLIP_EXPORT_JOB_NOT_FOUND', 'export job not found');
    if (job.status === 'queued' || job.status === 'running') {
      job.abort.abort(); job.status = 'cancelled'; job.updatedAt = Date.now();
    }
    res.json(publicJob(job));
  });
}
