import React from 'react';
import { Button } from '@bezier/components';
import { Icon } from './Icon';
import { wu } from './locales/workflow-ui';
import styles from './WorkflowInputSummary.module.css';

export interface WorkflowInputSummarySource { id: string; title: string; kind: string; step?: number; route?: string }

const sourceLabel = (source: WorkflowInputSummarySource) => `${source.step ? `${source.step} ` : ''}${source.title}`;

/** Draft-time source navigation; actual values belong to the runtime input view. */
export function WorkflowInputSummary({ sources, onLocate, candidates = [], references = [], onChange }: {
  candidates?: WorkflowInputSummarySource[];
  references?: string[];
  onChange?: (ids: string[]) => void;
  sources: WorkflowInputSummarySource[];
  onLocate?: (nodeId: string) => void;
}) {
  const copy = wu();
  const [open, setOpen] = React.useState(false);
  const root = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', close, true);
    return () => document.removeEventListener('pointerdown', close, true);
  }, [open]);
  return <div ref={root} onKeyDown={event => { if (event.key === 'Escape') { setOpen(false); event.stopPropagation(); } }} className={`${styles.root} nodrag nopan nowheel`} onClick={event => event.stopPropagation()} onPointerDown={event => event.stopPropagation()} onWheel={event => event.stopPropagation()}>
    <span className={styles.label}>{copy.inputSources}</span>
    <div className={styles.sources}>
      {sources.length ? sources.map(source => <Button
        key={`${source.id}:${source.route ?? ''}`}
        type="button"
        variant="ghost"
        className={styles.source}
        disabled={!onLocate}
        title={copy.locateTitle(sourceLabel(source), source.route)}
        aria-label={copy.locateInput(sourceLabel(source), source.route)}
        onClick={() => onLocate?.(source.id)}
      ><small>{source.step}</small><span>{source.title}</span>{source.route && <small>{source.route}</small>}</Button>) : <span className={styles.empty}>{copy.notConnected}</span>}
      {references.map(id => {
        const source = candidates.find(item => item.id === id) ?? sources.find(item => item.id === id);
        const label = source ? sourceLabel(source) : copy.sourceDisconnected;
        return <span key={id} className={styles.reference}>
          <Button type="button" variant="ghost" className={styles.source} title={copy.locateTitle(label)} aria-label={copy.locateReference(label)} onClick={() => onLocate?.(id)}><small>{source?.step}</small><span>{source?.title ?? label}</span></Button>
          <Button type="button" variant="ghost" className={styles.remove} aria-label={copy.removeReference(label)} onClick={() => onChange?.(references.filter(item => item !== id))}><Icon name="close" size={12}/></Button>
        </span>;
      })}
    </div>
    <div className={styles.picker}>
      <Button type="button" variant="ghost" className={styles.add} aria-label={copy.addInputSource} aria-expanded={open} onClick={() => setOpen(value => !value)}><Icon name="plus" size={14}/></Button>
      {open && <div className={styles.menu} role="group" aria-label={copy.chooseInputSource}>
        <div className={styles.heading}>{copy.citeUpstream}</div>
        {candidates.filter(item => !references.includes(item.id)).map(item => <Button type="button" variant="ghost" key={item.id} className={styles.option} onClick={() => { onChange?.([...references, item.id]); setOpen(false); }} aria-label={copy.addReference(sourceLabel(item))}><small>{item.step}</small><span>{item.title}</span></Button>)}
        {!candidates.some(item => !references.includes(item.id)) && <span className={styles.empty}>{copy.noUpstreamCards}</span>}
      </div>}
    </div>
  </div>;
}
