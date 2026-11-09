import { Button, Input } from '@/src/components/ui';
import { Icon } from './Icon';
import styles from './AssetSearchField.module.css';

/** Shared asset search: the catalogue and personal library use the same control. */
export function AssetSearchField({ value, onChange, label, placeholder, clearLabel, className = '' }: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder: string;
  clearLabel: string;
  className?: string;
}) {
  return <div data-slot="asset-search-field" className={`${styles.root} ${className}`}>
    <Icon name="search" size={15} />
    <Input type="search" aria-label={label} placeholder={placeholder} value={value} onChange={e => onChange(e.target.value)} />
    {value ? <Button variant="ghost" size="icon" aria-label={clearLabel} onClick={() => onChange('')}><Icon name="close" size={13} /></Button> : null}
  </div>;
}
