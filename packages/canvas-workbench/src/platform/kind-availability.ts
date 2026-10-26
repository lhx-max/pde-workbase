'use client';

import React from 'react';
import { platformFetchWithContext, type CanvasHostContext } from './api-base';

/**
 * Card kinds the host currently allows the user to create.
 *
 * `null` (the default) means unrestricted — standalone workbench usage and
 * hosts without an App registry keep the full catalogue. The workspace host
 * narrows the set from the canvas capability manifest + the App registry:
 * native kinds stay, App-backed kinds only appear while their editor App is
 * registered and active.
 */
export const CanvasKindAvailability = React.createContext<ReadonlySet<string> | null>(null);

/** Team grant resolution is independent of mounted-editor availability. Failed
 * policy reads hide creation entries; they never silently become allow-all.
 * Existing assets remain in the state so a policy change cannot delete them.
 */
export function CanvasTeamKindAvailability({context,children}:{context:CanvasHostContext;children:React.ReactNode}){
  const parent=React.useContext(CanvasKindAvailability);
  const [result,setResult]=React.useState<{context:CanvasHostContext;kinds:ReadonlySet<string>}|null>(null);
  React.useEffect(()=>{
    let active=true;
    void platformFetchWithContext(context,`/api/apps/canvas/instances/${encodeURIComponent(context.projectId)}/capabilities`)
      .then(async response=>{if(!response.ok)throw new Error('Card permissions unavailable');const body=await response.json() as {data?:{allowedKinds?:unknown}};const kinds=body.data?.allowedKinds;if(!Array.isArray(kinds)||kinds.some(kind=>typeof kind!=='string'))throw new Error('Invalid card permissions');if(active)setResult({context,kinds:new Set(kinds as string[])});})
      .catch(()=>{if(active)setResult({context,kinds:new Set()});});
    return()=>{active=false;};
  },[context]);
  const allowed=React.useMemo(()=>new Set(result?.context===context?[...result.kinds].filter(kind=>!parent||parent.has(kind)):[]),[result,context,parent]);
  return React.createElement(CanvasKindAvailability.Provider,{value:allowed},children);
}

/** Predicate shared by every add-node entry (dock, empty canvas, card ports). */
export function useCanvasKindAvailability(): (kind: string) => boolean {
  const allowed = React.useContext(CanvasKindAvailability);
  return React.useCallback((kind: string) => !allowed || allowed.has(kind), [allowed]);
}
