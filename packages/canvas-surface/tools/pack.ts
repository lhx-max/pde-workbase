import { execFileSync } from 'node:child_process';
import { mkdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { packageRoot, requireNode24, tarballName } from './shared';

requireNode24();
const artifacts = resolve(packageRoot, 'artifacts');
mkdirSync(artifacts, { recursive: true });
execFileSync('pnpm', ['run', 'build'], { cwd: packageRoot, stdio: 'inherit' });
execFileSync('pnpm', ['pack', '--pack-destination', artifacts], { cwd: packageRoot, stdio: 'inherit' });
const tarball = resolve(artifacts, tarballName);
console.log(JSON.stringify({ tarball, bytes: statSync(tarball).size }, null, 2));
