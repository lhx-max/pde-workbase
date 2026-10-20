import { useState } from 'react';
import { createPortal } from 'react-dom';
import type { BrowserBookmark } from '@bezier/contracts';
import { Button, ConfirmDialog, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent } from './ui';
import { Icon } from './Icon';
import { useT } from '../i18n';
import { browserHttpUrl, reloadBrowserPreferences, updateBrowserBookmarks, useBrowserPreferences } from '../browser-resources/browser-preferences';
import { BrowserSiteDialog } from './BrowserSiteDialog';
import styles from './BrowserBookmarks.module.css';

export function BrowserBookmarks({ url, title, onNavigate }: { url: string; title: string; onNavigate: (url: string) => void }) {
  const t = useT();
  const { bookmarks: items, ready, error } = useBrowserPreferences();
  const [editor, setEditor] = useState<{ item?: BrowserBookmark; isNew: boolean } | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<BrowserBookmark | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const currentUrl = browserHttpUrl(url);
  const current = items.find(item => item.url === currentUrl);
  const locked = !ready || busy || error;
  const add = () => setEditor({ isNew: true, ...(currentUrl ? { item: { title: title || new URL(currentUrl).hostname, url: currentUrl } } : {}) });
  const move = (item: BrowserBookmark, direction: number) => {
    setBusy(true); setMessage('');
    void updateBrowserBookmarks(list => {
      const from = list.findIndex(entry => entry.url === item.url);
      const to = from + direction;
      if (from < 0 || to < 0 || to >= list.length) return list;
      const next = [...list]; [next[from], next[to]] = [next[to]!, next[from]!]; return next;
    }).catch(() => setMessage(t('browserBookmarks.saveFail'))).finally(() => setBusy(false));
  };
  const actions = (item: BrowserBookmark, index: number) => <>
    <DropdownMenuItem onSelect={() => onNavigate(item.url)}><Icon name="external-link" size={14} />{t('designBrowser.reference.open')}</DropdownMenuItem>
    <DropdownMenuItem disabled={locked} onSelect={() => setEditor({ item, isNew: false })}><Icon name="edit" size={14} />{t('browserLibrary.editBookmark')}</DropdownMenuItem>
    <DropdownMenuSeparator />
    <DropdownMenuItem disabled={locked || index === 0} onSelect={() => move(item, -1)}><Icon name="arrow-left" size={14} />{t('browserLibrary.moveLeft')}</DropdownMenuItem>
    <DropdownMenuItem disabled={locked || index === items.length - 1} onSelect={() => move(item, 1)}><Icon name="arrow-right" size={14} />{t('browserLibrary.moveRight')}</DropdownMenuItem>
    <DropdownMenuSeparator />
    <DropdownMenuItem disabled={locked} onSelect={() => setDeleting(item)}><Icon name="trash" size={14} />{t('common.delete')}</DropdownMenuItem>
  </>;
  return <>
    <div className={styles.bar}>
      <nav className={styles.bookmarks} aria-label={t('browserBookmarks.navAria')}
        onWheel={event => { if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) event.currentTarget.scrollLeft += event.deltaY; }}>
        {items.map((item, index) => <span className={styles.bookmark} key={item.url}
          onContextMenu={event => { event.preventDefault(); setMenu(item.url); }}>
          <Button type="button" variant="ghost" className={styles.link} title={item.url}
            onFocus={event => event.currentTarget.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })}
            onClick={() => onNavigate(item.url)}><BookmarkIcon url={item.url} /><span>{item.title}</span></Button>
          <DropdownMenu open={menu === item.url} onOpenChange={open => setMenu(open ? item.url : null)}>
            <DropdownMenuTrigger asChild><Button type="button" variant="ghost" className={styles.itemMenu} aria-label={t('browserLibrary.bookmarkActions', { name: item.title })}><Icon name="more-horizontal" size={12} /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="start">{actions(item, index)}</DropdownMenuContent>
          </DropdownMenu>
        </span>)}
        {items.length === 0 ? <span className={styles.empty}>{t('browserLibrary.emptyBookmarks')}</span> : null}
      </nav>
      <div className={styles.controls}>
        <Button type="button" variant="ghost" className={styles.tool} disabled={locked || (!current && items.length >= 100)}
          aria-label={current ? t('browserLibrary.editBookmark') : t('browserLibrary.addBookmark')}
          title={current ? t('browserLibrary.editBookmark') : t('browserLibrary.addBookmark')}
          onClick={() => current ? setEditor({ item: current, isNew: false }) : add()}>
          <Icon name="star" size={15} className={current ? styles.saved : undefined} />
        </Button>
        <DropdownMenu><DropdownMenuTrigger asChild><Button type="button" variant="ghost" className={styles.tool} aria-label={t('browserBookmarks.manageAria')}><Icon name="chevron-right" size={15} /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end" className={styles.overflow}>
            <DropdownMenuItem disabled={locked || items.length >= 100} onSelect={add}><Icon name="plus" size={14} />{t('browserLibrary.addBookmark')}</DropdownMenuItem>
            {items.length ? <DropdownMenuSeparator /> : null}
            {items.map((item, index) => <DropdownMenuSub key={item.url}><DropdownMenuSubTrigger><BookmarkIcon url={item.url} /><span className={styles.menuTitle}>{item.title}</span></DropdownMenuSubTrigger><DropdownMenuSubContent>{actions(item, index)}</DropdownMenuSubContent></DropdownMenuSub>)}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
    {error || message ? <div className={styles.status} role="status">{message || t('browserLibrary.loadFail')}<Button type="button" variant="ghost" onClick={() => { setMessage(''); void reloadBrowserPreferences(); }}>{t('common.retry')}</Button></div> : null}
    {editor ? <BrowserSiteDialog heading={t(editor.isNew ? 'browserLibrary.addBookmark' : 'browserLibrary.editBookmark')} initial={editor.item}
      onClose={() => setEditor(null)} onSave={async draft => {
        try {
          await updateBrowserBookmarks(list => {
            const duplicate = list.some(item => item.url === draft.url && (editor.isNew || item.url !== editor.item?.url));
            if (duplicate) throw new Error(t('browserLibrary.duplicate'));
            if (editor.isNew && list.length >= 100) throw new Error(t('browserLibrary.limit'));
            const next = { title: draft.title, url: draft.url };
            return editor.isNew ? [...list, next] : list.map(item => item.url === editor.item?.url ? next : item);
          });
        } catch (reason) {
          if (reason instanceof Error && [t('browserLibrary.duplicate'), t('browserLibrary.limit')].includes(reason.message)) throw reason;
          throw new Error(t('browserBookmarks.saveFail'));
        }
      }} /> : null}
    {deleting ? createPortal(<ConfirmDialog title={t('browserLibrary.deleteBookmark')} description={t('browserLibrary.removeDescription', { name: deleting.title })}
      confirmLabel={busy ? t('browserLibrary.saving') : t('common.delete')} cancelLabel={t('common.cancel')}
      onCancel={() => { if (!busy) setDeleting(null); }} onConfirm={() => {
        if (busy) return; setBusy(true); setMessage('');
        void updateBrowserBookmarks(list => list.filter(item => item.url !== deleting.url)).then(() => setDeleting(null))
          .catch(() => { setMessage(t('browserBookmarks.saveFail')); setDeleting(null); }).finally(() => setBusy(false));
      }} />, document.body) : null}
  </>;
}

function BookmarkIcon({ url }: { url: string }) {
  const [failed, setFailed] = useState(false);
  // Do not disclose user-added bookmark hostnames to a third-party favicon service.
  return failed ? <Icon name="globe" size={14} /> : <img className={styles.favicon} src={new URL('/favicon.ico', url).href} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />;
}
