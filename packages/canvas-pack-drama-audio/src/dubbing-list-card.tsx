import React from 'react';
import type { CardRenderProps, CardPackNode } from '@bezier/canvas-card-sdk';
import { DubbingEditor } from './dubbing-editor';
import { demoProjectOf, patchDubbingListSource, readDubbingListSource } from './demo-adapter';

export function DubbingListCard(props: CardRenderProps) {
  const project = demoProjectOf(props.node);
  const sourceId = props.node.data?.sourceNodeId;
  const [source, setSource] = React.useState<CardPackNode | null>(null);
  const [error, setError] = React.useState('');
  React.useEffect(() => {
    if (!project || typeof sourceId !== 'string' || sourceId === props.node.id) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const current = await readDubbingListSource(project, sourceId, controller.signal);
        if (!controller.signal.aborted) { setSource(current); setError(''); }
      } catch (reason) {
        if (!controller.signal.aborted) { setSource(null); setError(reason instanceof Error ? reason.message : '源卡读取失败'); }
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(refresh, 1000);
      }
    };
    void refresh();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [project, sourceId, props.node.id]);
  const patch: CardRenderProps['onPatch'] = changes => {
    if (!source || !project || typeof sourceId !== 'string' || !changes.data) return;
    const nextData = changes.data;
    void patchDubbingListSource(project, sourceId, source.data ?? {}, nextData, new AbortController().signal)
      .then(() => setSource({ ...source, data: nextData }))
      .catch(reason => setError(reason instanceof Error ? reason.message : '源卡保存失败'));
  };
  return <div className="nodrag nopan">
    {error && <div role="alert" style={{ padding: 12, color: '#b91c1c' }}>{error}</div>}
    {source ? <DubbingEditor {...props} node={source} onPatch={patch} listOnly /> : <div style={{ padding: 12 }}>正在读取同画布配音源卡…</div>}
  </div>;
}
