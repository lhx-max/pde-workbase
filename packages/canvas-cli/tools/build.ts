import { readFile, writeFile, mkdir, copyFile, chmod } from 'node:fs/promises';
import ts from 'typescript';

if (Number(process.versions.node.split('.')[0]) !== 24) throw new Error('Build with Node 24');
const root = new URL('../', import.meta.url);
await mkdir(new URL('dist/', root), { recursive: true });
for (const [source, output] of [
  [new URL('src/index.ts', root), new URL('dist/index.js', root)],
  [new URL('../../apps/server/src/http-cli.ts', root), new URL('dist/http-cli.js', root)],
] as const) {
  const text = (await readFile(source, 'utf8')).replace('../../../apps/server/src/http-cli.js', './http-cli.js').replaceAll('canvas-server ', 'canvas-cli ');
  const result = ts.transpileModule(text, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 }, fileName: source.pathname,
  });
  await writeFile(output, result.outputText);
}
await chmod(new URL('dist/index.js', root), 0o755);
for (const file of ['LICENSE', 'NOTICE']) await copyFile(new URL(`../../${file}`, root), new URL(file, root));
console.log('Built standalone canvas-cli; runtime dependencies: Node built-ins only');
