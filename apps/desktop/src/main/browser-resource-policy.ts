import type { BrowserResourceKind } from '@bezier/contracts';

/** Display/provenance only. Original URLs remain inside the native grant. */
export function safeResourceUrl(value: string): string {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    url.username = ''; url.password = ''; url.search = ''; url.hash = '';
    return url.href.slice(0, 2048);
  } catch { return ''; }
}
export function resourceName(url: string): string {
  try {
    const name = decodeURIComponent(new URL(url).pathname.split('/').pop() || 'resource');
    const safe = name.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '').replace(/\.+$/, '').slice(0, 120) || 'resource';
    return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(safe) ? `_${safe}` : safe;
  } catch { return 'resource'; }
}
const formats: Record<string, { kind: BrowserResourceKind; extension: string }> = {
  'image/png': { kind: 'image', extension: 'png' },
  'image/jpeg': { kind: 'image', extension: 'jpg' },
  'image/gif': { kind: 'image', extension: 'gif' },
  'image/webp': { kind: 'image', extension: 'webp' },
  'image/avif': { kind: 'image', extension: 'avif' },
  'audio/mpeg': { kind: 'audio', extension: 'mp3' },
  'audio/wav': { kind: 'audio', extension: 'wav' },
  'audio/ogg': { kind: 'audio', extension: 'ogg' },
  'audio/flac': { kind: 'audio', extension: 'flac' },
  'audio/mp4': { kind: 'audio', extension: 'm4a' },
  'video/mp4': { kind: 'video', extension: 'mp4' },
  'video/webm': { kind: 'video', extension: 'webm' },
  'font/woff': { kind: 'font', extension: 'woff' },
  'font/woff2': { kind: 'font', extension: 'woff2' },
  'font/ttf': { kind: 'font', extension: 'ttf' },
  'font/otf': { kind: 'font', extension: 'otf' },
};
export function supportedResourceMime(mime: string): boolean { return Object.hasOwn(formats, mime); }
export function normalizedResourceMime(value: string | undefined): string | undefined {
  const mime = value?.split(';')[0]?.trim().toLowerCase();
  return mime && /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(mime) ? mime : undefined;
}
export function resourceKind(url: string, mime?: string): BrowserResourceKind | undefined {
  let path: string;
  try { path = new URL(url).pathname.toLowerCase(); } catch { return undefined; }
  // Segmented/encrypted media is metadata-only, even with a misleading MIME.
  if (/\.(m3u8?|mpd|m4s|ts|key)$/.test(path) || /mpegurl|dash\+xml|mp2t/.test(mime ?? '')) return 'stream';
  if (path.endsWith('.svg') || mime === 'image/svg+xml') return 'svg';
  if (mime && formats[mime]) return formats[mime].kind;
  return Object.values(formats).find(format => path.endsWith(`.${format.extension}`))?.kind
    ?? (/\.jpeg$/.test(path) ? 'image' : undefined);
}
/** MIME is necessary but never sufficient; deliberately excludes active/unknown formats. */
export function verifyResourceBytes(bytes: Buffer, mime: string): boolean {
  const text = (start: number, end: number) => bytes.toString('ascii', start, end);
  if (bytes.length < 12 || !formats[mime]) return false;
  switch (mime) {
    case 'image/png': return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    case 'image/jpeg': return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    case 'image/gif': return ['GIF87a', 'GIF89a'].includes(text(0, 6));
    case 'image/webp': return text(0, 4) === 'RIFF' && text(8, 12) === 'WEBP';
    case 'image/avif': return text(4, 8) === 'ftyp' && ['avif', 'avis'].includes(text(8, 12));
    case 'audio/mpeg': return text(0, 3) === 'ID3' || (bytes[0] === 255 && (bytes[1]! & 0xe0) === 0xe0);
    case 'audio/wav': return text(0, 4) === 'RIFF' && text(8, 12) === 'WAVE';
    case 'audio/ogg': return text(0, 4) === 'OggS';
    case 'audio/flac': return text(0, 4) === 'fLaC';
    case 'audio/mp4': case 'video/mp4': return text(4, 8) === 'ftyp' && ['isom', 'iso2', 'mp41', 'mp42', 'M4A ', 'M4V '].includes(text(8, 12));
    case 'video/webm': return bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
    case 'font/woff': return text(0, 4) === 'wOFF';
    case 'font/woff2': return text(0, 4) === 'wOF2';
    case 'font/ttf': return bytes.readUInt32BE(0) === 0x00010000;
    case 'font/otf': return text(0, 4) === 'OTTO';
    default: return false;
  }
}
export function readResourceName(url: string, mime: string): string {
  const stem = resourceName(url).replace(/\.[^.]*$/, '').slice(0, 100) || 'resource';
  return `${stem}.${formats[mime]!.extension}`;
}
