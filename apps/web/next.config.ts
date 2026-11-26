import type { NextConfig } from 'next';
import { resolve } from 'node:path';
const buildDirectory = process.env.CANVAS_WEB_BUILD_DIR;
if (buildDirectory && !/^\.tmp\/[a-zA-Z0-9_-]+$/.test(buildDirectory)) throw new Error('CANVAS_WEB_BUILD_DIR must be a named build under .tmp/');
const config: NextConfig = {
  ...(buildDirectory ? { distDir: buildDirectory } : {}),
  // This app proxies authenticated files. Dev HMR must not retain old upstream responses.
  experimental: { serverComponentsHmrCache: false },
  // Dev-only floating "N" badge/menu (bottom-left route/build info cards); no product value here.
  devIndicators: false,
  transpilePackages: ['@bezier/components', '@bezier/contracts', '@bezier/canvas-workbench', '@bezier/workbench-core', '@bezier/workbench-ui', '@bezier/host', '@doc/surface', '@sketch/surface', '@ks-designai/browser-surface'],
  turbopack: { root: resolve(process.cwd(), '../..') },
  // Dev previews (tunnels/proxies) arrive under foreign origins; dev assets like
  // webpack-hmr are origin-checked by Next and would 403 without this list.
  allowedDevOrigins: ['127.0.0.1', 'localhost', '*.devin.cli', '*.devinapps.com', '*.devin.com'],
  // API/artifact/frame route handlers resolve the explicitly configured origin at runtime.
};
export default config;
