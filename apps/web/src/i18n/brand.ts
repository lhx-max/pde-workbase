import { getWebProductName } from '../product-runtime';

/**
 * Rewrite retired or build-time product names to the active product identity.
 *
 * Translation bundles are authored against whichever product manifest was
 * active at authoring time, so they hardcode that manifest's displayName (and
 * older upstream names). OEM builds select a different manifest, so every
 * user-facing string has to be normalized before it is rendered — otherwise a
 * `bezierdesign` build would still show `安全设计工作台`.
 *
 * Both translation pipelines must funnel through here:
 *   - `locales/*.ts`  → `renderTranslation()` in `index.tsx`
 *   - `content.*.ts`  → the `localize*()` helpers in `content.ts`
 */
export function applyBrandName(text: string): string {
  const productName = getWebProductName();
  return text
    .replace(/\b(?:Bezier\s+Design|Loom)\b/gi, productName)
    .replace(/安全设计工作台/g, productName)
    .replace(/@BezierHQ/gi, productName)
    .replace(/@bezier\.ai/gi, productName)
    .replace(/\bOpen[\s-]?Design\b/g, productName)
    .replace(/\bDesign\s*AI\s*Cloud\b/gi, `${productName}云服务`)
    .replace(/\bDesign\s*AI\b/gi, productName);
}
