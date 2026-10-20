import type { NextConfig } from 'next';
import { resolve } from 'node:path';
const buildDirectory = process.env.CANVAS_WEB_BUILD_DIR;
if (buildDirectory && !/^\.tmp\/[a-zA-Z0-9_-]+$/.test(buildDirectory)) throw new Error('CANVAS_WEB_BUILD_DIR must be a named build under .tmp/');
const config: NextConfig = {
  ...(buildDirectory ? { distDir: buildDirectory } : {}),
  transpilePackages: ['@bezier/components', '@bezier/contracts', '@bezier/canvas-workbench', '@bezier/workbench-core', '@bezier/workbench-ui', '@bezier/host', '@doc/surface'],
  turbopack: { root: resolve(process.cwd(), '../..') },
  // API/artifact/frame route handlers resolve the explicitly configured origin at runtime.
};
export default config;
