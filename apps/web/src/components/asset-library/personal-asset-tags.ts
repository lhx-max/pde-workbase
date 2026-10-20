import { useEffect, useState } from 'react';
import { PERSONAL_ASSET_CHANGED_EVENT, type PersonalAsset } from '@bezier/contracts';
import { personalAssets } from '../../providers/asset-library';

/** Same catalog the library inspector uses: unique live-asset tags, sorted. */
export function personalAssetTagsFrom(assets: Array<Pick<PersonalAsset, 'deletedAt' | 'tags'>>): string[] {
  return [...new Set(assets.filter((asset) => !asset.deletedAt).flatMap((asset) => asset.tags))]
    .sort((left, right) => left.localeCompare(right));
}

export function usePersonalAssetTags(enabled: boolean): string[] {
  const [tags, setTags] = useState<string[]>([]);
  useEffect(() => {
    if (!enabled) {
      setTags([]);
      return;
    }
    let cancelled = false;
    const load = () => {
      void personalAssets.list()
        .then((result) => { if (!cancelled) setTags(personalAssetTagsFrom(result.assets)); })
        .catch(() => { if (!cancelled) setTags([]); });
    };
    load();
    const onChange = () => load();
    window.addEventListener(PERSONAL_ASSET_CHANGED_EVENT, onChange);
    let channel: BroadcastChannel | null = null;
    try {
      channel = new BroadcastChannel(PERSONAL_ASSET_CHANGED_EVENT);
      channel.onmessage = onChange;
    } catch { /* one-window fallback */ }
    return () => {
      cancelled = true;
      window.removeEventListener(PERSONAL_ASSET_CHANGED_EVENT, onChange);
      channel?.close();
    };
  }, [enabled]);
  return tags;
}
