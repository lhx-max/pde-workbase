import { browserLogoPath } from '../browser-resources/browser-logo';
import styles from './ProductLogo.module.css';

/** Original static capture-toolbar mark, independent from product manifests. */
export function ProductLogo({ className = '', decorative = false }: { className?: string; animated?: boolean; decorative?: boolean }) {
  return <span className={`${styles.logo} ${className}`} role={decorative ? undefined : 'img'} aria-label={decorative ? undefined : 'LOOM'} aria-hidden={decorative || undefined} data-product-logo="loom">
    <span className={styles.vector} aria-hidden="true"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 430 166" role="img" aria-label="LOOM"><path fill="currentColor" fillRule="evenodd" d={browserLogoPath} /></svg></span>
  </span>;
}
