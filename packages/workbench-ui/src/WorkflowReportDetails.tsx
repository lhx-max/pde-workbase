'use client';

import { bindWorkflowLocale, wu } from './locales/workflow-ui';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button, Dialog, Input, Textarea } from '@bezier/components';
import { parseWorkflowReport, type WorkflowReport } from '@bezier/contracts';
import styles from './WorkflowReportDetails.module.css';

/** Selection and persistence belong to the workflow; this component owns only an edit draft. */
export function WorkflowReportDetails({ title, value, placement = 'center', onSave, onEditingChange, disabled = false }: {
  title: string; value: unknown; placement?: 'center' | 'right';
  onSave?: (report: WorkflowReport) => Promise<void>; disabled?: boolean;
  onEditingChange?: (editing: boolean) => void;
}) {
  bindWorkflowLocale();
  const parsed = parseWorkflowReport(value);
  // Preserve any text saved during the previous editor iteration as an editable section.
  const report: WorkflowReport | null = parsed?.document !== undefined
    ? (({ document, ...rest }) => ({ ...rest, sections: [{ title: wu().me55bcc90, body: document }] }))(parsed as WorkflowReport & { document: string })
    : parsed;
  const hasReport = report !== null;
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<WorkflowReport | null>(null);
  const [activeField, setActiveField] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const draftRef = useRef<WorkflowReport | null>(null);
  const baseline = useRef('');
  const pendingSave = useRef<Promise<boolean> | null>(null);
  const [committed, setCommitted] = useState<WorkflowReport | null>(null);
  const reportSignature = JSON.stringify(report);
  useEffect(() => { setCommitted(null); }, [reportSignature]);
  const body = useRef<HTMLDivElement>(null);
  const preview = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (placement !== 'right') return;
    setAnchor(preview.current?.closest<HTMLElement>('.workflow-stage-card') ?? preview.current);
  }, [placement]);
  useEffect(() => {
    if (!open || !hasReport) return;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    if (placement === 'center') document.body.style.overflow = 'hidden';
    body.current?.querySelector<HTMLButtonElement>('button')?.focus();
    return () => {
      if (placement === 'center') document.body.style.overflow = overflow;
      if (previous?.isConnected) previous.focus();
    };
  }, [open, hasReport, placement, anchor]);
  if (!report) return null;
  const current = draft ?? committed ?? report;
  const editing = draft !== null;
  const change = (update: (next: WorkflowReport) => void) => {
    const next = structuredClone(draftRef.current ?? current);
    update(next); draftRef.current = next; setDraft(next); onEditingChange?.(true);
  };
  const save = (): Promise<boolean> => {
    if (pendingSave.current) return pendingSave.current;
    const snapshot = draftRef.current;
    if (!snapshot) return Promise.resolve(true);
    if (JSON.stringify(snapshot) === baseline.current) {
      draftRef.current = null; setDraft(null); onEditingChange?.(false);
      return Promise.resolve(true);
    }
    if (!onSave || disabled) return Promise.resolve(false);
    setSaving(true); setMessage('');
    const request = Promise.resolve().then(() => onSave(snapshot)).then(() => {
      setCommitted(snapshot); draftRef.current = null; setDraft(null);
      onEditingChange?.(false); return true;
    }).catch((error: unknown) => {
      setMessage(error instanceof Error ? error.message : wu().m18b4e26f); return false;
    }).finally(() => { pendingSave.current = null; setSaving(false); });
    pendingSave.current = request;
    return request;
  };
  const blur = () => { setActiveField(''); void save(); };
  const field = (label: string, text: string, update: (next: WorkflowReport, value: string) => void, multiline = false) => activeField === label && onSave
    ? multiline
      ? <Textarea autoFocus aria-label={label} value={text} disabled={saving || disabled} onBlur={blur} onChange={event => change(next => update(next, event.target.value))} />
      : <Input autoFocus aria-label={label} value={text} disabled={saving || disabled} onBlur={blur} onChange={event => change(next => update(next, event.target.value))} />
    : onSave ? <Button variant="ghost" className={styles.editableValue} aria-label={wu().ma7f814c0 + label} disabled={saving || disabled} onClick={() => {
      if (pendingSave.current) return;
      if (!draftRef.current) { baseline.current = JSON.stringify(current); draftRef.current = structuredClone(current); setDraft(draftRef.current); onEditingChange?.(true); }
      setActiveField(label); setMessage('');
    }}>{text || wu().m616e82c7}</Button> : <span className={styles.fieldValue}>{text || wu().m616e82c7}</span>;
  const close = () => {
    setActiveField('');
    if (!draftRef.current && !pendingSave.current) setOpen(false);
    else void save().then(saved => { if (saved) setOpen(false); });
  };
  const details = <div ref={body} className={styles.layout} onKeyDown={event => {
    if (placement === 'right') return;
    if (event.key !== 'Tab') return;
    const nodes = body.current?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input, textarea, [tabindex="0"]');
    if (!nodes?.length) return;
    const first = nodes[0]; const last = nodes[nodes.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }}>
    <header className={styles.header}>
      <div><h2>{title}</h2></div>
      <div className={styles.controls}>
        {saving && <span className={styles.saveStatus} role="status">{wu().m9ca32f98}</span>}
        {message && <><span className={styles.saveStatus} role="alert">{message}</span><Button variant="ghost" onClick={() => void save()}>{wu().me2d53a6d}</Button></>}
        <Button variant="ghost" className={styles.closeButton} aria-label={wu().mefa5b01f} onClick={close}><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="m6 6 12 12M18 6 6 18" /></svg></Button>
      </div>
    </header>
    <div className={styles.content} tabIndex={0}>
      <section className={styles.section}><h3>{wu().m9fb1ae33}</h3><dl className={styles.facts}>{current.facts.map((fact, index) => <div key={index}><dt>{fact.label}</dt><dd>{field(fact.label, fact.value, (next, text) => { next.facts[index]!.value = text; })}</dd></div>)}</dl></section>
      {current.sections.map((section, index) => <section className={styles.section} key={index}><h3>{section.title}</h3>
        {(section.body || editing) && <div className={styles.prose}>{field(section.title + wu().m26670dda, section.body, (next, text) => { next.sections[index]!.body = text; }, true)}</div>}
        {section.fields && <dl className={styles.sectionFields}>{section.fields.map((entry, i) => <div key={i}><dt>{entry.label}</dt><dd>{field(entry.label, entry.value, (next, text) => { next.sections[index]!.fields![i]!.value = text; }, true)}</dd></div>)}</dl>}
      </section>)}
      {onSave && current.sections.length < 40 && <Button disabled={saving || disabled} onClick={() => {
        if (pendingSave.current) return;
        if (!draftRef.current) baseline.current = JSON.stringify(current);
        change(next => { next.sections.push({ title: wu().m6614801d, body: '' }); });
        setActiveField(wu().mb245a18a);
      }}>{wu().m6f528060}</Button>}
      {current.comparison && <section className={styles.section}><h3>{current.comparison.title || wu().md717d735}</h3><div className={styles.tableScroll} tabIndex={0} aria-label={wu().m822b0a03}><table><thead><tr>{current.comparison.columns.map((column, i) => <th key={i} scope="col">{column}</th>)}</tr></thead><tbody>{current.comparison.rows.map((row, i) => <tr key={i}>{row.map((cell, j) => j === 0 ? <th key={j} scope="row">{cell}</th> : <td key={j}>{field(row[0] + ' · ' + current.comparison!.columns[j], cell, (next, text) => { next.comparison!.rows[i]![j] = text; }, true)}</td>)}</tr>)}</tbody></table></div></section>}
    </div>
  </div>;
  return <div ref={preview} className={styles.preview} onClick={event => {
    if (open || (event.target as HTMLElement).closest('button, a')) event.stopPropagation();
  }} onKeyDown={event => { if (!open) event.stopPropagation(); }}>
    <dl className={styles.facts}>{(committed ?? report).facts.slice(0, 3).map((fact, index) => <div key={index}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}</dl>
    <div className={styles.previewFooter}><Button variant="ghost" onClick={() => setOpen(true)}>{placement === 'right' ? wu().mb8053995 : wu().m8d458d6e} <span aria-hidden="true">↗</span></Button></div>
    {open && (placement === 'right' ? anchor && createPortal(
      <div className={`${styles.cardPanel} nodrag nopan nowheel`} role="dialog" aria-label={title + wu().m5353a552}
        onPointerDown={event => event.stopPropagation()} onWheel={event => event.stopPropagation()}
        onKeyDown={event => { event.stopPropagation(); if (event.key === 'Escape') { event.preventDefault(); close(); } }}>
        {details}
      </div>, anchor)
      : createPortal(<Dialog className={styles.dialog} ariaLabel={title + wu().m5353a552} onClose={close} closeOnEscape>{details}</Dialog>, document.body))}
  </div>;
}
