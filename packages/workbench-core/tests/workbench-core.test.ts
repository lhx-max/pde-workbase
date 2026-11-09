import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  loadWorkflowEditorPresetFlows,
  synchronizeWorkflowReviewSelection,
  type WorkflowReviewNodeConfig,
} from '../src';

const SOURCE_ROOT = join(import.meta.dirname, '..', 'src');

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : entry.name.endsWith('.ts') ? [path] : [];
  });
}

describe('workbench core boundary', () => {
  it('does not import or name product business modules', () => {
    const source = sourceFiles(SOURCE_ROOT).map((file) => readFileSync(file, 'utf8')).join('\n');

    expect(source).not.toMatch(/@bezier\/(?:canvas-workbench|brand)/i);
    expect(source).not.toMatch(/\bbusiness-adapter\b|\bcanvas-workbench\b|\/api\/actions\/business\.|\blegacy_plan\b/i);
  });

  it('does not load product presets for a blank workflow', async () => {
    const loadFlow = vi.fn(async (flowId: string) => flowId);

    await expect(loadWorkflowEditorPresetFlows(true, ['business-flow'], loadFlow)).resolves.toEqual([]);
    expect(loadFlow).not.toHaveBeenCalled();
  });

  it('keeps review selection aligned across chat and canvas', () => {
    const config: WorkflowReviewNodeConfig = {
      enabled: true,
      selection: 'multiple',
      selectionRequired: true,
      feedbackEnabled: true,
      feedbackRequired: false,
      allowRegenerate: true,
      continueLabel: '继续',
      artifactKind: 'text',
    };

    const next = synchronizeWorkflowReviewSelection(config, 'none');

    expect(next.selectionRequired).toBe(false);
    expect(next.chat).toMatchObject({ selection: 'none', selectionRequired: false });
    expect(next.canvas).toMatchObject({ selection: 'none', selectionRequired: false });
  });
});
