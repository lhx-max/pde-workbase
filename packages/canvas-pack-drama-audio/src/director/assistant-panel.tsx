'use client';

import { useEffect, useRef, useState } from 'react';
import { ASSISTANT_EXAMPLES, describeCommand, parseCommand, planIntents } from './assistant';
import type { AssistantContext, AssistantIntent, AssistantPlan, CommandIntent } from './assistant';
import styles from './workbench.module.css';

type Data = Record<string, unknown>;
export interface AssistantHost {
  context: AssistantContext;
  read: () => Data;
  apply: (plan: AssistantPlan) => { ok: true; message?: string } | { ok: false; message: string };
  run: (command: CommandIntent) => Promise<string> | string;
  undo: () => void;
  disabled: boolean;
  autoFit: boolean;
}
export interface AssistantAgent {
  status: () => Promise<{ available: boolean; reason?: string }>;
  ask: (prompt: string, context?: { lines: { id: string; text: string }[] }) => Promise<{ text: string }>;
}

type ProposalState = 'pending' | 'applied' | 'cancelled' | 'undone';
type UserMessage = { id: number; role: 'user'; text: string };
type AssistantMessage = { id: number; role: 'assistant'; text: string; lines?: string[]; notes?: string[]; intents?: AssistantIntent[]; state?: ProposalState; result?: string[] };
type Message = UserMessage | AssistantMessage;

const SUGGESTIONS = ['贴合视频', '补齐配音', '检查问题'] as const;
const WELCOME: AssistantMessage = { id: 0, role: 'assistant', text: '说说想怎么改，我会先列出改动，确认后再应用，随时可以撤销。', lines: ASSISTANT_EXAMPLES.filter(item => !(SUGGESTIONS as readonly string[]).includes(item)) };

type AgentState = 'idle' | 'checking' | 'ready' | 'unavailable' | 'running' | 'busy';

export function AssistantPanel({ host, agent }: { host: AssistantHost; agent?: AssistantAgent | undefined }) {
  const [agentState, setAgentState] = useState<AgentState>('idle');
  const [agentHint, setAgentHint] = useState('');
  const [shareLinesChecked, setShareLinesChecked] = useState(false);
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

  async function activateAgent() {
    if (!agent || agentState === 'checking') return;
    if (agentState === 'ready') { setAgentState('idle'); setAgentHint(''); return; }
    setAgentState('checking');
    setAgentHint('');
    try {
      const { available, reason } = await agent.status();
      if (available) {
        setAgentState('ready');
        setAgentHint('已连接本机 myflicker · 建议仅供参考，确认后才应用');
      } else {
        setAgentState('unavailable');
        const reasonMap: Record<string, string> = {
          CLI_NOT_FOUND: '本机未检测到已登录的 myflicker CLI，请先在终端安装并登录：curl -fsSL https://cdnfile.corp.kuaishou.com/kc/files/a/Takumi/myflicker/release/cli/install.sh | bash',
        };
        setAgentHint(reasonMap[reason ?? ''] ?? '本机 myflicker CLI 不可用；手动编辑与本地助手仍可用。');
      }
    } catch {
      setAgentState('unavailable');
      setAgentHint('检测失败；手动编辑与本地助手仍可用。');
    }
  }

  function extractIntentLines(text: string, context: AssistantContext): AssistantIntent[][] {
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    const result: AssistantIntent[][] = [];
    for (const line of lines) {
      const parsed = parseCommand(line, context);
      if (!('error' in parsed) && parsed.intents.length) result.push(parsed.intents);
    }
    return result;
  }

  async function send(text: string) {
    const input = text.trim();
    if (!input || running || host.disabled) return;

    if (agentState === 'ready' || agentState === 'busy') {
      if (agentState === 'busy') { pushAssistant({ text: '本机 Agent 正忙，请稍后重试。' }); return; }
      setDraft('');
      pushUser(input);
      setAgentState('running');
      setRunning(true);
      try {
        const current = hostRef.current.read();
        const lines = Array.isArray(current.rewriteLines)
          ? (current.rewriteLines as unknown[]).filter((line): line is { id: string; text: string } =>
              Boolean(line && typeof line === 'object' && typeof (line as Record<string, unknown>).id === 'string' && typeof (line as Record<string, unknown>).text === 'string'))
            .map(line => ({ id: line.id, text: line.text }))
          : [];
        const result = await agent!.ask(input, shareLinesChecked ? { lines } : undefined);
        const intentGroups = extractIntentLines(result.text, hostRef.current.context);
        if (intentGroups.length) {
          const data = hostRef.current.read();
          for (const intents of intentGroups) {
            const plan = planIntents(data, intents, hostRef.current.context);
            if (plan.steps.length) {
              pushAssistant({ text: '建议这样改：', lines: proposalLines(plan, hostRef.current.context, hostRef.current.autoFit), notes: plan.notes, intents, state: 'pending' });
            }
          }
          pushAssistant({ text: result.text });
        } else {
          pushAssistant({ text: result.text });
        }
        setAgentState('ready');
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Agent 请求失败；不会自动重试。';
        pushAssistant({ text: msg });
        setAgentState('unavailable');
        setAgentHint('Agent 请求失败，请重新唤醒后重试。');
      } finally { setRunning(false); setShareLinesChecked(false); }
      return;
    }

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

  const agentButtonLabel = {
    idle: '唤醒我的 Agent',
    checking: '正在检查本机 Agent…',
    ready: '休眠 Agent · 切回本地',
    unavailable: '唤醒我的 Agent',
    running: '请求处理中…',
    busy: '唤醒我的 Agent',
  }[agentState];

  const agentPanelHint = agentState === 'ready' || agentState === 'running'
    ? agentHint
    : agentState === 'unavailable'
    ? agentHint
    : '本地助手 · 无需登录。唤醒后调用本机已登录的 myflicker CLI 给建议，不读取浏览器 Cookie。';

  return <section className={styles.chat} aria-label="配音助手">
    {agent && <div className={styles.agentActivation}>
      <button type="button" className={styles.agentWake}
        disabled={agentState === 'checking' || agentState === 'running'}
        onClick={() => void activateAgent()}>
        <span aria-hidden="true">◉</span> {agentButtonLabel}
      </button>
      <p className={styles.panelHint}>{agentPanelHint}</p>
      {(agentState === 'ready' || agentState === 'running') && <label className={styles.panelHint}>
        <input type="checkbox" checked={shareLinesChecked} onChange={event => setShareLinesChecked(event.target.checked)} />
        {' '}同时分享当前卡片台词（不含视频、音频或整个工程）
      </label>}
    </div>}
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
