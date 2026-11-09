import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Button, Dialog, DialogTitle, DialogDescription, DialogFooter, Input, Select, Textarea } from './ui';
import { useT } from '../i18n';
import { browserHttpUrl } from '../browser-resources/browser-preferences';
import styles from './BrowserBookmarks.module.css';

export type BrowserSiteDraft = { title: string; url: string; description: string; category: string };
export function BrowserSiteDialog({ heading, initial, categories, onSave, onClose }: {
  heading: string; initial?: Partial<BrowserSiteDraft>; categories?: Array<{ id: string; title: string }>;
  onSave: (value: BrowserSiteDraft) => Promise<void>; onClose: () => void;
}) {
  const t = useT();
  const [draft, setDraft] = useState<BrowserSiteDraft>({ title: '', url: '', description: '', category: categories?.[0]?.id ?? '', ...initial });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return createPortal(<Dialog as="form" className={styles.dialog} ariaLabel={heading}
    closeOnEscape={!busy} closeOnBackdrop={!busy} onClose={busy ? undefined : onClose}
    onSubmit={event => {
      event.preventDefault();
      if (busy) return;
      const url = browserHttpUrl(draft.url);
      if (!url) { setError(t('browserLibrary.invalidUrl')); return; }
      if (!draft.title.trim()) return;
      setBusy(true); setError('');
      void onSave({ ...draft, title: draft.title.trim(), url, description: draft.description.trim() })
        .then(onClose).catch(reason => setError(reason instanceof Error ? reason.message : t('browserBookmarks.saveFail')))
        .finally(() => setBusy(false));
    }}>
    <DialogTitle>{heading}</DialogTitle>
    <DialogDescription>{t('browserLibrary.savedLocally')}</DialogDescription>
    <label className={styles.field}>{t('browserLibrary.name')}<Input autoFocus required maxLength={120} value={draft.title} disabled={busy} onChange={event => setDraft({ ...draft, title: event.target.value })} /></label>
    <label className={styles.field}>{t('browserLibrary.url')}<Input required type="text" inputMode="url" autoCapitalize="none" spellCheck={false} maxLength={2048} placeholder="https://example.com" value={draft.url} disabled={busy} onChange={event => setDraft({ ...draft, url: event.target.value })} /></label>
    {categories ? <>
      <label className={styles.field}>{t('browserLibrary.category')}<Select value={draft.category} disabled={busy} onChange={event => setDraft({ ...draft, category: event.target.value })}>{categories.map(category => <option key={category.id} value={category.id}>{category.title}</option>)}</Select></label>
      <label className={styles.field}>{t('browserLibrary.description')}<Textarea maxLength={280} rows={2} value={draft.description} disabled={busy} onChange={event => setDraft({ ...draft, description: event.target.value })} /></label>
    </> : null}
    {error ? <p role="alert" className={styles.error}>{error}</p> : null}
    <DialogFooter><Button type="button" variant="ghost" disabled={busy} onClick={onClose}>{t('common.cancel')}</Button><Button type="submit" variant="primary" disabled={busy || !draft.title.trim() || !draft.url.trim()}>{busy ? t('browserLibrary.saving') : t('common.save')}</Button></DialogFooter>
  </Dialog>, document.body);
}
