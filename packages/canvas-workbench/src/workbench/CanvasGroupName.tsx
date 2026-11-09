import { useState } from 'react';
import { Button } from '@bezier/components';
import { CompositionSafeInput } from './CompositionSafeField';
import { cr } from '../locales/canvas-remainder';

/** Shared explicit rename control; Escape cancels instead of committing on blur. */
export function CanvasGroupName({ name, onRename }: { name: string; onRename: (name: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  return draft === null
    ? <Button variant="ghost" onClick={() => setDraft(name)}>{cr().rename}</Button>
    : <CompositionSafeInput autoFocus className="nodrag nopan" aria-label={cr().groupName} value={draft}
        onValueChange={setDraft} onBlur={() => { onRename(draft.trim() || name); setDraft(null); }}
        onKeyDown={event => {
          event.stopPropagation();
          if (event.nativeEvent.isComposing) return;
          if (event.key === 'Escape') { event.preventDefault(); setDraft(null); }
          if (event.key === 'Enter') event.currentTarget.blur();
        }} />;
}
