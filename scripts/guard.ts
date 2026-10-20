import { readFileSync, readdirSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const errors: string[] = [];
const excluded = new Set(['node_modules', 'dist', '.git', '.next', '.tmp', 'test-results', 'playwright-report']);
const files: string[] = [];
function visit(directory: string) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (excluded.has(entry.name)) continue;
    const filename = path.join(directory, entry.name);
    const relative = path.relative(root, filename).split(path.sep).join('/');
    if (entry.isSymbolicLink()) {
      const target = realpathSync(filename);
      if (!target.startsWith(root + path.sep) && target !== root) errors.push(`${relative}: symlink leaves repository`);
    } else if (entry.isDirectory()) visit(filename);
    else files.push(relative);
  }
}
visit(root);
const manifests = files.filter(file => /(^|\/)package\.json$/.test(file)).map(file => ({ file, value: JSON.parse(readFileSync(path.join(root, file), 'utf8')) as { name: string; dependencies?: Record<string, string>; devDependencies?: Record<string, string>; peerDependencies?: Record<string, string>; scripts?: Record<string, string> } }));
const names = new Set(manifests.map(item => item.value.name));
for (const { file, value } of manifests) {
  for (const [name, spec] of Object.entries({ ...value.dependencies, ...value.devDependencies, ...value.peerDependencies })) {
    if (spec.startsWith('workspace:') && !names.has(name)) errors.push(`${file}: unresolved workspace dependency ${name}`);
    if (/^(?:link:|file:)/.test(spec)) errors.push(`${file}: nonportable local dependency ${name}`);
  }
}
const rootManifest = manifests.find(item => item.file === 'package.json')!.value;
for (const name of ['dev', 'dev:all', 'start', 'preview', 'daemon', 'build', 'test']) {
  if (rootManifest.scripts?.[name]) errors.push(`package.json: root ${name} alias violates package/tool command ownership`);
}
// The original asset-library renderer is allowed for the user-approved local source;
// chat and the original team/account product are still outside this repository.
const bannedApps = /(?:^|\/)(?:ChatPane|ChatComposer|ChatInput|AssistantMessage|SideChatTab|HomeDashboard|TeamWorkbench)\.(?:tsx?|jsx?)$/;
const javascriptCompatibility = new Set(['packages/contracts/esbuild.config.mjs', 'packages/host/esbuild.config.mjs']);
for (const file of files) {
  if (bannedApps.test(file)) errors.push(`${file}: excluded product runtime component`);
  if (/\/src\/.*\.(?:test|spec)\.tsx?$/.test(file)) errors.push(`${file}: tests belong in sibling tests directory`);
  if (/\.(?:js|mjs|cjs)$/.test(file) && !javascriptCompatibility.has(file) && !/(?:fixtures|public|vendor)\//.test(file)) errors.push(`${file}: undocumented JavaScript compatibility artifact`);
  if (!/\.(?:ts|tsx|mjs|cjs|js)$/.test(file)) continue;
  const source = readFileSync(path.join(root, file), 'utf8');
  const imports = ts.preProcessFile(source, true, true).importedFiles;
  for (const item of imports) {
    const specifier = item.fileName;
    if (specifier.includes('/apps/daemon/') || /^@bezier\/(?:daemon|sidecar|sidecar-proto|platform|personal-assets)$/.test(specifier)) errors.push(`${file}: excluded product dependency ${specifier}`);
    if (/^(?:\/Users\/|\/home\/|[A-Za-z]:\\)/.test(specifier)) errors.push(`${file}: absolute runtime import ${specifier}`);
    if (specifier.startsWith('.')) {
      const target = path.resolve(root, path.dirname(file), specifier);
      if (!target.startsWith(root + path.sep)) errors.push(`${file}: relative import leaves repository ${specifier}`);
      const owner = /^apps\/([^/]+)\//.exec(file)?.[1];
      const importedApp = /^apps\/([^/]+)\//.exec(path.relative(root, target).split(path.sep).join('/'))?.[1];
      if (owner && importedApp && owner !== importedApp) errors.push(`${file}: cross-app private import ${specifier}`);
    }
    if (file.startsWith('packages/contracts/src/') && /^(?:node:|fs$|path$|express$|react$|next\/|better-sqlite3$|electron$)/.test(specifier)) errors.push(`${file}: impure shared contract import ${specifier}`);
  }
}
if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else console.log(`Guard passed: ${files.length} files, ${manifests.length} package manifests; no upstream runtime or excluded product imports.`);
