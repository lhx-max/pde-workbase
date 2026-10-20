import type { ReactNode } from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/src/components/ui';
import { useT } from '../../i18n';
import type { Dict } from '../../i18n/types';
import { Icon } from '../Icon';
import type { TabLauncherClickProps } from '@bezier/contracts/analytics';
import type { LauncherAction, LauncherContext } from './tab-launcher';
import styles from './TabLauncherMenu.module.css';

// Page/area/project_id are filled by the host (FileWorkspace); the menu only
// supplies the event-specific fields.
export type TabLauncherTrackInput = Omit<
  TabLauncherClickProps,
  'page_name' | 'area' | 'project_id'
>;

interface Props {
  /** The workspace "+" control. The public menu owns its anchoring and focus. */
  trigger: ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Registry-backed working surfaces available in this product. */
  actions: LauncherAction[];
  /** Context the registry actions run against. */
  launcherContext: LauncherContext;
  /** Fire a tab-launcher ui_click (host fills page/area/project_id). */
  onTrack?: (input: TabLauncherTrackInput) => void;
}

// A compact create menu for the tab strip's "+" button. It deliberately owns
// only new working surfaces; opening existing files stays in the file panel so
// this shortcut reads as an immediate choice instead of a second file browser.
export function TabLauncherMenu({
  trigger,
  open,
  onOpenChange,
  actions,
  launcherContext,
  onTrack,
}: Props) {
  const t = useT();

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen && !open) onTrack?.({ element: 'open' });
    onOpenChange(nextOpen);
  }

  function runLauncherAction(action: LauncherAction) {
    onTrack?.({ element: 'create', action_id: action.id });
    action.run(launcherContext);
    onOpenChange(false);
  }

  function actionLabel(action: LauncherAction): string {
    if (action.label !== undefined) return action.label;
    return t(action.labelKey);
  }

  return (
    <DropdownMenu open={open} onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        sideOffset={6}
        className={styles.menu}
        aria-label={t('workspace.createNew')}
        data-testid="tab-launcher-menu"
      >
        {actions.map((action) => (
          <DropdownMenuItem
            key={action.id}
            className={styles.quickAction}
            onSelect={() => runLauncherAction(action)}
          >
            <span className={styles.quickActionIcon} aria-hidden>
              <Icon name={action.iconName} size={17} />
            </span>
            <span className={styles.quickActionLabel}>{actionLabel(action)}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
