'use client';

import { useEffect, useRef, useState } from 'react';
import { ASSISTANT_EXAMPLES, describeCommand, parseCommand, planIntents } from './assistant';
import type { AssistantContext, AssistantIntent, AssistantPlan, CommandIntent } from './assistant';
import styles from './workbench.module.css';

type Data = Record<string, unknown>;
export interface AssistantHost {
  context: AssistantContext;
  read: () => Data;
  /** 一次提交计划里的数据修改；失败时返回原因。 */
  apply: (plan: AssistantPlan) => { ok: true; message?: string } | { ok: false; message: string };
  run: (command: CommandIntent) => Promise<string> | string;
  undo: () => void;
  disabled: boolean;
  /** 修改排布后是否会自动重新贴合视频。 */
  autoFit: boolean;
}
type ProposalState = 'pending' | 'applied' | 'cancelled' | 'undone';
type UserMessage = { id: number; role: 'user'; text: string };
type AssistantMessage = { id: number; role: 'assistant'; text: string; lines?: string[]; notes?: string[]; intents?: AssistantIntent[]; state?: ProposalState; result?: string[] };
type Message = UserMessage | AssistantMessage;

const SUGGESTIONS = ['贴合视频', '补齐配音', '检查问题'] as const;
const WELCOME: AssistantMessage = { id: 0, role: 'assistant', text: '说说想怎么改，我会先列出改动，确认后再应用，随时可以撤销。', lines: [...ASSISTANT_EXAMPLES] };

/** 左侧配音助手：自然语言转成卡内编辑，先列出改动，确认后一次应用。 */
export function AssistantPanel({ host }: { host: AssistantHost }) {
  const [messages, setMessages] = useState<Message[]>([WELCOME]);
  const [draft, setDraft] = useState('');
  const [running, setRunning] = useState(false);
  const nextId = useRef(1);
  const log = useRef<HTMLDivElement>(null);
  const hostRef = useRef(host);
  hostRef.current = host;
  useEffect(() => {
    const element = log.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [messages]);

  const pushUser = (text: string) => setMessages(list => [...list, { id: nextId.current++, role: 'user', text }]);
  const pushAssistant = (message: Omit<AssistantMessage, 'id' | 'role'>) =>
    setMessages(list => [...list, { ...message, id: nextId.current++, role: 'assistant' }]);
  const update = (id: number, changes: Partial<AssistantMessage>) =>
    setMessages(list => list.map(item => item.id === id && item.role === 'assistant' ? { ...item, ...changes } : item));

  async function runCommands(commands: CommandIntent[]) {
    const results: string[] = [];
    for (const command of commands) {
      try { results.push(await hostRef.current.run(command)); }
      catch (error) { results.push(error instanceof Error ? error.message : `${describeCommand(command, hostRef.current.context)}失败`); }
    }
    return results.filter(Boolean);
  }

  async function send(text: string) {
    const input = text.trim();
    if (!input || running) return;
    setDraft('');
    pushUser(input);
    const { context, read } = hostRef.current;
    const parsed = parseCommand(input, context);
    if ('error' in parsed) { pushAssistant({ text: parsed.error }); return; }
    const plan = planIntents(read(), parsed.intents, context);
    if (plan.steps.length) {
      pushAssistant({ text: '准备这样改：', lines: proposalLines(plan, context, hostRef.current.autoFit), notes: plan.notes, intents: parsed.intents, state: 'pending' });
      return;
    }
    if (!plan.commands.length) { pushAssistant({ text: plan.notes.join(' ') || '没有需要修改的内容。' }); return; }
    setRunning(true);
    try {
      const results = await runCommands(plan.commands);
      pushAssistant({ text: results.join('\n') || '已完成。', notes: plan.notes });
    } finally { setRunning(false); }
  }

  async function apply(message: AssistantMessage) {
    if (!message.intents || running) return;
    const { context, read, apply: commit } = hostRef.current;
    // 以应用时的最新内容重新换算，避免覆盖期间的其他修改。
    const plan = planIntents(read(), message.intents, context);
    if (!plan.steps.length) { update(message.id, { state: 'cancelled', result: plan.notes.length ? plan.notes : ['内容已变化，没有可应用的修改。'] }); return; }
    const outcome = commit(plan);
    if (!outcome.ok) { update(message.id, { result: [outcome.message] }); return; }
    const done = (results: string[]) => update(message.id, { state: 'applied', result: [outcome.message, ...results].filter((item): item is string => Boolean(item)) });
    if (!plan.commands.length) { done([]); return; }
    setRunning(true);
    try { done(await runCommands(plan.commands)); }
    finally { setRunning(false); }
  }

  const lastApplied = [...messages].reverse().find(item => item.role === 'assistant' && item.state === 'applied')?.id;
  const busy = running || host.disabled;

  return <section className={styles.chat} aria-label="配音助手">
    <div className={styles.messages} ref={log} role="log" aria-live="polite">
      {messages.map(message => message.role === 'user'
        ? <div key={message.id} className={`${styles.bubble} ${styles.bubbleUser}`}>{message.text}</div>
        : <div key={message.id} className={`${styles.bubble} ${styles.bubbleAssistant}`}>
            <div>{message.text}</div>
            {message.lines && (message.intents
              ? <div className={styles.planCard} data-state={message.state}>
                  <ul className={styles.planSteps}>{message.lines.map((line, index) => <li key={index}>{line}</li>)}</ul>
                  {message.notes?.map(note => <p key={note} className={styles.panelHint}>{note}</p>)}
                  {message.state === 'pending' && <div className={styles.planActions}>
                    <button type="button" className={`${styles.toolBtn} ${styles.toolBtnPrimary}`} disabled={busy} onClick={() => void apply(message)}>应用</button>
                    <button type="button" className={styles.toolBtn} onClick={() => update(message.id, { state: 'cancelled' })}>取消</button>
                  </div>}
                  {message.state === 'applied' && <div className={styles.planActions}><span className={styles.panelHint}>已应用</span>
                    {message.id === lastApplied && <button type="button" className={styles.chip} disabled={busy} onClick={() => { hostRef.current.undo(); update(message.id, { state: 'undone' }); }}>撤销</button>}</div>}
                  {message.state === 'undone' && <p className={styles.panelHint}>已撤销</p>}
                  {message.state === 'cancelled' && <p className={styles.panelHint}>已取消</p>}
                  {message.result?.map(item => <p key={item} className={styles.planResult}>{item}</p>)}
                </div>
              : <div className={styles.chipRow}>{message.lines.map(line => <button type="button" key={line} className={styles.chip}
                  onClick={() => line.endsWith('……') ? setDraft(line.replace('……', '')) : void send(line)}>{line}</button>)}</div>)}
            {!message.intents && message.notes?.map(note => <p key={note} className={styles.panelHint}>{note}</p>)}
          </div>)}
    </div>
    <div className={styles.chipRow}>{SUGGESTIONS.map(item => <button type="button" key={item} className={styles.chip} disabled={busy} onClick={() => void send(item)}>{item}</button>)}</div>
    <form className={styles.composer} onSubmit={event => { event.preventDefault(); void send(draft); }}>
      <textarea className={styles.input} aria-label="告诉助手想怎么改" placeholder="说说想怎么改，例如：第 3 句慢一点" rows={2} value={draft} maxLength={500}
        onChange={event => setDraft(event.target.value)}
        onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(draft); } }} />
      <button type="submit" className={styles.send} disabled={!draft.trim() || running}>发送</button>
    </form>
  </section>;
}

function proposalLines(plan: AssistantPlan, context: AssistantContext, autoFit: boolean) {
  return [
    ...plan.steps.map(step => step.label),
    ...(plan.retime && autoFit ? ['之后重新贴合视频'] : []),
    ...plan.commands.map(command => `然后${describeCommand(command, context)}`),
  ];
}
