import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { repositoryRoot, type ToolsDevRuntime } from './runtime.js';

/** Use the built distribution and a fresh test-only profile; never install into a user's browser. */
export async function stageCaptureExtension(runtime: ToolsDevRuntime) {
  const root = await mkdtemp(path.join(runtime.root, 'extension-browser-'));
  if (path.dirname(await realpath(root)) !== await realpath(runtime.root)) throw new Error('Extension fixture escaped its owned runtime');
  const extension = path.join(root, 'extension'), profile = path.join(root, 'profile');
  await mkdir(extension); await mkdir(profile);
  await promisify(execFile)('unzip', ['-q', path.join(repositoryRoot, 'apps/desktop/dist/browser-extension.zip'), '-d', extension]);
  const manifest = JSON.parse(await readFile(path.join(extension, 'manifest.json'), 'utf8')) as { key: string };
  const digest = createHash('sha256').update(Buffer.from(manifest.key, 'base64')).digest('hex').slice(0, 32);
  const id = [...digest].map(hex => String.fromCharCode(97 + parseInt(hex, 16))).join('');
  return { extension, profile, id };
}
