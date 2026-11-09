'use client';

import { bindWorkflowLocale, wu } from './locales/workflow-ui';

import React from 'react';
import { Handle, Position } from '@xyflow/react';
import type {
  JsonValue,
  ResultRenderer,
  WorkflowResultActionDefinition,
  WorkflowResultArtifact,
  WorkflowResultItem,
  WorkflowResultSyncDetail,
} from '@bezier/contracts';
import { WORKFLOW_RESULT_SYNC_EVENT, parseWorkflowReport, type WorkflowReport } from '@bezier/contracts';
import { WorkflowReportDetails } from './WorkflowReportDetails';

export type WorkflowStageInteraction = {
  surface?: 'canvas';
  actionId: string;
  selectedIds: string[];
  feedback: string;
  /** 编辑类动作：被改的单项 id。 */
  itemId?: string;
  /** 编辑类动作：卡面字段名 → 新值。字段名由 rendererConfig 决定（即流程 MD）。 */
  patch?: Record<string, string>;
};

export type WorkflowStageCardProps = {
  connectedSourceHandles?: readonly string[];
  artifact: WorkflowResultArtifact;
  busy?: boolean;
  /** 供画布节点监听真实尺寸，并在子卡换行后重算 React Flow 锚点。 */
  rootRef?: React.Ref<HTMLElement>;
  /**
   * 宿主注入的本轮评测结果。
   *
   * 不放进 artifact 是因为 artifact 是「结果快照」，评测是异步补写上来的旁路数据，
   * 两者的刷新节奏不同（artifact 版本递增才更新，评测每 2s 轮询就可能变）。
   */
  evaluation?: React.ReactNode;
  onInteract: (interaction: WorkflowStageInteraction) => Promise<void>;
};

type RendererProps = {
  connectedSourceHandles?: readonly string[];
  onReportSave?: (itemId: string, report: WorkflowReport) => Promise<void>;
  onReportEditingChange?: (itemId: string, editing: boolean) => void;
  artifact: WorkflowResultArtifact;
  selectedIds: string[];
  disabled: boolean;
  toggle: (id: string) => void;
  /** 编辑能力（capability 'edit'）开启时才非空；关闭时渲染器完全看不到编辑入口。 */
  edit?: {
    /** 当前处于编辑态的单项 id，空串表示无。 */
    activeId: string;
    /** 编辑态下的字段草稿。 */
    draft: Record<string, string>;
    onStart: (itemId: string, draft: Record<string, string>) => void;
    onChange: (key: string, value: string) => void;
    onCancel: () => void;
    onSave: () => void;
    saveLabel: string;
  };
};

type WorkflowStageRenderer = (props: RendererProps) => React.ReactNode;

/** Stable React Flow handle id for an individual result item. */
export function workflowResultItemHandleId(itemId: string): string {
  return `result-item:${encodeURIComponent(itemId)}`;
}

function jsonText(value: JsonValue | undefined): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  return JSON.stringify(value, null, 2);
}

function recordValue(value: JsonValue | undefined): Record<string, JsonValue> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : {};
}

/**
 * The daemon normalises new artifacts to `item.summary`, but cards already
 * persisted before that change may still keep their body in `data.content`.
 * Resolve both shapes here so the canvas and chat projection show the same
 * title + body while old runs remain readable.
 */
function itemSummary(item: WorkflowResultItem, data: Record<string, JsonValue>): string {
  if (typeof item.summary === 'string' && item.summary.trim()) return item.summary.trim();
  for (const key of ['summary', 'content', 'description', 'body']) {
    const value = data[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function rendererFields(artifact: WorkflowResultArtifact): Array<{ key: string; label: string }> {
  const fields = artifact.rendererConfig?.fields;
  if (!Array.isArray(fields)) return [];
  return fields.flatMap((field) => {
    const value = recordValue(field);
    return typeof value.key === 'string' && typeof value.label === 'string'
      ? [{ key: value.key, label: value.label }]
      : [];
  });
}

const structuredRenderer: WorkflowStageRenderer = ({
  connectedSourceHandles = [],
  artifact,
  selectedIds,
  disabled,
  toggle,
  edit,
  onReportSave,
  onReportEditingChange,
}) => {
  const fields = rendererFields(artifact);
  const titleField = typeof artifact.rendererConfig?.titleField === 'string'
    ? artifact.rendererConfig.titleField
    : 'title';
  const summaryField = typeof artifact.rendererConfig?.summaryField === 'string'
    ? artifact.rendererConfig.summaryField
    : 'summary';
  const badgeField = typeof artifact.rendererConfig?.badgeField === 'string'
    ? artifact.rendererConfig.badgeField
    : '';
  if (artifact.items?.length) {
    return (
      <div className="process-result-items">
        {artifact.items.map((item, index) => {
          const data = recordValue(item.data);
          const summary = itemSummary(item, data);
          const badge = badgeField && typeof data[badgeField] === 'string'
            ? data[badgeField]
            : '';
          const selectable = artifact.capabilities.includes('select')
            && artifact.selection?.mode !== 'none';
          const selected = selectedIds.includes(item.id);
          const editing = edit?.activeId === item.id;
          // 编辑草稿的字段集合就是卡面展示的字段集合：标题 + 摘要 + 明细字段。
          // 后端只接受这些 key（displayFieldKeys 白名单），前后端同一份口径。
          const editableFields = [
            { key: titleField, label: wu().m748d7dc7 },
            { key: summaryField, label: wu().m46d4c1b4 },
            ...fields,
          ].filter((entry, position, all) => (
            entry.key && all.findIndex((other) => other.key === entry.key) === position
          ));
          return (
            <article
              key={item.id}
              className={[
                'process-result-item',
                selectable ? 'is-selectable' : '',
                selected ? 'is-selected' : '',
              ].filter(Boolean).join(' ')}
              role={selectable ? 'button' : undefined}
              tabIndex={selectable && !disabled ? 0 : undefined}
              aria-pressed={selectable ? selected : undefined}
              aria-disabled={selectable ? disabled : undefined}
              onClick={selectable ? (event) => {
                if (disabled || (event.target as HTMLElement).closest('button, input, textarea, select, a, .react-flow__handle')) return;
                toggle(item.id);
              } : undefined}
              onKeyDown={selectable ? (event) => {
                if (disabled || event.target !== event.currentTarget) return;
                if (event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault();
                toggle(item.id);
              } : undefined}
            >
              {!selectable && (
                <span className="process-result-item-ordinal" aria-hidden="true">{index + 1}</span>
              )}
              <div className="process-result-item-main">
                <div className="process-result-item-content">
                  {editing && edit ? (
                    <div className="workflow-stage-edit nodrag nopan">
                      {editableFields.map((field) => (
                        <label key={field.key}>
                          <span>{field.label}</span>
                          <textarea
                            value={edit.draft[field.key] ?? ''}
                            onChange={(event) => edit.onChange(field.key, event.target.value)}
                          />
                        </label>
                      ))}
                    </div>
                  ) : (
                    <>
                      <header className="process-result-item-head">
                        <strong className="process-result-item-title">{item.title}</strong>
                        {badge && <span className="process-result-item-badge">{badge}</span>}
                      </header>
                      {summary && <p className="process-result-item-summary">{summary}</p>}
                      <WorkflowReportDetails title={item.title} value={data.report} placement="right" disabled={disabled}
                        onEditingChange={editing => onReportEditingChange?.(item.id, editing)}
                        {...(onReportSave ? { onSave: (report: WorkflowReport) => onReportSave(item.id, report) } : {})} />
                      {fields.length > 0 && (
                        <dl className="workflow-stage-fields">
                          {fields.flatMap((field) => {
                            const value = data[field.key];
                            if (typeof value !== 'string' || !value.trim()) return [];
                            return (
                              <div key={field.key}>
                                <dt>{field.label}</dt>
                                <dd>{value}</dd>
                              </div>
                            );
                          })}
                        </dl>
                      )}
                    </>
                  )}
                </div>
                {/* 操作区在正文下方，与 ProcessResultCard 保持同一套结构 */}
                {edit && (
                  <div className="process-result-item-decide nodrag nopan">
                    {edit && !editing && (
                      <button
                        type="button"
                        className="process-result-action is-quiet-pill"
                        disabled={disabled}
                        onClick={() => edit.onStart(
                          item.id,
                          Object.fromEntries(editableFields.map((field) => [
                            field.key,
                            typeof data[field.key] === 'string' ? data[field.key] as string : '',
                          ])),
                        )}
                      >
                        {wu().ma7f814c0}</button>
                    )}
                    {edit && editing && (
                      <>
                        <button
                          type="button"
                          className="process-result-action is-primary"
                          disabled={disabled}
                          onClick={edit.onSave}
                        >
                          {edit.saveLabel}
                        </button>
                        <button
                          type="button"
                          className="process-result-action is-quiet-pill"
                          disabled={disabled}
                          onClick={edit.onCancel}
                        >
                          {wu().m4d0b4688}</button>
                      </>
                    )}
                  </div>
                )}
              </div>
              <Handle
                type="source"
                position={Position.Right}
                id={workflowResultItemHandleId(item.id)}
                className={`workflow-result-item-handle nodrag nopan${connectedSourceHandles.includes(workflowResultItemHandleId(item.id)) ? ' is-connected' : ''}`}
                aria-label={wu().connectFromItem(item.title)}
                title={wu().connectFromItem(item.title)}
              />
            </article>
          );
        })}
      </div>
    );
  }
  const text = jsonText(artifact.value);
  return text ? <pre className="workflow-stage-value">{text}</pre> : null;
};

const documentRenderer: WorkflowStageRenderer = ({ artifact }) => {
  const value = recordValue(artifact.value);
  const content = typeof artifact.value === 'string'
    ? artifact.value
    : typeof value.content === 'string'
      ? value.content
      : jsonText(artifact.value);
  return <div className="workflow-stage-document">{content}</div>;
};

const rendererRegistry = new Map<ResultRenderer, WorkflowStageRenderer>([
  ['structured', structuredRenderer],
  ['document', documentRenderer],
  ['code', documentRenderer],
]);

export function registerWorkflowStageRenderer(
  renderer: ResultRenderer,
  component: WorkflowStageRenderer,
): () => void {
  const previous = rendererRegistry.get(renderer);
  rendererRegistry.set(renderer, component);
  return () => {
    if (previous) rendererRegistry.set(renderer, previous);
    else rendererRegistry.delete(renderer);
  };
}

function actionAvailable(
  action: WorkflowResultActionDefinition,
  selectedCount: number,
  feedback: string,
): boolean {
  if (action.when?.minSelection !== undefined && selectedCount < action.when.minSelection) return false;
  if (action.when?.maxSelection !== undefined && selectedCount > action.when.maxSelection) return false;
  if (action.when?.feedback === 'present' && !feedback) return false;
  if (action.when?.feedback === 'empty' && feedback) return false;
  return true;
}

function actionLabel(
  action: WorkflowResultActionDefinition,
  selectedCount: number,
  active: boolean,
): string {
  if (active && action.busyLabel) return action.busyLabel;
  if (action.capability !== 'regenerate') return action.label;
  if (selectedCount === 0) return wu().m2d41d453;
  if (selectedCount === 1) return wu().me35c2803;
  return wu().regenerateCount(selectedCount);
}

export function WorkflowStageCard({
  connectedSourceHandles = [],
  artifact,
  busy = false,
  evaluation,
  onInteract,
  rootRef,
  locale,
}: WorkflowStageCardProps & { locale?: string | null }) {
  bindWorkflowLocale(locale);
  const [selectedIds, setSelectedIds] = React.useState<string[]>(artifact.selectedIds ?? []);
  const [feedback, setFeedback] = React.useState(artifact.feedbackValue ?? '');
  const [activeAction, setActiveAction] = React.useState('');
  const [actionError, setActionError] = React.useState('');
  const [editingId, setEditingId] = React.useState('');
  const [draft, setDraft] = React.useState<Record<string, string>>({});
  const [reportEdits, setReportEdits] = React.useState<string[]>([]);
  const hasReports = artifact.items?.some(item => parseWorkflowReport(recordValue(item.data).report));
  const adopted = (artifact.selectedIds?.length ?? 0) > 0;
  const disabled = busy || Boolean(activeAction);
  const Renderer = rendererRegistry.get(artifact.renderer) ?? structuredRenderer;
  /*
   * 按 capability 把动作分成三类，因为它们在卡面上的位置不同：
   *   - evaluate  → 评测条（正文之后、反馈框之前）
   *   - edit      → 单项内的编辑按钮，由渲染器负责
   *   - 其余       → 卡片底部的推进按钮区
   * 分组依据是 capability 而不是 action id，这样新增业务的 action 命名自由。
   */
  const editAction = artifact.actions.find((action) => action.capability === 'edit' && action.id !== 'edit-report');
  const reportEditAction = artifact.actions.find(action => action.id === 'edit-report' && action.capability === 'edit');
  const evaluateAction = artifact.actions.find((action) => action.capability === 'evaluate');
  const footerActions = artifact.actions.filter((action) => (
    action.capability !== 'edit' && action.capability !== 'evaluate'
  ));

  React.useEffect(() => {
    setSelectedIds(artifact.selectedIds ?? []);
    setFeedback(artifact.feedbackValue ?? '');
  }, [artifact.id, artifact.version, artifact.selectedIds, artifact.feedbackValue]);

  React.useEffect(() => {
    const receiveDraft = (event: Event) => {
      const detail = (event as CustomEvent<WorkflowResultSyncDetail>).detail;
      if (
        !detail
        || detail.phase !== 'draft'
        || detail.source === 'canvas'
        || detail.projectId !== artifact.projectId
        || detail.resultId !== artifact.id
      ) return;
      setSelectedIds(detail.selectedIds ?? []);
      setFeedback(detail.feedback ?? '');
    };
    window.addEventListener(WORKFLOW_RESULT_SYNC_EVENT, receiveDraft);
    return () => window.removeEventListener(WORKFLOW_RESULT_SYNC_EVENT, receiveDraft);
  }, [artifact.id, artifact.projectId]);

  React.useEffect(() => {
    // 新版本落盘意味着内容已经变了，编辑草稿不能继续套在旧字段上。
    setEditingId('');
    setDraft({});
  }, [artifact.id, artifact.version]);

  const toggle = (id: string) => {
    const next = selectedIds.includes(id)
      ? selectedIds.filter((item) => item !== id)
      : artifact.selection?.mode !== 'multiple'
        ? [id]
        : artifact.selection.max !== undefined && selectedIds.length >= artifact.selection.max
          ? selectedIds
          : [...selectedIds, id];
    setSelectedIds(next);
    window.dispatchEvent(new CustomEvent<WorkflowResultSyncDetail>(WORKFLOW_RESULT_SYNC_EVENT, {
      detail: {
        projectId: artifact.projectId,
        resultId: artifact.id,
        source: 'canvas',
        phase: 'draft',
        selectedIds: next,
        feedback,
      },
    }));
  };
  const submit = async (action: WorkflowResultActionDefinition) => {
    if (disabled || reportEdits.length > 0 || !actionAvailable(action, selectedIds.length, feedback.trim())) return;
    setActiveAction(action.id);
    setActionError('');
    try {
      await onInteract({
        surface: 'canvas',
        actionId: action.id,
        selectedIds,
        feedback: feedback.trim(),
      });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : wu().m51d3cb57);
    } finally {
      setActiveAction('');
    }
  };
  const saveEdit = async () => {
    if (!editAction || !editingId || disabled) return;
    setActiveAction(editAction.id);
    try {
      await onInteract({
        surface: 'canvas',
        actionId: editAction.id,
        // 编辑不改选择状态：把当前勾选原样带回去，避免服务端把 selectedIds 清空。
        selectedIds,
        feedback: '',
        itemId: editingId,
        patch: draft,
      });
      setEditingId('');
      setDraft({});
    } finally {
      setActiveAction('');
    }
  };

  return (
    <article ref={rootRef} className={`bezier-workflow-result canvas-node process-result-card workflow-stage-card status-review${hasReports ? ' has-reports' : ''}`}>
      <Handle type="target" position={Position.Left} className="node-handle" />
      <Handle
        type="source"
        position={Position.Right}
        className="node-handle workflow-result-group-handle"
        aria-label={wu().m57be70e1}
        title={wu().m86efa2ea}
      />
      <div className="node-inner">
        <div className="node-drag-surface">
          <div className="node-title-row">
            <h2>{artifact.title}</h2>
            {hasReports && <span className="process-result-meta">{wu().planSelection(artifact.items?.length ?? 0, selectedIds.length)}</span>}
            {adopted && <span className="process-result-meta">{wu().m0f1c942d}</span>}
          </div>
        </div>
        <div className="process-result-rounds nodrag nopan">
          <section className="process-result-round">
            <Renderer
              connectedSourceHandles={connectedSourceHandles}
              artifact={artifact}
              selectedIds={selectedIds}
              disabled={disabled}
              toggle={toggle}
              onReportEditingChange={(itemId, editing) => setReportEdits(current => editing ? [...new Set([...current, itemId])] : current.filter(id => id !== itemId))}
              {...(reportEditAction ? { onReportSave: async (itemId: string, report: WorkflowReport) => {
                await onInteract({ surface: 'canvas', actionId: reportEditAction.id, selectedIds, feedback, itemId, patch: { report: JSON.stringify(report) } });
              } } : {})}
              {...(editAction
                ? {
                    edit: {
                      activeId: editingId,
                      draft,
                      onStart: (itemId: string, initial: Record<string, string>) => {
                        setEditingId(itemId);
                        setDraft(initial);
                      },
                      onChange: (key: string, value: string) => {
                        setDraft((current) => ({ ...current, [key]: value }));
                      },
                      onCancel: () => { setEditingId(''); setDraft({}); },
                      onSave: () => { void saveEdit(); },
                      saveLabel: activeAction === editAction.id && editAction.busyLabel
                        ? editAction.busyLabel
                        : editAction.label,
                    },
                  }
                : {})}
            />
            {/* 评测条紧跟内容轮次，与 ProcessResultCard 的位置一致 */}
            {evaluateAction && evaluation}
          </section>
        </div>
        {artifact.feedback && artifact.capabilities.includes('comment') && (
          <label className="workflow-stage-feedback nodrag nopan">
            <span>{artifact.feedback.label}</span>
            <textarea
              value={feedback}
              required={artifact.feedback.required}
              disabled={disabled}
              placeholder={artifact.feedback.placeholder}
              onChange={(event) => {
                const next = event.target.value;
                setFeedback(next);
                window.dispatchEvent(new CustomEvent<WorkflowResultSyncDetail>(WORKFLOW_RESULT_SYNC_EVENT, {
                  detail: {
                    projectId: artifact.projectId,
                    resultId: artifact.id,
                    source: 'canvas',
                    phase: 'draft',
                    selectedIds,
                    feedback: next,
                  },
                }));
              }}
            />
          </label>
        )}
        {footerActions.length > 0 && (
          <div className="workflow-stage-actions nodrag nopan">
            {footerActions.map((action) => (
              <button
                key={action.id}
                type="button"
                className={`process-result-action ${action.capability === 'regenerate' ? 'is-secondary' : 'is-primary'}`}
                disabled={disabled || reportEdits.length > 0 || !actionAvailable(action, selectedIds.length, feedback.trim())}
                onClick={() => void submit(action)}
              >
                {actionLabel(action, selectedIds.length, activeAction === action.id)}
              </button>
            ))}
          </div>
        )}
        {actionError && <p role="alert" className="workflow-stage-feedback">{actionError}</p>}
      </div>
    </article>
  );
}
