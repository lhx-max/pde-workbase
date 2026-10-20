import { createContext, useContext, type ReactNode } from 'react';
import type { WorkspaceCollabContext } from '@bezier/contracts';
/** Authorization is supplied by the embedding host, never fabricated by the UI. */
export type ProjectResourceAuthority='pending'|'denied'|'local'|'workspace';
const Context = createContext<{workspaceContext:WorkspaceCollabContext|null;workspaceContextLoading:boolean;projectResourceAuthority:ProjectResourceAuthority}>({workspaceContext:null,workspaceContextLoading:false,projectResourceAuthority:'local'});
export function ProjectCollabProvider({children,workspaceContext=null}:{children:ReactNode;workspaceContext?:WorkspaceCollabContext|null}) { return <Context.Provider value={{workspaceContext,workspaceContextLoading:false,projectResourceAuthority:workspaceContext?'workspace':'local'}}>{children}</Context.Provider>; }
export function useProjectCollabContext() { return useContext(Context); }
