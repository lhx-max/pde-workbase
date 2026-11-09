import type { WorkflowEditorNodeKind } from '@bezier/workbench-core';
import type { IconName } from './Icon';

/** One Lucide-backed vocabulary for menus, node headers and conversation context. */
export const WORKFLOW_NODE_ICONS: Record<WorkflowEditorNodeKind, IconName> = {
  start: 'play',
  clarify: 'message-circle-question',
  agent: 'bot',
  branch: 'git-branch',
  review: 'circle-check',
  delivery: 'package',
  decision: 'git-branch',
  'canvas-card': 'package',
};
