import { useEffect, useRef, useState } from 'react';
import { getBezierHost } from '@bezier/host';
import { useT } from '../i18n';
import { PERSONAL_ASSET_CHANGED_EVENT } from '@bezier/contracts';
import { personalAssets } from '../providers/asset-library';
import { persistBrowserCapture } from '../browser-capture/persist-browser-capture';
import { usePickerSpaces } from './asset-library/use-picker-spaces';
import { useAssetLibraryCapabilities } from './asset-library/use-asset-library-capabilities';

/** Single app-level sink, matching the original cross-project asset capture.
 * Opening the workspace does NOT enable external capture; native consent does. */
export function BrowserExtensionCaptureHost({ projectId, projectName }: { projectId?: string | null; projectName?: string }) {
  const t = useT();
  const browser = getBezierHost()?.browser;
  const { space, folders } = usePickerSpaces(null, !!browser?.onBrowserCapture);
  const { info } = useAssetLibraryCapabilities();
  const [tags, setTags] = useState<string[]>([]);
  const currentProject = useRef(projectId);
  currentProject.current = projectId;
  useEffect(() => {
    if (!browser?.onBrowserCapture) return;
    let alive = true;
    const refresh = () => { void personalAssets.list().then(({ assets }) => {
      if (alive) setTags([...new Set(assets.filter(asset => !asset.deletedAt).flatMap(asset => asset.tags))].slice(0, 1000));
    }).catch(() => { if (alive) setTags([]); }); };
    refresh(); window.addEventListener(PERSONAL_ASSET_CHANGED_EVENT, refresh);
    return () => { alive = false; window.removeEventListener(PERSONAL_ASSET_CHANGED_EVENT, refresh); };
  }, [browser]);
  useEffect(() => {
    browser?.setBrowserCaptureContext?.({ projectId: projectId ?? null, projectName,
      canWrite: info?.capabilities.upload === true, spaces: folders.map(({ id, name }) => ({ id, name })), defaultSpaceId: space, tags });
  }, [browser, projectId, projectName, folders, space, tags, info]);
  useEffect(() => {
    if (!browser?.onBrowserCapture) return;
    const unsubscribe = browser.onBrowserCapture(capture => {
      const sourceProject = currentProject.current ?? '';
      void persistBrowserCapture(sourceProject, capture).then(result => browser.completeBrowserCapture?.({ captureId: capture.captureId, ...result }))
        .catch(error => browser.completeBrowserCapture?.({ captureId: capture.captureId, ok: false,
          message: error instanceof Error ? error.message : t('browserCapture.saveAssetFail') })).catch(() => undefined);
    });
    return () => { unsubscribe(); browser.setBrowserCaptureContext?.({ projectId: null, canWrite: false }); };
  }, [browser, t]);
  return null;
}
