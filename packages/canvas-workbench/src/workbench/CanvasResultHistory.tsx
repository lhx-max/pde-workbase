import { Button } from '@bezier/components';
import type { CanvasResultSnapshot } from '@bezier/contracts';
import { cr } from '../locales/canvas-remainder';

/** Same-card versions. Switching never creates a node or changes its links. */
export function CanvasResultHistory({ history, current, disabled, onSelect }: {
  history?: CanvasResultSnapshot[];
  current: CanvasResultSnapshot;
  disabled?: boolean;
  onSelect: (snapshot: CanvasResultSnapshot) => void;
}) {
  if (!history || history.length < 2) return null;
  return <div className="canvas-result-history nodrag nopan nowheel" role="group" aria-label={cr().artifactVersions} onWheel={event => event.stopPropagation()}>
    <span>{cr().version}</span>
    {history.map((snapshot, index) => <Button
      key={index}
      size="icon"
      variant={JSON.stringify(snapshot) === JSON.stringify(current) ? 'subtle' : 'ghost'}
      aria-pressed={JSON.stringify(snapshot) === JSON.stringify(current)}
      aria-label={cr().viewVersion(index)}
      disabled={disabled}
      onClick={() => onSelect(snapshot)}
    >{index + 1}</Button>)}
  </div>;
}
