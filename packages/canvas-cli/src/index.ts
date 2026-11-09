#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
// Built from the existing canonical HTTP client, without the server runtime.
import { runHttpCli } from '../../../apps/server/src/http-cli.js';

const args = process.argv.slice(2);
if (args.includes('--version')) {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  console.log(manifest.version);
} else {
  try { await runHttpCli(args.length ? args : ['--help']); }
  catch (error) { console.error(error instanceof Error ? error.message : 'Canvas CLI failed'); process.exitCode = 1; }
}
