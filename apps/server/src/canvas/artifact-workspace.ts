import { createHash, randomUUID } from 'node:crypto';
import { canvasStateRelativePath } from '../project-layout.js';
import { closeSync, constants, existsSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { load } from 'cheerio';
import { extractPlainStreamArtifactSpans } from '../runtimes/plain-stream.js';

const digest = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
function projectFile(root: string, relative: string): string {
  if (!relative || path.isAbsolute(relative) || relative.includes('\\') || relative.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('候选文件路径无效');
  let current = root;
  for (const part of relative.split('/')) {
    current = path.join(current, part);
    try {
      if (lstatSync(current).isSymbolicLink()) throw new Error('候选输入不允许符号链接');
    } catch (error) {
      // existsSync hides dangling links; lstat must inspect the link itself.
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return current;
}

export interface CanvasArtifactWorkspace {
  cwd: string;
  projectRoot: string;
  outputPath: string;
  inputs: Array<{ path: string; digest: string }>;
  target?: { nodeId: string; requestId: string; digest: string };
}

export function loadCanvasArtifactWorkspace(runtimeDataDir: string, projectRoot: string, runId: string): CanvasArtifactWorkspace {
  const directory = path.join(runtimeDataDir, 'canvas-candidates', digest(runId));
  const value = JSON.parse(readFileSync(path.join(directory, 'manifest.json'), 'utf8')) as CanvasArtifactWorkspace;
  if (value.projectRoot !== realpathSync(projectRoot) || value.cwd !== path.join(directory, 'workspace')
    || !Array.isArray(value.inputs) || typeof value.outputPath !== 'string') throw new Error('候选归属校验失败');
  projectFile(value.projectRoot, value.outputPath);
  if (value.target && (typeof value.target.nodeId !== 'string' || !value.target.nodeId
    || typeof value.target.requestId !== 'string' || !value.target.requestId
    || !/^[a-f0-9]{64}$/u.test(value.target.digest))) throw new Error('候选目标快照无效');
  for (const input of value.inputs) {
    if (typeof input.path !== 'string' || !/^[a-f0-9]{64}$/u.test(input.digest)) throw new Error('候选输入快照无效');
    projectFile(value.projectRoot, input.path);
  }
  return value;
}

type SourceRange = { start: number; end: number };

/** htmlparser2 preserves separate document roots instead of merging them as a
 * browser would. Script text, comments, quoted attributes and template children
 * are not additional document roots. Source ranges retain the original bytes.
 */
function htmlDocumentRanges(source: string): SourceRange[] {
  const document = load(source, { xml: { xmlMode: false, withStartIndices: true, withEndIndices: true } }, false);
  return document.root().children('html').toArray().flatMap(node =>
    node.startIndex == null || node.endIndex == null ? [] : [{ start: node.startIndex, end: node.endIndex + 1 }]);
}

function omitSourceRanges(source: string, ranges: SourceRange[]): string {
  const remaining: string[] = [];
  let offset = 0;
  for (const range of ranges) {
    remaining.push(source.slice(offset, range.start));
    offset = range.end;
  }
  remaining.push(source.slice(offset));
  return remaining.join('\n');
}

/** Count independent artifact, fenced and raw outputs together, never by format
 * priority. Wrappers are removed by source position, not content replacement;
 * an HTML fence inside an already-open document is HTML content, not an output.
 */
function canvasResponseHtmlCandidates(response: string): string[] {
  const rawDocumentRanges = htmlDocumentRanges(response);
  const artifacts = extractPlainStreamArtifactSpans(response)
    .filter(span => !rawDocumentRanges.some(range => range.start < span.start && span.start < range.end));
  const candidates = artifacts.filter(span => span.artifact.artifactType === 'text/html').map(span => span.artifact.content);
  const outsideArtifacts = omitSourceRanges(response, artifacts);
  const documentRanges = htmlDocumentRanges(outsideArtifacts);
  const fences = [...outsideArtifacts.matchAll(/^```([\w+-]*)[^\S\r\n]*\r?\n([\s\S]*?)\r?\n```[^\S\r\n]*(?=\r?\n|$)/gimu)]
    .filter(match => !documentRanges.some(range => range.start < match.index && match.index < range.end));
  candidates.push(...fences.filter(match => match[1]!.toLowerCase() === 'html').map(match => match[2]!));
  const raw = omitSourceRanges(outsideArtifacts, fences.map(match => ({ start: match.index, end: match.index + match[0].length })));
  const rawDocuments = htmlDocumentRanges(raw);
  if (rawDocuments.length && (candidates.length || /^\s*(?:<!doctype\s+html\b|<html\b)/iu.test(raw))) {
    // Preserve a sole raw response (including its doctype) verbatim. Multiple
    // roots still become multiple candidates and are rejected before writing.
    candidates.push(...rawDocuments.map(() => raw));
  }
  return candidates;
}

/** Output-only runtimes need not have file tools. Materialize their one complete
 * HTML response into the declared work-copy path, never directly into a project.
 * A file already written by the runtime remains authoritative and is validated
 * by publication; stdout must not replace it or invent a different output name.
 */
export function materializeCanvasArtifactResponse(workspace: CanvasArtifactWorkspace, response: string | null): void {
  const target = projectFile(workspace.cwd, workspace.outputPath);
  if (existsSync(target)) return;
  if (response === null || Buffer.byteLength(response, 'utf8') > 20 * 1024 * 1024) throw new Error('HTML 回复超过 20 MB，未进行部分交付');
  const candidates = canvasResponseHtmlCandidates(response);
  if (candidates.length !== 1) throw new Error(candidates.length > 1
    ? '回复包含多个 HTML 候选，无法确定目标，未进行自动交付'
    : '未找到声明的 HTML 候选文件或完整 HTML 回复，未进行交付');
  const html = candidates[0]!;
  const documents = htmlDocumentRanges(html);
  if (documents.length !== 1 || !/<\/html\s*>$/iu.test(html.slice(documents[0]!.start, documents[0]!.end))) {
    throw new Error('候选必须是 20 MB 以内的完整 HTML');
  }
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, html, { flag: 'wx' });
}

export function canvasArtifactTargetDigest(node: Record<string, unknown>): string {
  return digest(JSON.stringify([node.kind, node.text ?? '', node.projectFilePath ?? '', node.artifactFormat ?? '', node.presentationOptions ?? null, node.webpageOptions ?? null]));
}

export type CanvasWorkingCopy = Pick<CanvasArtifactWorkspace, 'cwd' | 'projectRoot' | 'inputs'>;
type WorkingCopyInput = { runtimeDataDir: string; projectRoot: string; runId: string; references: string[] };

/** Copy bytes, never links. The host containment layer enforces write isolation. */
function prepareWorkingCopy(input: WorkingCopyInput): CanvasWorkingCopy {
  const projectRoot = realpathSync(input.projectRoot);
  const directory = path.join(input.runtimeDataDir, 'canvas-candidates', digest(input.runId));
  const cwd = path.join(directory, 'workspace');
  // A reused attempt must be reconciled, never silently reset and rerun.
  if (existsSync(directory)) throw new Error('候选工作目录已存在，请恢复已有任务');
  let bytes = 0;
  const files = [...new Set(input.references)].map(relative => {
    const source = projectFile(projectRoot, relative);
    const stat = lstatSync(source);
    if (!stat.isFile()) throw new Error('候选参考必须是文件');
    bytes += stat.size;
    if (bytes > 20 * 1024 * 1024) throw new Error('候选参考超过 20 MB，未进行部分输入');
    const content = readFileSync(source);
    return { path: relative, content, digest: digest(content) };
  });
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  mkdirSync(cwd, { mode: 0o700 });
  for (const file of files) {
    const target = projectFile(cwd, file.path);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, file.content, { flag: 'wx' });
  }
  return { cwd, projectRoot, inputs: files.map(({ path, digest }) => ({ path, digest })) };
}

/** Text/structured-result executors work on copies; only DA saves their output. */
export function prepareCanvasTextWorkspace(input: WorkingCopyInput): CanvasWorkingCopy {
  const result = prepareWorkingCopy(input);
  writeFileSync(path.join(path.dirname(result.cwd), 'manifest.json'), JSON.stringify({ ...result, kind: 'text' }), { flag: 'wx', mode: 0o600 });
  return result;
}

/** A versioned HTML working copy shared by PPT and single-file webpage tasks. */
export function prepareCanvasArtifactWorkspace(input: WorkingCopyInput & {
  outputPath: string; target?: CanvasArtifactWorkspace['target'];
}): CanvasArtifactWorkspace {
  const output = projectFile(realpathSync(input.projectRoot), input.outputPath);
  if (!/\.html?$/iu.test(input.outputPath) || existsSync(output)) throw new Error('必须生成新的 HTML 候选，不能覆盖已有文件');
  if (input.references.includes(input.outputPath)) throw new Error('参考文件不能同时作为输出');
  const result = { ...prepareWorkingCopy(input), outputPath: input.outputPath, ...(input.target ? { target: input.target } : {}) };
  // Manifest is outside the only writable working root given to the executor.
  writeFileSync(path.join(path.dirname(result.cwd), 'manifest.json'), JSON.stringify(result), { flag: 'wx', mode: 0o600 });
  return result;
}

/** Validate candidate and original versions before publishing a new file; never overwrite. */
export function publishCanvasArtifactCandidate(workspace: CanvasArtifactWorkspace): string {
  const outputPath = saveCanvasArtifactCandidate(workspace);
  if (workspace.target) {
    const state = JSON.parse(readFileSync(projectFile(workspace.projectRoot, canvasStateRelativePath(workspace.projectRoot)), 'utf8'));
    const node = state.state?.workbenchBasicNodes?.find((value: Record<string, unknown>) => value.id === workspace.target!.nodeId);
    if (!node || node.generation?.requestId !== workspace.target.requestId || canvasArtifactTargetDigest(node) !== workspace.target.digest) throw new Error(`目标卡片已修改或删除，未覆盖画布；候选已另存：${outputPath}`);
  }
  for (const input of workspace.inputs) {
    const source = projectFile(workspace.projectRoot, input.path);
    if (!existsSync(source) || digest(readFileSync(source)) !== input.digest) throw new Error(`原稿或参考已修改，未覆盖原稿；候选已另存：${outputPath}`);
  }
  return outputPath;
}

/** Saving a separate immutable result does not authorize adopting it on a card. */
export function saveCanvasArtifactCandidate(workspace: CanvasArtifactWorkspace): string {
  const candidate = projectFile(workspace.cwd, workspace.outputPath);
  if (!existsSync(candidate)) throw new Error('AI 本轮未生成声明的 HTML 候选，无法交付。请查看执行详情中的原始回复后重试。');
  if (!lstatSync(candidate).isFile() || lstatSync(candidate).size > 20 * 1024 * 1024) throw new Error('候选文件无效或超过 20 MB');
  const content = readFileSync(candidate, 'utf8');
  if (!/<html[\s>]/iu.test(content) || !/<\/html\s*>/iu.test(content) || !/<(?:section|main|body)[\s>]/iu.test(content)) throw new Error('候选不是完整 HTML，未交付');
  const target = projectFile(workspace.projectRoot, workspace.outputPath);
  if (existsSync(target)) {
    if (lstatSync(target).isFile() && readFileSync(target, 'utf8') === content) return workspace.outputPath;
    throw new Error('目标候选路径已存在，拒绝覆盖');
  }
  mkdirSync(path.dirname(target), { recursive: true });
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${randomUUID()}.tmp`);
  const fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {
    try { writeFileSync(fd, content); fsyncSync(fd); } finally { closeSync(fd); }
    // Publish the bytes actually validated, atomically and without replacing a raced file.
    try { linkSync(temporary, target); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || lstatSync(target).isSymbolicLink() || readFileSync(target, 'utf8') !== content) throw error;
    }
  } finally { unlinkSync(temporary); }
  if (readFileSync(target, 'utf8') !== content) throw new Error('候选保存校验失败');
  return workspace.outputPath;
}
