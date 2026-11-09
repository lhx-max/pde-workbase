export const WORKFLOW_RESULT_SYNC_EVENT = 'bezier:workflow-result-sync';

export type WorkflowResultSyncDetail = {
  projectId: string;
  resultId: string;
  source: 'chat' | 'canvas';
  phase: 'draft' | 'committed';
  selectedIds?: string[];
  feedback?: string;
};
