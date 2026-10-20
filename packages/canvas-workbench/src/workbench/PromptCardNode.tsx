'use client';

import React from 'react';
import { Button } from '@bezier/components';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { CompositionSafeTextarea } from './CompositionSafeField';
import { cr } from '../locales/canvas-remainder';

export type WorkbenchPromptCard = {
  id: string;
  imageId: string;
  taskId: string;
  x: number;
  y: number;
  text: string;
  negativePrompt?: string;
  model?: string;
  ratio?: '1:1' | '3:4' | '4:3' | '9:16' | '16:9';
  resolution?: '2K' | '4K';
};

export type PromptCardData = {
  card: WorkbenchPromptCard;
  busy?: boolean;
  onChange: (id: string, text: string) => void;
  onClose: (id: string) => void;
  onGenerate: (id: string) => void;
};

function CopyIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <rect x="6.5" y="6.5" width="9" height="10" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M13.5 6.5V5A1.5 1.5 0 0 0 12 3.5H5A1.5 1.5 0 0 0 3.5 5v8A1.5 1.5 0 0 0 5 14.5h1.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

export function PromptCardNode({ data }: NodeProps<Node<PromptCardData>>) {
  const { card, busy, onChange, onClose, onGenerate } = data;
  const [copied, setCopied] = React.useState(false);

  async function copyPrompt() {
    await navigator.clipboard.writeText(card.text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  return (
    <article className="prompt-card-node">
      <Handle type="target" position={Position.Left} className="node-handle" />
      <header className="prompt-card-head prompt-card-drag">
        <div>
          <span>PROMPT</span>
          <strong>{cr().imagePrompt}</strong>
        </div>
        <Button variant="ghost" size="icon" className="nodrag nopan" aria-label={cr().closePrompt} onClick={() => onClose(card.id)}>×</Button>
      </header>
      <CompositionSafeTextarea
        className="prompt-card-editor nodrag nopan nowheel"
        value={card.text}
        onValueChange={text => onChange(card.id, text)}
        onWheel={event => event.stopPropagation()}
        spellCheck={false}
        aria-label={cr().imagePrompt}
      />
      <footer className="prompt-card-actions nodrag nopan">
        <Button variant="ghost" className="prompt-copy" onClick={() => void copyPrompt()}>
          <CopyIcon />{copied ? cr().copied : cr().copy}
        </Button>
        <Button variant="primary" className="prompt-generate" disabled={busy || !card.text.trim()} onClick={() => onGenerate(card.id)}>
          {busy ? cr().generatingEllipsis : cr().generateWithPrompt}
        </Button>
      </footer>
    </article>
  );
}

export function buildPromptCardNode(args: {
  card: WorkbenchPromptCard;
  imageWidth: number;
  imageHeight: number;
  busy?: boolean;
  callbacks: Omit<PromptCardData, 'card' | 'busy'>;
}): Node<PromptCardData> {
  const promptHeight = 348;
  return {
    id: args.card.id,
    type: 'promptCard',
    position: {
      x: args.imageWidth + 12,
      y: (args.imageHeight - promptHeight) / 2,
    },
    parentId: args.card.imageId,
    draggable: false,
    selectable: true,
    data: {
      card: args.card,
      busy: args.busy,
      ...args.callbacks,
    },
  };
}
