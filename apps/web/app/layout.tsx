import type { ReactNode } from 'react';
import '@excalidraw/excalidraw/index.css';
export const metadata={title:'画布工作区',description:'独立画布创作工作区'};
export default function RootLayout({children}:{children:ReactNode}){return <html lang="zh-CN" data-theme="light"><body>{children}</body></html>;}
