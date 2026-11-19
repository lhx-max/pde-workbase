import { describe, expect, it } from 'vitest';
import { buildHandoffZip } from '../src/director/handoff-zip';

/** 独立的逐位 CRC-32 参考实现，不复用被测代码的查表法。 */
function referenceCrc(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

type Parsed = { name: string; flags: number; method: number; crc: number; size: number; offset: number; data: Uint8Array };

async function parseZip(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(bytes.buffer);
  const eocd = bytes.length - 22;
  expect(view.getUint32(eocd, true)).toBe(0x06054b50);
  const count = view.getUint16(eocd + 10, true);
  expect(view.getUint16(eocd + 8, true)).toBe(count);
  const centralSize = view.getUint32(eocd + 12, true);
  const centralOffset = view.getUint32(eocd + 16, true);
  expect(centralOffset + centralSize).toBe(eocd);
  const entries: Parsed[] = [];
  let cursor = centralOffset;
  for (let i = 0; i < count; i++) {
    expect(view.getUint32(cursor, true)).toBe(0x02014b50);
    const nameLength = view.getUint16(cursor + 28, true);
    const name = new TextDecoder().decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    const crc = view.getUint32(cursor + 16, true);
    const size = view.getUint32(cursor + 20, true);
    expect(view.getUint32(cursor + 24, true)).toBe(size);
    const offset = view.getUint32(cursor + 42, true);
    // 本地文件头必须与中央目录一致。
    expect(view.getUint32(offset, true)).toBe(0x04034b50);
    expect(view.getUint32(offset + 14, true)).toBe(crc);
    expect(view.getUint32(offset + 18, true)).toBe(size);
    expect(view.getUint32(offset + 22, true)).toBe(size);
    expect(view.getUint16(offset + 26, true)).toBe(nameLength);
    expect(new TextDecoder().decode(bytes.subarray(offset + 30, offset + 30 + nameLength))).toBe(name);
    const start = offset + 30 + nameLength;
    entries.push({
      name, flags: view.getUint16(cursor + 8, true), method: view.getUint16(cursor + 10, true),
      crc, size, offset, data: bytes.subarray(start, start + size),
    });
    cursor += 46 + nameLength;
  }
  expect(cursor).toBe(eocd);
  return { bytes, entries };
}

const live = () => new AbortController().signal;

describe('剪辑交接包 ZIP', () => {
  it('写出 stored 条目、UTF-8 文件名、正确的 CRC/大小/偏移和中央目录', async () => {
    const files = [
      { path: '台词.srt', content: new Blob(['1\n00:00:00,000 --> 00:00:01,000\n你好\n']) },
      { path: '配音源/1-take.wav', content: new Blob([Uint8Array.of(0, 1, 2, 255)]) },
      { path: 'empty.txt', content: new Blob([]) },
    ];
    const zip = await buildHandoffZip(files, live());
    expect(zip.type).toBe('application/zip');
    const { entries } = await parseZip(zip);
    expect(entries.map(entry => entry.name)).toEqual(['台词.srt', '配音源/1-take.wav', 'empty.txt']);
    expect(entries[0]!.offset).toBe(0);
    for (const [index, entry] of entries.entries()) {
      const original = new Uint8Array(await files[index]!.content.arrayBuffer());
      expect(entry.flags).toBe(0x0800);
      expect(entry.method).toBe(0);
      expect(entry.size).toBe(original.length);
      expect(entry.crc).toBe(referenceCrc(original));
      expect([...entry.data]).toEqual([...original]);
    }
    expect(entries[2]!.crc).toBe(0);
  });

  it('CRC 与已知值一致，并能跨 1 MB 分块正确累计', async () => {
    const { entries } = await parseZip(await buildHandoffZip([{ path: 'hello.txt', content: new Blob(['hello']) }], live()));
    expect(entries[0]!.crc).toBe(0x3610a686);
    const big = new Uint8Array(1024 * 1024 + 4097).map((_, i) => (i * 31 + 7) & 0xff);
    const parsed = await parseZip(await buildHandoffZip([{ path: 'big.bin', content: new Blob([big]) }], live()));
    expect(parsed.entries[0]!.crc).toBe(referenceCrc(big));
    expect(parsed.entries[0]!.size).toBe(big.length);
  });

  it('没有条目时只写结束记录', async () => {
    const zip = await buildHandoffZip([], live());
    expect(zip.size).toBe(22);
    expect((await parseZip(zip)).entries).toEqual([]);
  });

  it('写入当前时间的 DOS 日期', async () => {
    const { bytes } = await parseZip(await buildHandoffZip([{ path: 'a', content: new Blob(['a']) }], live()));
    const date = new DataView(bytes.buffer).getUint16(12, true);
    const now = new Date();
    expect(date >> 9).toBe(now.getFullYear() - 1980);
    expect((date >> 5) & 0xf).toBe(now.getMonth() + 1);
  });

  it.each(['a//b', '../x', 'a/./b', '/abs', 'dir/', 'a\\b', 'C:x', 'tab\tname'])('拒绝不安全路径 %j', async path => {
    await expect(buildHandoffZip([{ path, content: new Blob(['x']) }], live())).rejects.toThrow(/无效或重复/);
  });

  it('拒绝重复路径', async () => {
    const content = new Blob(['x']);
    await expect(buildHandoffZip([{ path: 'a.txt', content }, { path: 'a.txt', content }], live())).rejects.toThrow(/无效或重复/);
  });

  it('文件数达到 ZIP16 上限时拒绝', async () => {
    const entries = Array.from({ length: 0xffff }, (_, i) => ({ path: `f${i}`, content: new Blob([]) }));
    await expect(buildHandoffZip(entries, live())).rejects.toThrow(/数量超出上限/);
  });

  it('已取消或打包过程中取消时抛出取消原因', async () => {
    const reason = new Error('用户取消');
    const aborted = new AbortController();
    aborted.abort(reason);
    await expect(buildHandoffZip([], aborted.signal)).rejects.toBe(reason);
    const controller = new AbortController();
    const pending = buildHandoffZip([{ path: 'a', content: new Blob(['a']) }, { path: 'b', content: new Blob(['b']) }], controller.signal);
    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
  });
});
