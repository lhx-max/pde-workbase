import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { isPeer, packageRoot, workspaceAliases, workspaceRoot } from '../tools/shared';

test('only renderer and React Flow packages are external peers', () => {
  for (const value of ['react', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'react-dom', 'react-dom/client', '@xyflow/react']) assert(isPeer(value), value);
  for (const value of ['reactive', 'react-dom-other', '@xyflow/system', '@bezier/contracts', '@bezier/canvas-workbench', 'lucide-react']) assert(!isPeer(value), value);
});

test('workspace aliases resolve current independent source, not existing dist', () => {
  const aliases = workspaceAliases();
  assert.equal(aliases['@bezier/canvas-workbench'], resolve(workspaceRoot, 'packages/canvas-workbench/src/index.ts'));
  assert.equal(aliases['@bezier/contracts'], resolve(workspaceRoot, 'packages/contracts/src/index.ts'));
  assert.equal(aliases['@bezier/workbench-ui/styles.css'], resolve(workspaceRoot, 'packages/workbench-ui/src/workbench-ui.css'));
  for (const target of Object.values(aliases)) {
    assert(target.startsWith(resolve(workspaceRoot, 'packages') + '/'));
    assert(existsSync(target));
    assert(!target.includes('/dist/'));
  }
});

test('published manifest exposes one explicit stylesheet and no workspace dependencies', () => {
  const manifest = JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf8'));
  assert.equal(manifest.exports['./styles.css'], './dist/styles.css');
  assert.deepEqual(manifest.dependencies ?? {}, {});
  assert(!JSON.stringify(manifest).includes('workspace:'));
  assert.deepEqual(manifest.peerDependencies, { '@xyflow/react': '12.8.5', react: '18.3.1', 'react-dom': '18.3.1' });
  assert(manifest.sideEffects.includes('**/*.css'));
  assert(!manifest.files.includes('src'));
});
