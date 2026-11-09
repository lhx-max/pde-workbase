import { useEffect, useRef, useState } from 'react';
import { Button, Input, Popover, PopoverContent, PopoverTrigger } from '@/src/components/ui';
import { useI18n } from '@/src/i18n';
import { Icon } from './Icon';
import { useAssetDetailPortalContainer } from './AssetDetailDialog';
import styles from './PersonalAssetLibrary.module.css';

/** Asset inspector tag picker. Uses the shared overlay, including in iframe previews. */
export function AssetTagPicker({ tags, availableTags, busy, draft, onDraft, onAdd, onToggle }: {
  tags: string[]; availableTags: string[]; busy: boolean; draft: string;
  onDraft: (value: string) => void; onAdd: (value: string) => void; onToggle: (value: string) => void;
}) {
  const { t } = useI18n();
  const portalContainer = useAssetDetailPortalContainer();
  const [open, setOpen] = useState(false);
  const content = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!content.current?.contains(target) && !trigger.current?.contains(target)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault(); event.stopPropagation(); setOpen(false);
    };
    // Events inside embedded web previews do not bubble into the parent document.
    const blur = () => { if (document.activeElement instanceof HTMLIFrameElement) setOpen(false); };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', escape, true);
    window.addEventListener('blur', blur);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', escape, true);
      window.removeEventListener('blur', blur);
    };
  }, [open]);
  const query = draft.trim();
  const options = availableTags.filter(tag => tag.toLowerCase().includes(query.toLowerCase()));
  const canCreate = query && !availableTags.some(tag => tag.toLowerCase() === query.toLowerCase());
  return <Popover open={open} onOpenChange={setOpen}>
    <span ref={trigger} className={!tags.length ? styles.addProperty : undefined}>
      <PopoverTrigger asChild><Button variant="subtle" size={tags.length ? 'icon' : 'sm'} className={!tags.length ? styles.addProperty : undefined} aria-label={t('asset.tag.add')}><Icon name="plus" size={14} />{!tags.length && t('asset.tag.add')}</Button></PopoverTrigger>
    </span>
    <PopoverContent portalContainer={portalContainer ?? undefined} side="left" align="start" className={styles.tagPicker} aria-label={t('asset.tag.choose')}>
      <div ref={content}>
        <form className={styles.tagEntry} onSubmit={event => { event.preventDefault(); if (!busy && query) onAdd(query); }}>
          <Icon name="search" size={17} />
          <Input aria-label={t('asset.tag.add')} placeholder={t('asset.tag.searchPlaceholder')} value={draft} maxLength={120} onChange={event => onDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && event.nativeEvent.isComposing) event.preventDefault(); }} />
          {draft && <Button variant="ghost" size="icon" aria-label={t('asset.tag.clearSearch')} onClick={() => onDraft('')}><Icon name="close" size={14} /></Button>}
        </form>
        <div className={styles.tagOptions}>
          {canCreate && <Button className={styles.createTag} variant="subtle" size="sm" aria-label={t('asset.tag.confirmAdd')} disabled={busy} onClick={() => onAdd(query)}><Icon name="plus" size={14} /><span>{t('asset.tag.createNamed', { name: query })}</span></Button>}
          {options.map(tag => <Button key={tag} size="sm" variant={tags.includes(tag) ? 'subtle' : 'ghost'} aria-pressed={tags.includes(tag)} disabled={busy} onClick={() => onToggle(tag)}><span>{tag}</span>{tags.includes(tag) && <Icon name="check" size={12} />}</Button>)}
          {!query && !options.length && <p className={styles.inspectorHint}>{t('asset.tag.emptyHint')}</p>}
        </div>
        <div className={styles.tagPickerHint}>{t('asset.tag.enterAdd')}<span>{t('asset.tag.escClose')}</span></div>
      </div>
    </PopoverContent>
  </Popover>;
}
