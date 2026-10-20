// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QuestionFormView } from '../src/components/QuestionForm';
import { WorkflowCanvasQuestion } from '../src/components/workspace/WorkflowCanvasQuestion';
import { matchingReference, selectedReferencesValid } from '../src/components/AssetReferenceChoices';
import { queryQuestionReferences, type QuestionReferenceAsset } from '../src/components/question-form-reference-adapter';
import type { QuestionForm } from '../src/artifacts/question-form';
import type { WorkflowCanvasRun } from '@bezier/contracts';

const option = { label: 'Reference', value: 'reference', asset: { assetId: 'a', spaceId: 'space', versionId: 'v1' } };
const form: QuestionForm = { id: 'refs', title: 'References', questions: [{ id: 'ref', label: 'Choose reference', type: 'radio', required: true, options: [option] }] };
const asset: QuestionReferenceAsset = { id: 'a', name: 'Reference', kind: 'slides', spaceId: 'space', versions: [{ id: 'v1' }] };
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('neutral question reference adapters', () => {
  it('rejects absent capabilities explicitly without querying a global library', async () => {
    await expect(queryQuestionReferences(undefined, form)).rejects.toMatchObject({ code: 'UNSUPPORTED_CAPABILITY' });
  });
  it('keeps exact space, latest revision and deletion checks from the original', () => {
    expect(matchingReference(option, [asset])).toBe(asset);
    expect(matchingReference(option, [{ ...asset, spaceId: 'other' }])).toBeUndefined();
    expect(matchingReference(option, [{ ...asset, versions: [{ id: 'v2' }] }])).toBeUndefined();
    expect(matchingReference(option, [{ ...asset, deletedAt: 1 }])).toBeUndefined();
    expect(selectedReferencesValid(form, { ref: ['reference'] }, [])).toBe(false);
    expect(selectedReferencesValid(form, { ref: 'reference' }, [asset])).toBe(true);
  });
  it('renders original reference controls unavailable without an adapter', async () => {
    render(<QuestionFormView form={form} interactive onSubmit={vi.fn()} />);
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect((screen.getByRole('radio', { name: 'Reference' }) as HTMLButtonElement).disabled).toBe(true);
  });
  it('queries the provided host and preserves original radio card UI', async () => {
    const query = vi.fn(async () => [asset]);
    render(<QuestionFormView form={form} interactive referenceAdapter={{ query }} onSubmit={vi.fn()} />);
    await screen.findByRole('button', { name: 'Preview Reference' });
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]).toBeDefined();
    expect((screen.getByRole('radio', { name: 'Reference' }) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('original workflow clarification submission', () => {
  function snapshot(stepRunId: string) {
    return { run: { id: 'run-1' }, clarification: { stepRunId, content: `<question-form id="workflow-run-1-${stepRunId}">${JSON.stringify({ title: 'Brief', submitLabel: 'Continue workflow', questions: [{ id: 'answer', label: 'Answer', type: 'text', defaultValue: stepRunId, required: true }] })}</question-form>` } } as unknown as WorkflowCanvasRun;
  }
  it('submits typed answers to the existing endpoint and resets for the next step', async () => {
    const fetcher = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true }) }));
    vi.stubGlobal('fetch', fetcher);
    const { rerender } = render(<WorkflowCanvasQuestion snapshot={snapshot('step-1')} />);
    fireEvent.click(screen.getByRole('button', { name: 'Continue workflow' }));
    await screen.findByRole('status');
    expect(fetcher).toHaveBeenCalledWith('/api/workflow-graph-runs/run-1/clarification', expect.objectContaining({ method: 'POST', body: JSON.stringify({ stepRunId: 'step-1', values: { answer: 'step-1' } }) }));
    rerender(<WorkflowCanvasQuestion snapshot={snapshot('step-2')} />);
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('step-2');
    expect((screen.getByRole('button', { name: 'Continue workflow' }) as HTMLButtonElement).disabled).toBe(false);
  });
});
