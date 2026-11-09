'use client';
import React from 'react';
import { FolderPlus } from 'lucide-react';
import { Button } from '@bezier/components';
import { useCanvasUiHost } from '../platform/ui-host';
import { cr } from '../locales/canvas-remainder';

/** Only mount when the caller has an actual result. */
export function CanvasSaveAssetButton({ nodeId, className = '', draft, disabled, presentation = 'icon' }: { nodeId?: string; className?: string; disabled?: boolean; presentation?: 'icon' | 'menu-item'; draft?: Parameters<NonNullable<NonNullable<ReturnType<typeof useCanvasUiHost>>['saveResource']>>[0] }) {
  const host = useCanvasUiHost();
  const [busy, setBusy] = React.useState(false);
  const [status, setStatus] = React.useState('');
  if (!host?.saveResource) return null;
  const save: React.MouseEventHandler<HTMLButtonElement> = event => {
    event.stopPropagation();
    if (busy) return;
    setBusy(true); setStatus('');
    (draft ? host.saveResource!({ ...draft, nodeId: nodeId ?? draft.nodeId }) : new Promise<void>((resolve, reject) => event.currentTarget.dispatchEvent(new CustomEvent('canvas:save-resource', { bubbles: true, composed: true, detail: { nodeId, resolve, reject } }))))
      .then(() => setStatus(cr().savedToAssets)).catch(error => setStatus(error instanceof Error ? error.message : cr().saveFailed)).finally(() => setBusy(false));
  };
  const icon=<FolderPlus size={18} strokeWidth={1.75} aria-hidden="true" />;
  const action=presentation==='menu-item'
    ? <button type="button" role="menuitem" className={`mario-selection-action ${className}`} aria-label={cr().saveToAssets} aria-busy={busy||undefined} disabled={busy||disabled} onPointerDown={event=>event.stopPropagation()} onClick={save}>{icon}<span>{status||cr().saveToAssets}</span></button>
    : <Button variant="ghost" size="icon" className={`bezier-tooltip ${className}`} data-tooltip={status||cr().saveToAssets} aria-label={cr().saveToAssets} disabled={busy||disabled} onPointerDown={event=>event.stopPropagation()} onClick={save}>{icon}</Button>;
  return <>{action}<span role="status" style={{position:'absolute',width:1,height:1,padding:0,overflow:'hidden',clipPath:'inset(50%)',whiteSpace:'nowrap'}}>{status}</span></>;
}
