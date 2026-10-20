import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useNodes, useReactFlow, ViewportPortal, type Node, type NodeProps } from '@xyflow/react';
import { Button } from '@bezier/components';
import { Check, ChevronDown, ChevronUp, Layers, Package, X, AlertCircle } from 'lucide-react';
import { CanvasNodeActions } from './CanvasNodeActions';
import { CanvasGroupFrame } from './CanvasGroupFrame';
import type { WorkflowCanvasRun } from '@bezier/contracts';
import { workflowRunSteps, type WorkflowRunGroupLayout } from './workflow-run-group';
import styles from './WorkflowRunGroupNode.module.css';
import { wrg } from '../locales/workflow-run-group';

export type WorkflowRunGroupData = {
  snapshot: WorkflowCanvasRun; layout: WorkflowRunGroupLayout; syncError?: string;
  onRemove: () => void; onToggle: () => void; onArrange: () => void; onDetach: (id: string) => void; onAttach: (id: string) => void;
  onControl: (action: 'cancel' | 'recover' | 'retry', stepRunId?: string) => Promise<void>;
  stepTargets: Record<string, string[]>;
};
export function WorkflowRunGroupNode({ id, data, selected: groupSelected }: NodeProps<Node<WorkflowRunGroupData>>) {
  const { snapshot, layout } = data;
  const copy = wrg();
  const labels = copy.status;
  const nodes = useNodes();
  const { fitView } = useReactFlow();
  const steps = workflowRunSteps(snapshot);
  const active = steps.find(s => ['running', 'awaiting-input', 'waiting', 'failed'].includes(s.status));
  const [selected, setSelected] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [detailsOpen, setDetailsOpen] = useState(false);
  const rail = useRef<HTMLDivElement>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  const detailTrigger = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (!detailsOpen) return;
    detailRef.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
    const dismiss = (event: PointerEvent) => {
      if (!detailRef.current?.contains(event.target as globalThis.Node) && !detailTrigger.current?.contains(event.target as globalThis.Node)) setDetailsOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.stopPropagation(); setDetailsOpen(false); detailTrigger.current?.focus({ preventScroll: true }); }
    };
    document.addEventListener('pointerdown', dismiss, true);
    document.addEventListener('keydown', escape, true);
    return () => { document.removeEventListener('pointerdown', dismiss, true); document.removeEventListener('keydown', escape, true); };
  }, [detailsOpen]);
  const focusNewRun = useRef(Date.now() - Date.parse(snapshot.run.createdAt) < 15000);
  const measured = nodes.find(node => node.id === id)?.measured;
  useEffect(() => {
    if (!focusNewRun.current || !measured?.width || !measured.height) return;
    focusNewRun.current = false;
    void fitView({ nodes: [{ id }], padding: .18, maxZoom: 1, duration: 220 });
  }, [id, measured?.width, measured?.height, fitView]);
  const chosen = steps.find(s => s.definition.id === selected) ?? active ?? steps.at(-1);
  useEffect(() => {
    rail.current?.querySelector('[aria-current="step"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'auto' });
  }, [active?.definition.id]);
  const children = nodes.filter(node => node.parentId === id && !node.hidden);
  const width = Math.max(1100, ...children.map(node => node.position.x + (node.measured?.width ?? node.width ?? 640) + 24));
  const height = layout.collapsed ? undefined : Math.max(230, ...children.map(node => node.position.y + (node.measured?.height ?? node.height ?? 600) + 24));
  const control = async (action: 'cancel' | 'recover' | 'retry') => {
    setBusy(true); setError('');
    try { await data.onControl(action, chosen?.step?.id); }
    catch (e) { setError(e instanceof Error ? e.message : copy.actionFailed); }
    finally { setBusy(false); }
  };
  const targets = chosen ? (data.stepTargets[chosen.definition.id] ?? []).filter(id => nodes.some(n => n.id === id)) : [];
  const terminal = ['succeeded', 'failed', 'cancelled', 'terminated'].includes(snapshot.run.status);
  const completed = steps.filter(step => step.status === 'succeeded').length;
  const skipped = steps.filter(step => step.status === 'skipped').length;
  const recent = active ?? [...steps].reverse().find(step => step.status === 'succeeded');
  const artifactIds = new Set(steps.flatMap(step => step.step?.artifactRefs ?? [])
    .filter(ref => ref.startsWith('canvas-node:')).map(ref => ref.slice(12)));
  const artifacts = nodes.filter(node => artifactIds.has(node.id)).map(node => {
    const value = node.data as { node?: { title?: string }; image?: { name?: string }; title?: string };
    return { id: node.id, title: value.node?.title || value.image?.name || value.title || copy.unnamed };
  });
  const memberCount = nodes.filter(node => node.parentId === id).length;
  const notice = data.syncError || snapshot.execution.error || (active?.status === 'failed' ? active.step?.error?.message || copy.stepFailed
    : snapshot.run.status === 'awaiting-input' ? copy.needInput : undefined);
  return <CanvasGroupFrame selected={groupSelected} className={`${styles.group} ${layout.collapsed ? styles.collapsed : ''}`} style={{ width: layout.collapsed ? 720 : width, height }} data-testid="workflow-run-group" data-run-id={snapshot.run.id}>
    <CanvasNodeActions onRemove={data.onRemove} removeLabel={copy.removeGroup} />
    <div className="image-group-chrome nopan">
      <div className="image-group-label node-drag-surface" title={copy.dragGroup}>
        <Layers size={16} /><span>{snapshot.definition.title}</span><span className={styles.count}>{copy.items(memberCount)}</span>
      </div>
    </div>
    <div className={`${styles.panel} nodrag nopan nowheel`}>
      <div className={styles.toolbar}>
        <span className={styles.status} role="status" data-status={snapshot.run.status}><span className={styles.dot} />{data.syncError ? copy.syncPaused : labels[snapshot.run.status] ?? snapshot.run.status}</span>
        <span className={styles.meta}>{copy.steps(completed, steps.length)}</span>
        <div className={styles.tools}>
          <Button variant="ghost" onClick={() => { setDetailsOpen(false); data.onToggle(); }} aria-expanded={!layout.collapsed}>{layout.collapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}{layout.collapsed ? copy.expand : copy.collapse}</Button>
        </div>
      </div>
    {layout.collapsed && <div className={styles.digest} aria-label={copy.summary}>
      <div className={styles.meter} aria-label={copy.meter(completed, steps.length, skipped)}>
        {steps.map(step => <span key={step.definition.id} data-status={step.status} title={`${step.definition.title} · ${labels[step.status]}`} />)}
      </div>
      <div className={styles.current}>
        <span>{active ? copy.currentStep : recent ? copy.recentStep : copy.nextStep}</span>
        <strong>{recent?.definition.title ?? steps[0]?.definition.title ?? copy.waitingRun}</strong>
        {active && <span className={styles.currentStatus}>{labels[active.status]}</span>}
      </div>
      <div className={styles.deliveries}>
        <div className={styles.deliveryMeta}><Package size={16} /><span>{copy.deliveries(artifacts.length, memberCount, skipped)}</span></div>
        {artifacts.length > 0 && <div className={styles.artifactNames}>{artifacts.slice(0, 3).map(artifact => <span key={artifact.id} title={artifact.title}>{artifact.title}</span>)}{artifacts.length > 3 && <span>+{artifacts.length - 3}</span>}</div>}
      </div>
      {notice && <p className={styles.notice} role="status"><AlertCircle size={15} />{notice}</p>}
    </div>}
    {!layout.collapsed && <>
      <div className={`${styles.progress} nodrag nopan nowheel`} ref={rail} role="navigation" aria-label={copy.progress}>
        {steps.map((item, index) => <button key={item.definition.id} type="button" className={styles.step} data-status={item.status} aria-pressed={chosen?.definition.id === item.definition.id}
          aria-current={active?.definition.id === item.definition.id ? 'step' : undefined}
          title={copy.stepTitle(item.definition.title, labels[item.status] ?? item.status)} aria-expanded={detailsOpen && chosen?.definition.id === item.definition.id} onClick={event => { detailTrigger.current = event.currentTarget; setSelected(item.definition.id); setDetailsOpen(!detailsOpen || chosen?.definition.id !== item.definition.id); }}>
          <span className={styles.mark}>{item.status === 'succeeded' ? <Check size={13} /> : item.status === 'failed' ? <AlertCircle size={13} /> : item.status === 'skipped' ? '−' : index + 1}</span>
          <span className={styles.stepText}>{item.definition.title}<small>{labels[item.status]}</small></span>
        </button>)}
      </div>
      {detailsOpen && <ViewportPortal><div ref={detailRef} className={`${styles.detail} nodrag nopan nowheel`} style={{ left: (nodes.find(node => node.id === id)?.position.x ?? layout.x) + 24, top: (nodes.find(node => node.id === id)?.position.y ?? layout.y) + 176 }} role="region" aria-label={copy.stepDetail}>
        <Button variant="ghost" className={styles.close} aria-label={copy.closeDetail} onClick={() => setDetailsOpen(false)}><X size={16} /></Button>
        {chosen && <><strong>{chosen.definition.title} · {labels[chosen.status]}</strong>
          <p>{chosen.step?.error?.message || (chosen.status === 'skipped' ? copy.skippedBranch : chosen.definition.instruction || copy.viewInputs)}</p>
          {chosen.step?.inputSnapshot?.upstream.length ? <p>{copy.inputsFrom}{chosen.step.inputSnapshot.upstream.map(s => s.title).join(copy.inputsFrom.endsWith('：') ? '、' : ', ')}</p> : null}
          {chosen.step?.output !== undefined && <details><summary>{copy.viewOutput}</summary><pre className={styles.output}>{typeof chosen.step.output === 'string' ? chosen.step.output : JSON.stringify(chosen.step.output, null, 2)}</pre></details>}
          {chosen.step?.selectedRoute && <p>{copy.routeTaken}{chosen.step.selectedRoute.routeId}</p>}
        </>}
        <div className={styles.actions}>
          {targets.map((target, index) => <span key={target}><Button variant="ghost" onClick={() => void fitView({ nodes: [{ id: target }], padding: .3, maxZoom: 1, duration: 200 })}>{copy.locate(index + 1, targets.length > 1)}</Button>{nodes.some(node => node.id === target && node.parentId === id && node.type !== 'workflowQuestion') && <Button variant="ghost" onClick={() => data.onDetach(target)}>{copy.detach}</Button>}{layout.detached?.includes(target) && <Button variant="ghost" onClick={() => data.onAttach(target)}>{copy.attach}</Button>}</span>)}
          {!terminal && <Button variant="ghost" disabled={busy} onClick={() => void control('cancel')}>{copy.stop}</Button>}
          {snapshot.execution.error && <Button variant="ghost" disabled={busy} onClick={() => void control('recover')}>{copy.recover}</Button>}
          {chosen?.status === 'failed' && <Button variant="ghost" disabled={busy} onClick={() => void control('retry')}>{chosen.definition.metadata?.nodeKind === 'delivery' ? copy.retrySave : copy.retryStep}</Button>}
        </div>
        {(error || data.syncError || snapshot.execution.error) && <p className={styles.error} role="alert">{error || data.syncError || snapshot.execution.error}</p>}
      </div></ViewportPortal>}
    </>}
    </div>
  </CanvasGroupFrame>;
}
export function WorkflowQuestionNode({ data }: NodeProps<Node<{ content: ReactNode }>>) {
  return <div className={`${styles.question} nodrag nopan nowheel`}>{data.content}</div>;
}
