// Adapted from the workspace ZIP encoder in apps/web/src/runtime/zip.ts.
interface ZipEntry {
  path: string;
  content: Blob;
}

const CRC_TABLE: number[] = (() => {
  const t: number[] = new Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    t[n] = c >>> 0;
  }
  return t;
})();

async function crc32(blob: Blob, signal: AbortSignal): Promise<number> {
  let crc = 0xffffffff;
  // Bound how much media is read into memory and allow cancellation between reads.
  const chunkSize = 1024 * 1024;
  for (let offset = 0; offset < blob.size; offset += chunkSize) {
    signal.throwIfAborted();
    const bytes = new Uint8Array(await blob.slice(offset, offset + chunkSize).arrayBuffer());
    for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosTime(d: Date): { time: number; date: number } {
  const time =
    ((d.getHours() & 0x1f) << 11) |
    ((d.getMinutes() & 0x3f) << 5) |
    ((Math.floor(d.getSeconds() / 2)) & 0x1f);
  const date =
    (Math.max(0, Math.min(127, d.getFullYear() - 1980)) << 9) |
    (((d.getMonth() + 1) & 0xf) << 5) |
    (d.getDate() & 0x1f);
  return { time, date };
}

export async function buildHandoffZip(entries: readonly ZipEntry[], signal: AbortSignal): Promise<Blob> {
  signal.throwIfAborted();
  if (entries.length >= 0xffff) throw new Error('剪辑交接包的文件数量超出上限。');
  const paths = new Set<string>();
  const enc = new TextEncoder();
  const now = dosTime(new Date());

  const localChunks: BlobPart[] = [];
  const centralChunks: BlobPart[] = [];
  let offset = 0;
  let centralSize = 0;

  for (const entry of entries) {
    if (paths.has(entry.path) || /[\\:\p{Cc}]/u.test(entry.path)
      || entry.path.split('/').some(part => !part || part === '.' || part === '..')) {
      throw new Error('剪辑交接包包含无效或重复的文件名。');
    }
    paths.add(entry.path);
    const nameBytes = enc.encode(entry.path);
    const size = entry.content.size;
    const entryOffset = offset;
    offset += 30 + nameBytes.length + size;
    centralSize += 46 + nameBytes.length;
    if (nameBytes.length > 0xffff || offset + centralSize + 22 >= 0xffffffff) {
      throw new Error('剪辑交接包大小超出 ZIP 格式上限。');
    }
    const crc = await crc32(entry.content, signal);
    const flags = 0x0800; // UTF-8 filenames.

    // Local file header (30 bytes + name).
    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); // signature
    lv.setUint16(4, 20, true);          // version needed
    lv.setUint16(6, flags, true);       // flags (bit 11 = UTF-8 name)
    lv.setUint16(8, 0, true);           // method: stored
    lv.setUint16(10, now.time, true);   // mod time
    lv.setUint16(12, now.date, true);   // mod date
    lv.setUint32(14, crc, true);        // crc-32
    lv.setUint32(18, size, true);       // compressed size
    lv.setUint32(22, size, true);       // uncompressed size
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);
    local.set(nameBytes, 30);
    localChunks.push(local.buffer, entry.content);

    // Central directory header (46 bytes + name).
    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);  // signature
    cv.setUint16(4, 20, true);           // version made by
    cv.setUint16(6, 20, true);           // version needed
    cv.setUint16(8, flags, true);        // flags (bit 11 = UTF-8 name)
    cv.setUint16(10, 0, true);           // method
    cv.setUint16(12, now.time, true);
    cv.setUint16(14, now.date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, size, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true);           // extra len
    cv.setUint16(32, 0, true);           // comment len
    cv.setUint16(34, 0, true);           // disk number
    cv.setUint16(36, 0, true);           // internal attrs
    cv.setUint32(38, 0, true);           // external attrs
    cv.setUint32(42, entryOffset, true);      // relative offset of local header
    central.set(nameBytes, 46);
    centralChunks.push(central.buffer);
  }

  // End of central directory record.
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, 0, true);

  signal.throwIfAborted();
  return new Blob([...localChunks, ...centralChunks, eocd.buffer], { type: 'application/zip' });
}
