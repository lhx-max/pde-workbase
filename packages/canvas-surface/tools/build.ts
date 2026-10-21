import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { build, type Plugin } from 'vite';
import { buildDeclarations } from './declarations';
import { distRoot, isPeer, manifest, packageRoot, requireNode24, workspaceAliases, workspaceRoot } from './shared';

requireNode24();
const modules = new Set<string>();
const imports = new Set<string>();
const audit: Plugin = {
  name: 'canvas-surface-closure-audit',
  enforce: 'pre',
  resolveId(source, importer) {
    // The upstream browser condition allocates a DOM element at module load.
    // Its official pure-JS implementation is equivalent and also permits SSR imports.
    if (source === 'decode-named-character-reference' && importer) return createRequire(importer).resolve(source);
  },
  transform(_code, id) {
    if (/\.(css|scss)(\?|$)/.test(id)) modules.add(id.split('?')[0]!);
  },
  generateBundle(_options, bundle) {
    for (const item of Object.values(bundle)) {
      if (item.type !== 'chunk') continue;
      for (const id of Object.keys(item.modules)) {
        if (!id.startsWith('\0')) modules.add(id.split('?')[0]!);
        if (/node_modules\/(react|react-dom)\//.test(id)) throw new Error(`React renderer must remain external: ${id}`);
        if (/\/apps\//.test(id)) throw new Error(`App implementation crossed surface boundary: ${id}`);
      }
      for (const id of [...item.imports, ...item.dynamicImports]) {
        if (bundle[id]) continue;
        if (!isPeer(id)) throw new Error(`Undeclared external dependency: ${id}`);
        imports.add(id);
      }
    }
  },
};
// Vite owns only this package's resolved dist output; no existing source is removed.
if (distRoot !== resolve(workspaceRoot, 'packages/canvas-surface/dist')) throw new Error('Unexpected output directory');
await build({
  configFile: false,
  root: packageRoot,
  plugins: [audit],
  css: { modules: { generateScopedName: 'cs_[name]_[local]_[hash:base64:5]' } },
  resolve: {
    alias: Object.entries(workspaceAliases()).map(([find, replacement]) => ({ find: new RegExp(`^${find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`), replacement })),
    dedupe: ['react', 'react-dom', '@xyflow/react'],
  },
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: {
    outDir: distRoot,
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,
    minify: true,
    cssCodeSplit: false,
    lib: { entry: resolve(packageRoot, 'src/index.ts'), formats: ['es'], fileName: 'index', cssFileName: 'styles' },
    rolldownOptions: {
      external: (id) => isPeer(id) && !id.endsWith('.css'),
      output: { banner: '"use client";\n/*! Canvas surface — Apache-2.0; see LICENSE, NOTICE and third-party-licenses. */' },
    },
  },
});
const declarations = buildDeclarations();

const licenseRoot = resolve(distRoot, 'third-party-licenses');
mkdirSync(licenseRoot, { recursive: true });
const packageDirectories = new Set<string>();
for (const source of [...modules, ...declarations.externalSources]) {
  if (!existsSync(source)) continue;
  const actual = realpathSync(source);
  if (!actual.startsWith(`${realpathSync(workspaceRoot)}/`)) throw new Error(`Source outside independent workspace: ${actual}`);
  let dir = dirname(actual);
  while (dir.startsWith(workspaceRoot)) {
    const metadata = resolve(dir, 'package.json');
    if (existsSync(metadata) && JSON.parse(readFileSync(metadata, 'utf8')).name) {
      packageDirectories.add(dir);
      break;
    }
    dir = dirname(dir);
  }
}
const licenses: { name: string; version: string; license: unknown; files: string[] }[] = [];
for (const directory of [...packageDirectories].sort()) {
  const pkg = JSON.parse(readFileSync(resolve(directory, 'package.json'), 'utf8')) as { name: string; version: string; license?: unknown };
  const files = readdirSync(directory).filter((name) => /^(licen[cs]e|notice|copying)([.-]|$)/i.test(name) && statSync(resolve(directory, name)).isFile());
  const copied: string[] = [];
  for (const file of files) {
    const destination = `${pkg.name.replace(/^@/, '').replaceAll('/', '--')}@${pkg.version}--${file}`;
    copyFileSync(resolve(directory, file), resolve(licenseRoot, destination));
    copied.push(destination);
  }
  const workspacePackage = directory.startsWith(resolve(workspaceRoot, 'packages') + '/');
  if (!workspacePackage && copied.length === 0) throw new Error(`No redistributable license text found for ${pkg.name}`);
  licenses.push({ name: pkg.name, version: pkg.version, license: pkg.license ?? (workspacePackage ? 'Apache-2.0 (workspace)' : 'unspecified'), files: copied });
}
copyFileSync(resolve(workspaceRoot, 'LICENSE'), resolve(packageRoot, 'LICENSE'));
const report = {
  package: `${manifest.name}@${manifest.version}`,
  upstream: 'Bezier/Loom 319e5eee556a3641d2ee68a6111a36ddc7a1eff7',
  workspaceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: workspaceRoot, encoding: 'utf8' }).trim(),
  sourceState: 'Current working tree, including pre-existing local adaptations; not a clean upstream snapshot.',
  node: process.version,
  externalImports: [...imports].sort(),
  moduleCount: modules.size,
  declarationFiles: declarations.files,
  cssModuleSources: [...modules].filter((path) => path.endsWith('.module.css')).map((path) => relative(workspaceRoot, path)).sort(),
  sourceSha256: Object.fromEntries([...modules].filter((path) => existsSync(path) && path.startsWith(resolve(workspaceRoot, 'packages') + '/')).sort().map((path) => [relative(workspaceRoot, path), createHash('sha256').update(readFileSync(path)).digest('hex')])),
  licenses,
};
writeFileSync(resolve(distRoot, 'build-report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ package: report.package, externalImports: report.externalImports, moduleCount: report.moduleCount, declarationFiles: report.declarationFiles, licensePackages: licenses.length }, null, 2));
