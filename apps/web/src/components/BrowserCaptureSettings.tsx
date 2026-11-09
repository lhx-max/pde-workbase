import { useState } from 'react';
import { Button } from '@bezier/components';
import type { BrowserCapturePreferences } from '@bezier/contracts';
import { Popover, PopoverContent, PopoverTrigger, Switch } from './ui';
import { Icon } from './Icon';
import { useT } from '../i18n';
import { reloadBrowserPreferences, updateBrowserCapture, useBrowserPreferences } from '../browser-resources/browser-preferences';
import styles from './BrowserCaptureSettings.module.css';

/** The master switch suspends overlays without forgetting per-kind choices. */
export function BrowserCaptureSettings() {
  const t = useT();
  const { capture, ready, error } = useBrowserPreferences();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const active = capture.enabled && (capture.text || capture.images);
  const locked = !ready || error || busy;
  const change = (key: keyof BrowserCapturePreferences, checked: boolean) => {
    setBusy(true); setFailed(false);
    void updateBrowserCapture(current => ({ ...current, [key]: checked }))
      .catch(() => setFailed(true)).finally(() => setBusy(false));
  };
  const title = t('browserCapture.settings.title');
  return <Popover>
    <PopoverTrigger asChild>
      <Button type="button" variant="ghost" className={styles.trigger} data-enabled={active} aria-label={title}
        title={`${title} · ${t(active ? 'browserCapture.settings.on' : 'browserCapture.settings.off')}`}>
        <Icon name="scan-line" size={16} />
      </Button>
    </PopoverTrigger>
    <PopoverContent align="end" sideOffset={8} className={styles.panel} aria-label={title}>
      <div className={styles.heading}>{title}</div>
      <label className={styles.row}>
        <span>{t('browserCapture.settings.enabled')}</span>
        <Switch checked={capture.enabled} disabled={locked} onCheckedChange={checked => change('enabled', checked)} aria-label={t('browserCapture.settings.enabled')} />
      </label>
      <div className={styles.kinds}>
        <label className={styles.row}>
          <span><Icon name="file-text" size={14} />{t('browserCapture.settings.text')}</span>
          <Switch checked={capture.text} disabled={locked || !capture.enabled} onCheckedChange={checked => change('text', checked)} aria-label={t('browserCapture.settings.text')} />
        </label>
        <label className={styles.row}>
          <span><Icon name="image" size={14} />{t('browserCapture.settings.images')}</span>
          <Switch checked={capture.images} disabled={locked || !capture.enabled} onCheckedChange={checked => change('images', checked)} aria-label={t('browserCapture.settings.images')} />
        </label>
      </div>
      <p className={styles.description}>{t('browserCapture.settings.description')}</p>
      {error || failed ? <div className={styles.error} role="alert">
        {t(error ? 'browserLibrary.loadFail' : 'browserBookmarks.saveFail')}
        {error ? <Button type="button" variant="ghost" onClick={() => void reloadBrowserPreferences()}>{t('common.retry')}</Button> : null}
      </div> : null}
    </PopoverContent>
  </Popover>;
}
