import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync, realpathSync } from 'node:fs';

const web = createRequire(new URL('../../apps/web/package.json', import.meta.url));
const mf = createRequire(new URL('../../apps/mf-ui/package.json', import.meta.url));
const version = (filename: string): string => (JSON.parse(readFileSync(filename, 'utf8')) as { version: string }).version;
const resolved = (require: NodeJS.Require, dependency: string) => realpathSync(require.resolve(`${dependency}/package.json`));

/** Observe installed peer/declaration graphs. Next may bundle its own App Router renderer;
 * browser evidence records that separately rather than equating package pins with runtime versions. */
describe('MF versus canvas runtime and declaration isolation', () => {
  it('keeps React18 canvas and React19 MF physically separate with paired renderers', () => {
    expect(version(resolved(web, 'react'))).toBe('18.3.1');
    expect(version(resolved(mf, 'react'))).toBe('19.2.3');
    expect(resolved(web, 'react')).not.toBe(resolved(mf, 'react'));
    for (const require of [web, mf]) {
      expect(version(resolved(require, 'react-dom'))).toBe(version(resolved(require, 'react')));
      const renderer = createRequire(resolved(require, 'react-dom'));
      expect(resolved(renderer, 'react')).toBe(resolved(require, 'react'));
    }
  });
  it('resolves the real MF SDK peer to its React19 document, not the host renderer', () => {
    // SDK exports are browser/ESM-only. Observe its installed manifest without requiring SDK code.
    const manifest = realpathSync(new URL('../../apps/mf-ui/node_modules/@ks-kp/agent-ui/package.json', import.meta.url));
    expect(version(manifest)).toBe('0.1.5-beta.18');
    const sdk = createRequire(manifest);
    expect(resolved(sdk, 'react')).toBe(resolved(mf, 'react'));
    expect(version(resolved(sdk, '@types/react'))).toMatch(/^19\./);
  });
  it('keeps canvas library declarations on React18 despite the installed MF type graph', () => {
    for (const dependency of ['@xyflow/react', 'lucide-react', 'motion/react', 'next', '@bezier/components']) {
      const owner = createRequire(web.resolve(dependency));
      expect(version(resolved(owner, '@types/react')), dependency).toMatch(/^18\./);
      expect(version(resolved(owner, 'react')), dependency).toMatch(/^18\./);
    }
  });
});
