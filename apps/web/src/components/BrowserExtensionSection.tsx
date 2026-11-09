import { useEffect, useRef, useState } from 'react';
import { getBezierHost, type BezierHostBrowserCaptureRecord, type BezierHostBrowserExtensionStatus } from '@bezier/host';
import { Button, SettingsGroup, SettingsRow } from '@/src/components/ui';
import styles from './BrowserExtensionSection.module.css';
import { useI18n } from '../i18n';
import { formatAppDateTime } from '../utils/app-date';

export function BrowserExtensionSection() {
  const { t, locale } = useI18n();
  const browser = getBezierHost()?.browser;
  const kindLabel = { selection: t('browserExtension.kind.selection'), image: t('browserExtension.kind.image') } as const;
  const [status, setStatus] = useState<BezierHostBrowserExtensionStatus>({
    connected: false,
    browserName: null,
    message: browser ? t('browserExtension.detecting') : t('browserExtension.desktopOnly'),
  });
  const [records, setRecords] = useState<BezierHostBrowserCaptureRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const mounted = useRef(false);
  const installing = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  useEffect(() => {
    if (!browser?.getCaptureExtensionStatus) return;
    let cancelled = false;
    const apply = (next: BezierHostBrowserExtensionStatus) => { if (!cancelled) setStatus(next); };
    const failure = (error: unknown) => { if (!cancelled) setNotice(error instanceof Error ? error.message : t('browserExtension.installFail')); };
    let polling = false;
    const refresh = async () => {
      if (cancelled || polling) return;
      polling = true;
      try { const next = await browser.getCaptureExtensionStatus?.(); if (next) apply(next); }
      catch (error) { if (!cancelled) setStatus(current => ({ ...current, connected: false })); failure(error); }
      finally { polling = false; }
    };
    void refresh();
    const stopStatus = browser.onCaptureExtensionStatus?.(apply);
    const poll = window.setInterval(() => { void refresh(); }, 2000);
    void (async () => {
      try { const list = await browser.listCaptureRecords?.(); if (!cancelled && list) setRecords(list); }
      catch (error) { failure(error); }
    })();
    const stopRecords = browser.onCaptureRecord?.((record) => {
      if (!cancelled) setRecords((current) => [record, ...current.filter((item) => item.id !== record.id)].slice(0, 20));
    });
    return () => {
      cancelled = true;
      window.clearInterval(poll);
      stopStatus?.();
      stopRecords?.();
    };
  }, [browser, t]);

  const install = async () => {
    if (!browser?.installCaptureExtension || installing.current) return;
    installing.current = true; setBusy(true); setNotice(null);
    try {
      const result = await browser.installCaptureExtension();
      if (mounted.current) setNotice(result.ok ? result.message : (result.reason || t('browserExtension.installFail')));
    } catch (error) {
      if (mounted.current) setNotice(error instanceof Error ? error.message : t('browserExtension.installFail'));
    } finally {
      installing.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  return (
    <section className={styles.root} data-testid="settings-browser-extension">
      <SettingsGroup title={t('browserExtension.title')} description={status.browserName ? t('browserExtension.defaultBrowser', { name: status.browserName }) : undefined}>
        <SettingsRow
          label={status.connected ? t('browserExtension.connected') : t('browserExtension.disconnected')}
          hint={status.message}
          control={status.connected ? <span className={styles.dotOk} aria-hidden="true" /> : (
            browser?.installCaptureExtension ? (
              <Button type="button" variant="primary" disabled={busy} onClick={() => void install()}>
                {busy ? t('browserExtension.opening') : t('browserExtension.install')}
              </Button>
            ) : null
          )}
        />
        {notice ? <p className={styles.notice} role="status">{notice}</p> : null}
      </SettingsGroup>
      {records.length > 0 ? <SettingsGroup title={t('browserExtension.recent')} flush>
        {records.length ? (
          <ol className={styles.records}>
            {records.map((record) => (
              <li key={record.id} className={record.ok ? undefined : styles.bad}>
                <span className={styles.when}>{formatAppDateTime(record.at, locale)}</span>
                <span className={styles.kind}>{kindLabel[record.kind]}</span>
                <span className={styles.title}>{record.title}</span>
                <span className={styles.message}>{record.message}</span>
              </li>
            ))}
          </ol>
        ) : (
          <p className={styles.empty}>{t('browserExtension.empty')}</p>
        )}
      </SettingsGroup> : null}
    </section>
  );
}
