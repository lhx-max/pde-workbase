import { PROJECT_LAYOUT } from '@bezier/contracts';
import { createHash, randomUUID } from 'node:crypto';
import { constants, closeSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { assertProjectPathHasNoSymlinks } from '../project-layout.js';
import { parseStoryboardGenerationResult } from '@bezier/contracts';

export function isUsableStoryboardCandidate(content: string): boolean {
  try {
    parseStoryboardGenerationResult(content, { aspectRatio: '16:9', visualStyle: '', referenceRoles: {} });
    return true;
  } catch {
    return false;
  }
}

/** Immutable candidate storage. Never writes the source document or canvas node. */
export function saveCanvasTextCandidate(projectRoot: string, runId: string, content: string): string {
  if (!content.trim()) throw new Error('AI 未返回文本内容');
  const directory = path.join(projectRoot, PROJECT_LAYOUT.candidates);
  assertProjectPathHasNoSymlinks(projectRoot, PROJECT_LAYOUT.candidates);
  mkdirSync(directory, { recursive: true });
  if (!lstatSync(directory).isDirectory() || lstatSync(directory).isSymbolicLink()) {
    throw new Error('结果目录不可用');
  }
  const name = `${createHash('sha256').update(runId).digest('hex')}.md`;
  const target = path.join(directory, name);
  const temporary = path.join(directory, `.${name}.${randomUUID()}.tmp`);
  const fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {
    try {
      writeFileSync(fd, content, 'utf8');
      fsyncSync(fd);
    } finally { closeSync(fd); }
    // Publish only a fully written candidate. Unlike rename, link never replaces
    // an existing result; a failed write leaves no poisoned final filename.
    try { linkSync(temporary, target); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (!lstatSync(target).isFile() || lstatSync(target).isSymbolicLink()
        || readFileSync(target, 'utf8') !== content) throw new Error('已有结果不同，拒绝覆盖');
    }
  } finally {
    unlinkSync(temporary);
  }
  if (readFileSync(target, 'utf8') !== content) throw new Error('结果保存校验失败');
  return `${PROJECT_LAYOUT.candidates}/${name}`;
}
