import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { DeckTemplateJsonSchema, DeckInstanceJsonSchema } from '../src/deck-template/schemas.js';

const directory = new URL('../../../specs/schemas/', import.meta.url);
const check = process.argv.includes('--check');
if (process.argv.slice(2).some(arg => arg !== '--check')) throw new Error('Usage: export-deck-schemas.ts [--check]');
if (!check) await mkdir(directory, { recursive: true });
for (const [name, schema] of [['deck-template.v1.schema.json', DeckTemplateJsonSchema], ['deck-instance.v1.schema.json', DeckInstanceJsonSchema]] as const) {
  const target = new URL(name, directory);
  const expected = JSON.stringify(schema, null, 2) + '\n';
  if (check) {
    if (await readFile(target, 'utf8') !== expected) throw new Error(`Stale generated schema: ${name}`);
  } else await writeFile(target, expected);
  console.log(`${check ? 'Checked' : 'Generated'} ${fileURLToPath(target)}`);
}
