'use client';

import React from 'react';
import { Icon, type IconName } from '../ui/Icon';
import { cr } from '../locales/canvas-remainder';

/**
 * Shared empty-state composition for canvas cards.
 *
 * The surrounding node owns its border, selection and connection semantics;
 * this primitive keeps the central glyph, hint and action rhythm identical.
 */
export function CanvasNodeStarter({
  actions,
  icon,
}: {
  actions: React.ReactNode;
  icon: IconName;
}) {
  return (
    <div className="canvas-node-starter node-drag-surface">
      <div className="canvas-node-starter-content">
        <Icon className="canvas-node-starter-glyph" name={icon} size={56} strokeWidth={1.8} />
        <div className="canvas-node-starter-action-stack">
          <span className="canvas-node-starter-hint">{cr().tryLabel}</span>
          <div className="canvas-node-starter-actions nodrag nowheel" onDoubleClick={event => event.stopPropagation()}>
            {actions}
          </div>
        </div>
      </div>
    </div>
  );
}
