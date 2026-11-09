import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const workspaceRoot = resolve(packageRoot, '../..');
export const distRoot = resolve(packageRoot, 'dist');
export const peers = ['react', 'react-dom', '@xyflow/react'];
export const isPeer = (id: string): boolean => peers.some((name) => id === name || id.startsWith(`${name}/`));
export const manifest = JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf8')) as {
  name: string; version: string; peerDependencies: Record<string, string>;
};
export const tarballName = `${manifest.name.replace(/^@/, '').replaceAll('/', '-')}-${manifest.version}.tgz`;

/** Resolve workspace packages to their current sources, never stale dist or another checkout. */
export function workspaceAliases(): Record<string, string> {
  const aliases: Record<string, string> = {};
  for (const name of readdirSync(resolve(workspaceRoot, 'packages'))) {
    const root = resolve(workspaceRoot, 'packages', name);
    const path = resolve(root, 'package.json');
    if (!existsSync(path) || root === packageRoot) continue;
    const pkg = JSON.parse(readFileSync(path, 'utf8')) as {
      name: string; exports?: Record<string, string | { default?: string; import?: string }>;
    };
    for (const [key, value] of Object.entries(pkg.exports ?? {})) {
      const target = typeof value === 'string' ? value : value.default ?? value.import;
      if (!target || !key.startsWith('.')) continue;
      let source = target.replace(/^\.\/dist\//, './src/').replace(/\.(mjs|js)$/, '.ts');
      if (!existsSync(resolve(root, source)) && existsSync(resolve(root, source.replace(/\.ts$/, '.tsx')))) {
        source = source.replace(/\.ts$/, '.tsx');
      }
      if (!existsSync(resolve(root, source))) continue;
      aliases[`${pkg.name}${key === '.' ? '' : key.slice(1)}`] = resolve(root, source);
    }
  }
  return aliases;
}

export function requireNode24(): void {
  if (Number(process.versions.node.split('.')[0]) !== 24) {
    throw new Error(`Build and verification require Node 24; received ${process.version}`);
  }
}
