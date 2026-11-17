'use client';
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, BookOpen, Download, Search, X } from 'lucide-react';
import { manual, searchManual } from './manual';
import styles from './manual.module.css';

export function ManualDialog({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState('start');
  const topics = searchManual(query);
  const topic = topics.find(item => item.id === selected) ?? topics[0];
  const index = topics.findIndex(item => item.id === topic?.id);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const node = dialog.current;
    node?.showModal();
    search.current?.focus();
    return () => { node?.close(); if (previous?.isConnected) previous.focus(); };
  }, []);
  useEffect(() => { body.current?.scrollTo({ top: 0 }); }, [topic?.id, query]);
  return <dialog ref={dialog} className={styles.dialog} aria-labelledby="manual-heading" onCancel={event => { event.preventDefault(); onClose(); }}>
    <header className={styles.header}>
      <div className={styles.title}><BookOpen size={19} aria-hidden /><div><h2 id="manual-heading">使用帮助</h2><p>按任务找到操作方法</p></div></div>
      <a className={styles.download} href="/help/audio-workbench-manual.docx" download="音频工作台使用手册.docx"><Download size={15} aria-hidden />下载手册</a>
      <button className={styles.close} aria-label="关闭使用帮助" onClick={onClose}><X size={20} aria-hidden /></button>
    </header>
    <div className={styles.layout}>
      <aside className={styles.sidebar}>
        <div className={styles.search}><Search size={16} aria-hidden /><input ref={search} type="search" aria-label="搜索使用手册" placeholder="搜索：裁剪、无声音…" value={query} onChange={event => { setQuery(event.target.value); setSelected(''); }} /></div>
        <p className={styles.count} role="status">{query.trim() ? `找到 ${topics.length} 个主题` : '操作目录'}</p>
        <nav aria-label="使用手册目录">{topics.map(item => <button key={item.id} aria-current={topic?.id === item.id ? 'page' : undefined} onClick={() => setSelected(item.id)}><span>{String(manual.topics.indexOf(item) + 1).padStart(2, '0')}</span>{item.title}</button>)}</nav>
        <p className={styles.version}>本地试运行版<br />更新于 {manual.version}</p>
      </aside>
      <div className={styles.reading} ref={body}>
        {topic ? <article aria-labelledby="manual-topic-title">
          <h3 id="manual-topic-title">{topic.title}</h3><p className={styles.summary}>{topic.summary}</p>
          {topic.sections.map(section => <section key={section.title} className={styles.section}>
            <h4>{section.title}</h4>
            {section.entry && <p className={styles.entry}><span>操作入口</span>{section.entry}</p>}
            {section.kind === 'reference' ? <ul>{section.steps.map(step => <li key={step}>{step}</li>)}</ul> : <ol>{section.steps.map(step => <li key={step}>{step}</li>)}</ol>}
            {section.result && <p className={styles.result}><strong>完成后</strong>{section.result}</p>}
            {section.note && <p className={styles.note}><strong>留意</strong>{section.note}</p>}
          </section>)}
          <footer className={styles.pager}>
            <button disabled={index === 0} onClick={() => setSelected(topics[index - 1]!.id)}><ArrowLeft size={15} aria-hidden />上一节</button>
            <button disabled={index === topics.length - 1} onClick={() => setSelected(topics[index + 1]!.id)}>下一节<ArrowRight size={15} aria-hidden /></button>
          </footer>
        </article> : <div className={styles.empty}><h3>没有找到相关操作</h3><p>换个关键词，例如「台词」「分割」或「保存」。</p><button onClick={() => setQuery('')}>清空搜索，查看全部主题</button></div>}
      </div>
    </div>
    <footer className={styles.footer}><span>关闭帮助后继续当前编辑</span><button onClick={onClose}>返回编辑 <kbd>Esc</kbd></button></footer>
  </dialog>;
}
