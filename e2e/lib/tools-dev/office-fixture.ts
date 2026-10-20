import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import type { ToolsDevRuntime } from './runtime.js';

const execFileAsync = promisify(execFile);
export type OfficeFixtureKind = 'docx' | 'pptx' | 'xlsx';
const wordNs = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const drawingNs = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const sheetNs = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const relNs = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const slide = (title: string, body: string) => `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="${drawingNs}"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>${title}</a:t></a:r></a:p><a:p><a:r><a:t>${body}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`;

// Synthetic XML parser fixtures, not Office-authored documents or layout/fidelity samples.
// Only the OOXML parts consumed by the structured TEXT preview are included.
const parts: Record<OfficeFixtureKind, Record<string, string>> = {
  docx: {
    'word/document.xml': `<w:document xmlns:w="${wordNs}"><w:body><w:p><w:r><w:t>Canvas research</w:t></w:r><w:r><w:t>&amp; review</w:t></w:r></w:p><w:p><w:r><w:t>Second paragraph: text-only preview.</w:t></w:r></w:p></w:body></w:document>`,
  },
  pptx: {
    'ppt/slides/slide2.xml': slide('Delivery checklist', 'Download keeps the original bytes.'),
    'ppt/slides/slide1.xml': slide('Canvas &amp; references', 'First slide: text-only preview.'),
  },
  xlsx: {
    'xl/workbook.xml': `<workbook xmlns="${sheetNs}" xmlns:r="${relNs}"><sheets><sheet name="Research &amp; costs" sheetId="1" r:id="rId1"/><sheet name="Summary" sheetId="2" r:id="rId2"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${relNs}/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId2" Type="${relNs}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
    'xl/sharedStrings.xml': `<sst xmlns="${sheetNs}" count="2" uniqueCount="2"><si><t>Item &amp; source</t></si><si><t>Canvas sample</t></si></sst>`,
    'xl/worksheets/sheet2.xml': `<worksheet xmlns="${sheetNs}"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="inlineStr"><is><t>Cost</t></is></c></row><row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2"><v>42</v></c></row></sheetData></worksheet>`,
    'xl/worksheets/sheet1.xml': `<worksheet xmlns="${sheetNs}"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Text-only totals</t></is></c><c r="B1"><v>42</v></c></row></sheetData></worksheet>`,
  },
};

/** All staging stays under the worker-owned root; runtime teardown owns cleanup. */
export async function createOfficeTextFixture(runtime: Pick<ToolsDevRuntime, 'root'>, kind: OfficeFixtureKind) {
  const root = await mkdtemp(path.join(runtime.root, `office-${kind}-`));
  const source = path.join(root, 'parts');
  await mkdir(source);
  const entries = Object.keys(parts[kind]).sort();
  const timestamp = new Date('2000-01-01T00:00:00Z');
  for (const entry of entries) {
    const file = path.join(source, entry);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, parts[kind][entry]!, { flag: 'wx' });
    await chmod(file, 0o644);
    await utimes(file, timestamp, timestamp);
  }
  const name = `Text-preview.${kind}`;
  const archive = path.join(root, name);
  // Sorted entries, fixed timestamps/modes, no extra attributes and no compression:
  // repeat invocations produce identical bytes, independent of the temporary path.
  await execFileAsync('zip', ['-X', '-0', '-q', archive, ...entries], {
    cwd: source, env: { ...process.env, TZ: 'UTC', COPYFILE_DISABLE: '1' }, timeout: 10_000,
  });
  return { name, bytes: await readFile(archive) };
}
