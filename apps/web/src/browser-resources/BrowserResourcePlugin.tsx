import { lazy, Suspense, useEffect, useId, useState } from 'react';
import { Button } from '@bezier/components';
import { BROWSER_RESOURCE_PLUGIN_ID, type WorkspaceCollabContext } from '@bezier/contracts';
import { getBezierHost } from '@bezier/host';
import { Icon } from '../components/Icon';
import { useT } from '../i18n';
import styles from './BrowserResources.module.css';

const ResourcePanel = lazy(() => import('./BrowserResourcePanel'));
export interface ResourceCaptureNode extends HTMLElement { getWebContentsId(): number }
export interface BrowserResourcePluginOptions {
  node: ResourceCaptureNode | null;
  projectId: string;
  tabId?: string;
  available: boolean;
  workspaceContext?: WorkspaceCollabContext | null;
}
/** Built-in browser plugin, not a marketplace skill or a Chrome extension loader.
 * Its panel, grant, network observer, and reads exist only after a user opens it.
 */
export function useBrowserResourcePlugin(options: BrowserResourcePluginOptions) {
  const t = useT();
  const fallbackId = useId();
  const [open, setOpen] = useState(false);
  const supported = options.available && !!options.node && !!getBezierHost()?.browser.openResourceCapture;
  useEffect(() => { if (!supported) setOpen(false); }, [supported]);
  return {
    trigger: <Button type="button" variant="ghost" className={styles.trigger} disabled={!supported} aria-pressed={open}
      aria-label={t('browserResources.title')} title={t(supported ? 'browserResources.title' : 'browserResources.unavailable')}
      data-browser-plugin={BROWSER_RESOURCE_PLUGIN_ID} onClick={() => setOpen(value => !value)}>
      <Icon name="puzzle" size={16} />
    </Button>,
    panel: open && supported && options.node ? <Suspense fallback={<aside className={styles.panel} role="status">{t('browserResources.loading')}</aside>}>
      <ResourcePanel node={options.node} projectId={options.projectId} tabId={options.tabId ?? `resource-tab:${fallbackId}`}
        workspaceContext={options.workspaceContext} onClose={() => setOpen(false)} />
    </Suspense> : null,
  };
}
