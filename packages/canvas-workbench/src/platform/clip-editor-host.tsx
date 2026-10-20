import React from 'react';

export interface ClipEditorHost {
  nodeId?: string | null;
  onOpen?: (nodeId: string) => void;
  onBack?: () => void;
}
export const ClipEditorHostContext = React.createContext<ClipEditorHost>({});

export const clipEditorTabId = (nodeId: string): string => `clip-editor:${encodeURIComponent(nodeId)}`;
export function clipNodeIdFromTab(tabId: string): string | null {
  if (!tabId.startsWith('clip-editor:')) return null;
  try { return decodeURIComponent(tabId.slice('clip-editor:'.length)) || null; } catch { return null; }
}
