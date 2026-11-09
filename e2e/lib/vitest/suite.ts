import { beforeAll, afterAll, afterEach } from 'vitest';
import { startToolsDev, type ToolsDevRuntime } from '../tools-dev/runtime.js';
import { T } from '../timeouts.js';
export function useToolsDev() {
  let runtime: ToolsDevRuntime | undefined;
  let failed = false;
  beforeAll(async () => { runtime = await startToolsDev({ label: 'http-suite' }); }, T.xlong + T.long);
  afterEach(context => { if (context.task.result?.state === 'fail') failed = true; });
  afterAll(async () => {
    if (!runtime) return;
    if (failed) console.error(`Preserved tools-dev runtime: ${runtime.root} (data: ${runtime.dataRoot})`);
    await runtime.dispose({ preserve: failed });
  }, T.long);
  return () => { if (!runtime) throw new Error('Isolated tools-dev runtime is not ready'); return runtime; };
}
