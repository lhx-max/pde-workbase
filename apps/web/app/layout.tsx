import type { ReactNode } from 'react';
// Preserve the frozen root cascade: vendor/package styles, global primitives,
// then the client page's component styles. Eager App imports must not invert it.
import '@excalidraw/excalidraw/index.css';
import '@xyflow/react/dist/style.css';
import '@bezier/canvas-workbench/styles.css';
import '@bezier/workbench-ui/styles.css';
import '../src/index.css';
export const metadata={title:'画布工作区',description:'独立画布创作工作区'};
export default function RootLayout({children}:{children:ReactNode}){return <html lang="zh-CN" data-theme="light"><body>{children}</body></html>;}
