import type { ReactNode } from 'react';
import { useI18n } from '../i18n';
import { assetInspectorCopy } from '../i18n/locales/asset-inspector-copy';
import { Tabs, TabsList, TabsTrigger, TabsContent } from './ui';
import { AssetDetailInspector } from './AssetDetailDialog';
import styles from './AssetAnalysisFields.module.css';

export type AssetInspectorView = 'info' | 'analysis' | 'prompt';

/** Shared inspector for unsaved drafts and saved assets; callers own persistence. */
export function AssetInspectorViews({ view, onViewChange, info, prompt, yaml, actions, error, navigationDisabled = false }: {
  view: AssetInspectorView;
  onViewChange: (view: AssetInspectorView) => void;
  info: ReactNode;
  prompt?: ReactNode;
  yaml: ReactNode;
  actions?: ReactNode;
  error?: ReactNode;
  navigationDisabled?: boolean;
}) {
  const { locale, t } = useI18n();
  const copy = assetInspectorCopy(locale);
  const hasPrompt = prompt != null;
  const activeView = view === 'prompt' && !hasPrompt ? 'info' : view;
  return <Tabs value={activeView} onValueChange={value => onViewChange(value as AssetInspectorView)} className={styles.root}>
    <AssetDetailInspector toolbar={<TabsList className={styles.tabs} aria-label={copy.views}>
      <TabsTrigger value="info" disabled={navigationDisabled && activeView !== 'info'} className={styles.tab}>{copy.infoTab}</TabsTrigger>
      {hasPrompt && <TabsTrigger value="prompt" disabled={navigationDisabled && activeView !== 'prompt'} className={styles.tab}>{t('asset.detail.promptTab')}</TabsTrigger>}
      <TabsTrigger value="analysis" disabled={navigationDisabled && activeView !== 'analysis'} className={styles.tab}>YAML</TabsTrigger>
    </TabsList>} actions={actions}>
      <TabsContent value="info" className={styles.panel}>{info}</TabsContent>
      {hasPrompt && <TabsContent value="prompt" className={styles.panel}>{prompt}</TabsContent>}
      <TabsContent value="analysis" className={styles.panel}>{yaml}</TabsContent>
      {error}
    </AssetDetailInspector>
  </Tabs>;
}
