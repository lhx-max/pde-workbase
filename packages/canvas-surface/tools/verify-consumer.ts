import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'vite';
import ts from 'typescript';
import { isPeer, manifest, packageRoot, requireNode24, tarballName, workspaceRoot } from './shared';

requireNode24();
const artifact = resolve(packageRoot, 'artifacts', tarballName);
assert(existsSync(artifact), 'Run pack:surface first');
const temporaryRoot = resolve(workspaceRoot, '.tmp/canvas-surface-consumers');
mkdirSync(temporaryRoot, { recursive: true });
const consumer = mkdtempSync(resolve(temporaryRoot, 'consumer-'));
const packageArchive = resolve(consumer, tarballName);
cpSync(artifact, packageArchive);
writeFileSync(resolve(consumer, 'package.json'), JSON.stringify({
  name: 'canvas-surface-isolated-consumer', version: '0.0.0', private: true, type: 'module',
  dependencies: { [manifest.name]: `file:./${tarballName}`, ...manifest.peerDependencies },
  devDependencies: { '@types/react': '18.3.28', '@types/react-dom': '18.3.7' },
}, null, 2));
execFileSync('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: consumer, stdio: 'inherit', env: { ...process.env, npm_config_engine_strict: 'true', npm_config_cache: resolve(workspaceRoot, '.tmp/canvas-surface-npm-cache') } });
const installed = resolve(consumer, 'node_modules', manifest.name);
assert(!lstatSync(installed).isSymbolicLink(), 'Tarball must install as real files');
const pkg = JSON.parse(readFileSync(resolve(installed, 'package.json'), 'utf8'));
assert.deepEqual(pkg.dependencies ?? {}, {}, 'Internal dependencies must not escape into the manifest');
assert(!JSON.stringify(pkg).includes('workspace:'), 'Published metadata cannot contain workspace protocol');
function visit(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = resolve(directory, name);
    assert(!lstatSync(path).isSymbolicLink(), `No symlink allowed: ${path}`);
    return statSync(path).isDirectory() ? visit(path) : [path];
  });
}
const files = visit(installed);
const jsFiles = files.filter((path) => path.endsWith('.js'));
const css = readFileSync(resolve(installed, 'dist/styles.css'), 'utf8');
assert(css.includes('.canvas-workbench'), 'Canvas scoped CSS missing');
assert(css.includes('.react-flow'), 'React Flow baseline CSS missing');
assert(css.includes('.cs_CanvasTextToolbar'), 'CSS Modules stylesheet mapping missing');
assert(jsFiles.some((path) => readFileSync(path, 'utf8').includes('cs_CanvasTextToolbar')), 'CSS Modules JavaScript mapping missing');
for (const path of jsFiles) {
  const text = readFileSync(path, 'utf8');
  assert(!/from\s*["']@bezier\//.test(text), 'Workspace import escaped bundle');
  assert(!text.includes(workspaceRoot), 'Absolute source path leaked into JS');
}
writeFileSync(resolve(consumer, 'consumer.tsx'), `import React from 'react';
import Surface, { CanvasWorkbenchSurface, flushCanvasForProject, type CanvasWorkbenchSurfaceProps, type CanvasTransport, type CanvasUiHost, type TextDocumentOpenResult } from '${manifest.name}';
import '${manifest.name}/styles.css';
const transport: CanvasTransport = { baseUrl: 'http://127.0.0.1:17460', fetch: (url, init) => fetch(url, init) };
const uiHost: CanvasUiHost = {
  renderPopover: ({ trigger }) => trigger, renderHoverCard: ({ trigger }) => trigger,
  renderDialog: () => null, renderMenu: ({ trigger }) => trigger, renderTabs: () => null,
};
const props: CanvasWorkbenchSurfaceProps = { projectId: 'consumer-check', transport, uiHost };
export const element = <Surface {...props} />;
export const named = CanvasWorkbenchSurface;
export const flush: (projectId: string) => Promise<void> = flushCanvasForProject;
export type OpenResult = TextDocumentOpenResult;
`);
const options: ts.CompilerOptions = {
  strict: true, skipLibCheck: false, target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
  jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, noEmit: true,
  types: ['react', 'react-dom'], typeRoots: [resolve(consumer, 'node_modules/@types')],
};
const program = ts.createProgram([resolve(consumer, 'consumer.tsx')], options);
const errors = ts.getPreEmitDiagnostics(program).filter((d) => d.category === ts.DiagnosticCategory.Error);
assert.equal(errors.length, 0, ts.formatDiagnosticsWithColorAndContext(errors, {
  getCanonicalFileName: (file) => file, getCurrentDirectory: () => consumer, getNewLine: () => '\n',
}));
for (const file of program.getSourceFiles()) {
  assert(file.fileName.startsWith(consumer + '/') || /node_modules\/typescript\/lib\/lib\..*\.d\.ts$/.test(file.fileName), `Types escaped isolated consumer: ${file.fileName}`);
}
const bundledReact = new Set<string>();
await build({
  configFile: false, root: consumer,
  build: { outDir: resolve(consumer, 'dist'), emptyOutDir: false, lib: { entry: resolve(consumer, 'consumer.tsx'), formats: ['es'], fileName: 'consumer' } },
  plugins: [{
    name: 'isolated-consumer-audit',
    generateBundle(_options, output) {
      for (const item of Object.values(output)) {
        if (item.type !== 'chunk') continue;
        for (const id of Object.keys(item.modules)) {
          if (id.startsWith('\0')) continue;
          assert(id.startsWith(consumer + '/'), `Consumer bundle escaped installed files: ${id}`);
          if (/\/node_modules\/react\/index\.js$/.test(id)) bundledReact.add(id);
        }
      }
    },
  }],
});
assert.equal(bundledReact.size, 1, 'Exactly one React runtime must be bundled by the host');
const require = createRequire(resolve(consumer, 'package.json'));
const reactRoot = dirname(require.resolve('react/package.json'));
assert.equal(require.resolve('react', { paths: [installed] }), require.resolve('react'));
assert.equal(require.resolve('react', { paths: [dirname(require.resolve('@xyflow/react'))] }), require.resolve('react'));
// Execute the shipped public API from the installed tarball without starting a service.
// SSR is a smoke check only; browser/native capability parity is intentionally not claimed.
const smoke = `import assert from 'node:assert/strict';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { CanvasWorkbenchSurface, flushCanvasForProject } from '${manifest.name}';
assert.equal(typeof CanvasWorkbenchSurface, 'function');
await assert.rejects(flushCanvasForProject('unmounted'), /unavailable/);
const uiHost = { renderPopover: ({trigger}) => trigger, renderHoverCard: ({trigger}) => trigger, renderDialog: () => null, renderMenu: ({trigger}) => trigger, renderTabs: () => null };
const markup = renderToString(React.createElement(CanvasWorkbenchSurface, { projectId: 'isolated-consumer', uiHost }));
assert(markup.includes('canvas-workbench-surface'));
// CanvasCompatProvider intentionally withholds children until client hydration.
assert(!markup.includes('react-flow'));
console.log(JSON.stringify({ react: React.version, markupBytes: Buffer.byteLength(markup), unmountedFlush: 'rejected' }));
`;
execFileSync(process.execPath, ['--input-type=module', '--eval', smoke], { cwd: consumer, stdio: 'inherit' });
const report = {
  tarball: relative(workspaceRoot, artifact), tarballBytes: statSync(artifact).size,
  sha256: createHash('sha256').update(readFileSync(artifact)).digest('hex'),
  unpackedBytes: files.reduce((sum, path) => sum + statSync(path).size, 0),
  javascriptBytes: jsFiles.reduce((sum, path) => sum + statSync(path).size, 0),
  cssBytes: Buffer.byteLength(css), installedFiles: files.length,
  consumer: relative(workspaceRoot, consumer), reactRoot: relative(consumer, reactRoot),
  checks: ['npm install tarball', 'no symlinks', 'no workspace runtime dependencies', 'strict standalone declarations (skipLibCheck=false)', 'consumer Vite bundle', 'single React resolution', 'installed API SSR smoke', 'unmounted flush rejects'],
};
writeFileSync(resolve(packageRoot, 'artifacts/verification.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
