/** Collect likely original-image URLs from an <img> (and its <picture>).
 *  Pure — no chrome, no fetch — so it can be unit-tested. */

const FULL_ATTRS = [
  'data-zoom-image', 'data-zoom', 'data-hi-res', 'data-hires', 'data-highres',
  'data-full', 'data-full-url', 'data-full-src', 'data-original', 'data-orig-src',
  'data-large', 'data-large-src', 'data-old-hires',
];
const LAZY_ATTRS = [
  'data-src', 'data-lazy-src', 'data-lazy', 'data-url', 'data-image', 'data-img',
];
const SRCSET_ATTRS = ['srcset', 'data-srcset', 'data-lazy-srcset'];

export interface ImageLike {
  src: string;
  currentSrc: string;
  srcset: string;
  getAttribute(name: string): string | null;
  parentElement: { tagName: string; querySelectorAll(sel: string): ArrayLike<{ getAttribute(name: string): string | null }> } | null;
}

export function parseSrcset(srcset: string): Array<{ url: string; score: number }> {
  const out: Array<{ url: string; score: number }> = [];
  for (const part of srcset.split(',')) {
    const bits = part.trim().split(/\s+/);
    const url = bits[0];
    if (!url) continue;
    const desc = bits[1] ?? '';
    let score = 1;
    if (desc.endsWith('w')) score = Number.parseFloat(desc) || 1;
    else if (desc.endsWith('x')) score = (Number.parseFloat(desc) || 1) * 1000;
    out.push({ url, score });
  }
  return out.sort((a, b) => b.score - a.score);
}

export function resolveImageUrl(raw: string, pageHref: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === '#' || /^javascript:/i.test(trimmed)) return null;
  if (trimmed.startsWith('blob:') || trimmed.startsWith('data:')) return trimmed;
  try {
    return new URL(trimmed, pageHref).href;
  } catch {
    return null;
  }
}

export function collectImageUrls(img: ImageLike, pageHref: string): string[] {
  const ranked: Array<{ url: string; score: number }> = [];
  const push = (raw: string | null | undefined, score: number) => {
    if (!raw) return;
    const url = resolveImageUrl(raw, pageHref);
    if (url) ranked.push({ url, score });
  };

  for (const attr of SRCSET_ATTRS) {
    const value = attr === 'srcset' ? (img.srcset || img.getAttribute('srcset')) : img.getAttribute(attr);
    if (!value) continue;
    for (const entry of parseSrcset(value)) push(entry.url, 10_000 + entry.score);
  }

  const parent = img.parentElement;
  if (parent && parent.tagName.toUpperCase() === 'PICTURE') {
    const sources = parent.querySelectorAll('source');
    for (let i = 0; i < sources.length; i += 1) {
      const srcset = sources[i]!.getAttribute('srcset');
      if (!srcset) continue;
      for (const entry of parseSrcset(srcset)) push(entry.url, 9_000 + entry.score);
    }
  }

  push(img.currentSrc, 8_000);
  for (const attr of FULL_ATTRS) push(img.getAttribute(attr), 7_000);
  push(img.src, 6_000);
  for (const attr of LAZY_ATTRS) push(img.getAttribute(attr), 5_000);

  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of ranked.sort((a, b) => b.score - a.score)) {
    if (seen.has(item.url)) continue;
    seen.add(item.url);
    out.push(item.url);
  }
  return out;
}
