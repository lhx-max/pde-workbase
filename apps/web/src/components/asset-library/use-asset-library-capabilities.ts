import { useEffect, useState } from 'react';
import { PERSONAL_ASSET_CHANGED_EVENT, type AssetLibraryInfo } from '@bezier/contracts';
import { getActiveAssetLibraryAdapter, type AssetLibraryAdapter } from '../../providers/asset-library';

/** Retain verified capabilities during same-source refresh; source changes and
 * failed verification fail closed. Asset writes must not revoke live captures. */
export function useAssetLibraryCapabilities() {
  const [info, setInfo] = useState<AssetLibraryInfo | null>(null);
  useEffect(() => {
    let alive = true;
    let generation = 0;
    let source: AssetLibraryAdapter | null = null;
    const load = () => {
      const current = ++generation;
      const adapter = getActiveAssetLibraryAdapter();
      if (source !== adapter) setInfo(null);
      source = adapter;
      const isCurrent = () => alive && generation === current && getActiveAssetLibraryAdapter() === adapter;
      void Promise.resolve().then(() => adapter.info()).then(value => {
        if (isCurrent()) setInfo(value);
      }).catch(() => { if (isCurrent()) setInfo(null); });
    };
    load();
    window.addEventListener(PERSONAL_ASSET_CHANGED_EVENT, load);
    return () => { alive = false; window.removeEventListener(PERSONAL_ASSET_CHANGED_EVENT, load); };
  }, []);
  return { info, analysis: info?.capabilities.analysis === true, catalogue: info?.capabilities.catalogue === true };
}
