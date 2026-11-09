import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import ts from 'typescript';
import { distRoot, isPeer, packageRoot, workspaceAliases, workspaceRoot } from './shared';

/** Emit and relocate the reachable declaration graph, including non-peer type dependencies. */
export function buildDeclarations(): { files: number; externalSources: string[] } {
  const paths = Object.fromEntries(Object.entries(workspaceAliases()).map(([key, value]) => [key, [value]]));
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx: ts.JsxEmit.ReactJSX,
    strict: true,
    skipLibCheck: true,
    esModuleInterop: true,
    resolveJsonModule: true,
    declaration: true,
    emitDeclarationOnly: true,
    rootDir: resolve(workspaceRoot, 'packages'),
    outDir: resolve(distRoot, 'types'),
    baseUrl: workspaceRoot,
    paths,
    types: ['react', 'react-dom'],
    typeRoots: [resolve(packageRoot, 'node_modules/@types')],
  };
  const entry = resolve(packageRoot, 'src/index.ts');
  const ambientFiles = [
    resolve(workspaceRoot, 'packages/canvas-workbench/src/styles.d.ts'),
    resolve(workspaceRoot, 'packages/workbench-ui/src/css-modules.d.ts'),
  ];
  const program = ts.createProgram([entry, ...ambientFiles], options);
  const emitted = new Map<string, { text: string; path: string }>();
  const result = program.emit(undefined, (path, text, _bom, _error, sources) => {
    for (const source of sources ?? []) emitted.set(resolve(source.fileName), { text, path });
  });
  const errors = [...ts.getPreEmitDiagnostics(program), ...result.diagnostics].filter((d) => d.category === ts.DiagnosticCategory.Error);
  if (errors.length) {
    throw new Error(ts.formatDiagnosticsWithColorAndContext(errors, {
      getCanonicalFileName: (file) => file,
      getCurrentDirectory: () => workspaceRoot,
      getNewLine: () => '\n',
    }));
  }
  const visited = new Map<string, string>();
  const externalSources: string[] = [];
  function visit(sourcePath: string): string {
    sourcePath = resolve(sourcePath);
    const previous = visited.get(sourcePath);
    if (previous) return previous;
    const emission = emitted.get(sourcePath);
    if (!emission && !sourcePath.endsWith('.d.ts') && !sourcePath.endsWith('.d.mts') && !sourcePath.endsWith('.d.cts')) {
      throw new Error(`Missing declaration emission: ${sourcePath}`);
    }
    const output = emission?.path ?? resolve(distRoot, 'types/vendor', `${createHash('sha256').update(relative(workspaceRoot, sourcePath)).digest('hex').slice(0, 16)}.d.ts`);
    if (!emission) externalSources.push(sourcePath);
    visited.set(sourcePath, output);
    const text = emission?.text ?? readFileSync(sourcePath, 'utf8');
    const syntax = ts.createSourceFile(output, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const changes: { start: number; end: number; value: string }[] = [];
    function walk(node: ts.Node): void {
      let literal: ts.StringLiteralLike | undefined;
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) literal = node.moduleSpecifier;
      if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteralLike(node.argument.literal)) literal = node.argument.literal;
      if (ts.isExternalModuleReference(node) && node.expression && ts.isStringLiteralLike(node.expression)) literal = node.expression;
      if (literal && !isPeer(literal.text)) {
        // Styles are delivered through the explicit CSS export, not declaration imports.
        if (/\.(css|scss)$/.test(literal.text) && ts.isImportDeclaration(node)) {
          changes.push({ start: node.getStart(syntax), end: node.getEnd(), value: '' });
        } else {
          const resolved = ts.resolveModuleName(literal.text, sourcePath, options, ts.sys).resolvedModule;
          if (!resolved) throw new Error(`Unresolved declaration import ${literal.text} in ${sourcePath}`);
          const target = visit(resolved.resolvedFileName);
          let specifier = relative(dirname(output), target).replaceAll('\\', '/').replace(/\.d\.(ts|mts|cts)$/, '.js');
          if (!specifier.startsWith('.')) specifier = `./${specifier}`;
          changes.push({ start: literal.getStart(syntax), end: literal.getEnd(), value: JSON.stringify(specifier) });
        }
      }
      ts.forEachChild(node, walk);
    }
    walk(syntax);
    let rewritten = text;
    for (const change of changes.sort((a, b) => b.start - a.start)) rewritten = rewritten.slice(0, change.start) + change.value + rewritten.slice(change.end);
    if (/reference\s+(path|types)=/.test(rewritten)) throw new Error(`Unrelocated declaration reference in ${sourcePath}`);
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, rewritten);
    return output;
  }
  visit(entry);
  return { files: visited.size, externalSources };
}
