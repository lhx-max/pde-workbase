import React from 'react';
import type { CardRenderProps } from '@bezier/canvas-card-sdk';

interface MemoData {
  text?: string;
  color?: string;
}

/** 备忘卡渲染器：data 黑盒里的字段由本包自管，平台只负责信封。 */
export function MemoCard({ node, onPatch }: CardRenderProps) {
  const data = (node.data ?? {}) as MemoData;
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(data.text ?? '');

  const commit = () => {
    setEditing(false);
    if (draft !== (data.text ?? '')) onPatch({ data: { ...data, text: draft } });
  };

  if (editing) {
    return (
      <textarea
        className="nodrag demo-memo-textarea"
        autoFocus
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commit(); }
          if (e.key === 'Escape') { setDraft(data.text ?? ''); setEditing(false); }
        }}
      />
    );
  }

  return (
    <div
      className="demo-memo"
      onDoubleClick={() => { setDraft(data.text ?? ''); setEditing(true); }}
    >
      {data.text || '双击输入…'}
    </div>
  );
}
