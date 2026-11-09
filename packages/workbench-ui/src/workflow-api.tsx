'use client';

import { createContext, useContext, type ReactNode } from 'react';

export type WorkflowApiFetch = (path: string, init?: RequestInit) => Promise<Response>;
const WorkflowApiContext = createContext<WorkflowApiFetch>((path, init) => fetch(path, init));

/** Transport/catalog adapters are instance-scoped and supplied by the embedding host. */
export function WorkflowApiProvider({ request, children }: { request: WorkflowApiFetch; children: ReactNode }) {
  return <WorkflowApiContext.Provider value={request}>{children}</WorkflowApiContext.Provider>;
}

export function useWorkflowApi(): WorkflowApiFetch { return useContext(WorkflowApiContext); }
