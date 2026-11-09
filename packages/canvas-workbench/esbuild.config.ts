import { rmSync } from 'node:fs';

import { build } from 'esbuild';

rmSync('./dist', { force: true, recursive: true });

/**
 * 画布包的构建。
 *
 * 关键点：整个包都是浏览器端组件，所以给产物统一打上 `'use client'` banner。
 * esbuild 合并模块时会丢掉各文件顶部的指令，靠 banner 一次性补回；否则
 * Next 会把它当 Server Component 编译，`useState` 一类会直接报错。
 *
 * CSS：源码里的 `import './canvas-workbench.css'` 会被收敛成 `dist/index.css`，
 * 由 package.json 的 `./styles.css` 出口对外暴露。
 */
await build({
  banner: { js: "'use client';" },
  bundle: true,
  entryPoints: ['./src/index.ts'],
  format: 'esm',
  loader: { '.svg': 'dataurl' },
  outbase: './src',
  outdir: './dist',
  outExtension: { '.js': '.mjs' },
  packages: 'external',
  platform: 'browser',
  target: 'es2022',
});
