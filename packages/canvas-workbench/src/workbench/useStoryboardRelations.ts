import React from 'react';
import type { StoryboardRelationFocus } from './storyboard-relations';

export function useStoryboardRelations() {
  const [pinned, setPinned] = React.useState<StoryboardRelationFocus>();
  // Hover is local CSS feedback only; relations are an explicit click interaction.
  const hover = React.useCallback((_target?: StoryboardRelationFocus) => {}, []);
  const clear = React.useCallback(() => {
    setPinned(undefined);
  }, []);
  const pin = React.useCallback((target?: StoryboardRelationFocus) => {
    setPinned(current => JSON.stringify(current) === JSON.stringify(target) ? undefined : target);
  }, []);
  return { active: pinned, pinned, hover, pin, clear };
}
