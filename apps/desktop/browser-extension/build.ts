/** Bundle the original capture UI into the independent desktop distribution.
 * Run under Node 24; no browser installation, profile read or registration. */
import { build } from 'esbuild';
import { copyFile, cp, mkdir, mkdtemp, readdir, rename, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
const here = dirname(fileURLToPath(import.meta.url));
const dist = resolve(here, '../dist');
await mkdir(dist, { recursive: true });
const staging = await mkdtemp(join(dist, '.extension-build-'));
const out = join(staging, 'extension');
try {
  await mkdir(out);
  for (const entry of await readdir(here, { withFileTypes: true })) {
    if (entry.isFile() && /\.(json|html|css|png|svg)$/.test(entry.name) && entry.name !== 'tsconfig.json') await copyFile(join(here, entry.name), join(out, entry.name));
  }
  await cp(join(here, '_locales'), join(out, '_locales'), { recursive: true });
  for (const name of ['app-icon.png', 'logo.svg']) await copyFile(join(here, '../../web/public', name), join(out, name));
  await build({ entryPoints: ['background.ts', 'popup.ts', 'content.ts'].map(name => join(here, name)), outdir: out,
    bundle: true, format: 'esm', splitting: false, platform: 'browser', target: ['chrome120'], logLevel: 'info' });
  const zip = join(staging, 'browser-extension.zip');
  await promisify(execFile)('zip', ['-r', '-X', '-q', zip, '.'], { cwd: out });
  await rename(zip, join(dist, 'browser-extension.zip'));
  const pinterestSource = resolve(here, '../experiments/pinterest-auth');
  const pinterest = join(dist, 'pinterest-auth-extension');
  await mkdir(pinterest, { recursive: true });
  for (const name of ['manifest.json', 'connect.html', 'connect.css']) await copyFile(join(pinterestSource, name), join(pinterest, name));
  await build({ entryPoints: ['background.ts', 'connect.ts'].map(name => join(pinterestSource, name)), outdir: pinterest,
    bundle: true, format: 'esm', splitting: false, platform: 'browser', target: ['chrome120'], logLevel: 'info' });
} finally {
  if (dirname(staging) !== dist || !staging.startsWith(join(dist, '.extension-build-'))) throw new Error('Invalid extension staging directory');
  await rm(staging, { recursive: true, force: true });
}
