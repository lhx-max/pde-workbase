import { useState } from 'react';
import type { WorkflowCanvasRun, WorkspaceCollabContext } from '@bezier/contracts';
import { splitOnQuestionForms } from '../../artifacts/question-form';
import { QuestionFormView, type QuestionReferenceAdapter } from '../QuestionForm';
import { workspaceProjectHeaders } from '../../collab/workspace-identity';
import { useI18n } from '../../i18n';
import { assetInspectorCopy } from '../../i18n/locales/asset-inspector-copy';

export interface WorkflowCanvasQuestionProps {
  snapshot: WorkflowCanvasRun;
  context?: WorkspaceCollabContext | null;
  referenceAdapter?: QuestionReferenceAdapter;
}

export function WorkflowCanvasQuestion(props: WorkflowCanvasQuestionProps) {
  // A later clarification in the same run is a fresh form, not a submitted one.
  return <WorkflowCanvasQuestionStep key={`${props.snapshot.run.id}:${props.snapshot.clarification?.stepRunId ?? ''}`} {...props} />;
}

function WorkflowCanvasQuestionStep({ snapshot, context, referenceAdapter }: WorkflowCanvasQuestionProps) {
  const { locale } = useI18n();
  const copy = assetInspectorCopy(locale);
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');
  const intake = snapshot.clarification;
  const form = intake && splitOnQuestionForms(intake.content).flatMap(segment => segment.kind === 'form' ? [segment.form] : [])
    .find(form => form.id === `workflow-${snapshot.run.id}-${intake.stepRunId}`);
  if (!form || !intake) return null;
  return <div>
    <QuestionFormView form={form} referenceAdapter={referenceAdapter} interactive={!busy && !submitted} submitDisabled={busy || submitted} autoContinueAfterTimeout={false}
      onSubmit={async (_text, answers, _source, files) => {
        if (busy || submitted) return;
        if (files?.length) { setError(copy.filesFirst); return; }
        setBusy(true); setError('');
        try {
          const response = await fetch(`/api/workflow-graph-runs/${encodeURIComponent(snapshot.run.id)}/clarification`, {
            method: 'POST', headers: { 'content-type': 'application/json', ...(context ? workspaceProjectHeaders(context) : {}) },
            body: JSON.stringify({ stepRunId: intake.stepRunId, values: answers }),
          });
          const payload = await response.json();
          if (!response.ok) throw new Error(payload.error?.message || copy.submitFailed);
          setSubmitted(true);
        } catch (error) { setError(error instanceof Error ? error.message : copy.submitFailedShort); }
        finally { setBusy(false); }
      }} />
    {submitted && <p role="status">{copy.submitted}</p>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
