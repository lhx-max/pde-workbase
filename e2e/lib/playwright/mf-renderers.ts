import type { Page, TestInfo } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

interface RendererVersion { version: string; rendererPackageName: string }

/** Standard React DevTools injection diagnostic only: no render/dispatcher overrides. */
export async function recordMfRendererVersions(page: Page) {
  await page.addInitScript(() => {
    const target = globalThis as typeof globalThis & { __REACT_DEVTOOLS_GLOBAL_HOOK__?: unknown };
    if (target.__REACT_DEVTOOLS_GLOBAL_HOOK__) return;
    const renderers = new Map<number, { version: string; rendererPackageName: string }>();
    let id = 0;
    target.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
      supportsFiber: true,
      renderers,
      inject(renderer: { version: string; rendererPackageName: string }) {
        const next = ++id;
        renderers.set(next, renderer);
        return next;
      },
      onCommitFiberRoot() {},
      onCommitFiberUnmount() {},
      onPostCommitFiberRoot() {},
    };
  });
  const versions = () => {
    const target = globalThis as typeof globalThis & { __REACT_DEVTOOLS_GLOBAL_HOOK__?: { renderers?: Map<number, RendererVersion> } };
    return [...(target.__REACT_DEVTOOLS_GLOBAL_HOOK__?.renderers?.values() ?? [])]
      .map(({ version, rendererPackageName }) => ({ version, rendererPackageName }));
  };
  const snapshot = async () => ({
    parent: { url: page.url(), renderers: await page.mainFrame().evaluate(versions) },
    mf: await Promise.all(page.frames().filter(frame => /\/mf-ui(?:\/|\?|$)/.test(frame.url())).map(async frame => ({
      url: frame.url(), renderers: await frame.evaluate(versions),
    }))),
  });
  return { snapshot, async attach(info: TestInfo) {
    const path = info.outputPath('mf-renderer-versions.json');
    await writeFile(path, JSON.stringify(await snapshot(), null, 2));
    await info.attach('mf-renderer-versions.json', { path, contentType: 'application/json' });
  } };
}
