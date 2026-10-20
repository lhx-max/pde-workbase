'use client';

import React from 'react';

/**
 * Card kinds the host currently allows the user to create.
 *
 * `null` (the default) means unrestricted — standalone workbench usage and
 * hosts without an App registry keep the full catalogue. The workspace host
 * narrows the set from the canvas capability manifest + the App registry:
 * native kinds stay, App-backed kinds only appear while their editor App is
 * registered and active.
 */
export const CanvasKindAvailability = React.createContext<ReadonlySet<string> | null>(null);

/** Predicate shared by every add-node entry (dock, empty canvas, card ports). */
export function useCanvasKindAvailability(): (kind: string) => boolean {
  const allowed = React.useContext(CanvasKindAvailability);
  return React.useCallback((kind: string) => !allowed || allowed.has(kind), [allowed]);
}
