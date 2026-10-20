import type { ReactNode } from 'react';
import '@excalidraw/excalidraw/index.css';
export const metadata={title:'Canvas Workspace',description:'Independent canvas creation workspace'};
export default function RootLayout({children}:{children:ReactNode}){return <html lang="en"><body>{children}</body></html>;}
