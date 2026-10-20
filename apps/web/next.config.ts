import type { NextConfig } from 'next';
import { resolve } from 'node:path';
const config: NextConfig = {
  transpilePackages: ['@bezier/components', '@bezier/contracts', '@bezier/canvas-workbench', '@bezier/workbench-core', '@bezier/workbench-ui', '@bezier/host'],
  turbopack: { root: resolve(process.cwd(), '../..') },
  // API/artifact/frame route handlers resolve the explicitly configured origin at runtime.
};
export default config;
