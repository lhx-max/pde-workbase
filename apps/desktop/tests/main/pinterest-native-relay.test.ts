import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { PINTEREST_CONNECTOR_ID, preparePinterestNativeRelay } from '../../src/main/pinterest-native-relay.js';

async function emitPinterestHost(root: string): Promise<string> {
  const hostDir = join(root, 'host');
  await mkdir(join(hostDir, 'locales'), { recursive: true });
  const transpile = async (from: string, to: string) => {
    const source = await readFile(fileURLToPath(new URL(from, import.meta.url)), 'utf8');
    await writeFile(to, ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText);
  };
  await transpile('../../src/main/pinterest-native-host.cts', join(hostDir, 'native.cjs'));
  await transpile('../../src/main/locales/native-host-ui.cts', join(hostDir, 'locales', 'native-host-ui.cjs'));
  return join(hostDir, 'native.cjs');
}

describe('Pinterest native pairing', () => {
  it('pairs through framed native messaging without clipboard, URLs or cookie files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'da-pin-native-test-'));
    const script = await emitPinterestHost(root);
    const relay = await preparePinterestNativeRelay({ code: 'synthetic-pairing-only', executable: process.execPath, hostScript: script, runtimeDir: join(root, 'runtime'), registryDir: join(root, 'registry') });
    try {
      const manifest = JSON.parse(await readFile(join(root, 'registry/com.canvas_workspace.pinterest_auth.json'), 'utf8'));
      expect(manifest.allowed_origins).toEqual([`chrome-extension://${PINTEREST_CONNECTOR_ID}/`]);
      expect(await readFile(manifest.path, 'utf8')).not.toContain('synthetic-pairing-only');
      const call = (origin: string) => new Promise<{ exit: number | null; value?: { code?: string; error?: string } }>((resolve, reject) => {
        const child = spawn(manifest.path, [origin], { stdio: ['pipe', 'pipe', 'pipe'] });
        let data = Buffer.alloc(0);
        child.stdout.on('data', chunk => { data = Buffer.concat([data, chunk]); });
        child.on('error', reject);
        child.on('close', exit => {
          try { resolve({ exit, value: data.length > 4 ? JSON.parse(data.subarray(4).toString()) : undefined }); } catch (error) { reject(error); }
        });
        const body = Buffer.from(JSON.stringify({ type: 'claim' })); const header = Buffer.alloc(4); header.writeUInt32LE(body.length);
        child.stdin.on('error', () => undefined); child.stdin.end(Buffer.concat([header, body]));
      });
      expect((await call(`chrome-extension://${'a'.repeat(32)}/`)).exit).toBe(1);
      expect((await call(`chrome-extension://${PINTEREST_CONNECTOR_ID}/`)).value).toEqual({ code: 'synthetic-pairing-only' });
      expect((await call(`chrome-extension://${PINTEREST_CONNECTOR_ID}/`)).value?.error).toBeTruthy();
    } finally { relay.close(); if (!root.startsWith(join(tmpdir(), 'da-pin-native-test-'))) throw new Error('Unexpected test directory'); await rm(root, { recursive: true, force: true }); }
  });
});
