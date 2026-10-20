import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createProject } from '@/api';
import { useToolsDev } from '@/vitest/suite';
import { repositoryRoot } from '@/tools-dev/runtime';

const exec = promisify(execFile);

describe('real CLI to canvas HTTP API', () => {
  const runtime = useToolsDev();
  async function cli(method: string, route: string, body?: unknown): Promise<unknown> {
    const { serverUrl } = runtime();
    const args = [path.join(repositoryRoot, 'apps/server/dist/cli.js'), 'request', method, route, '--server-url', serverUrl, '--json'];
    if (body !== undefined) {
      const inputPath = path.join(runtime().root, `canvas-cli-${randomUUID()}.json`);
      await writeFile(inputPath, JSON.stringify(body));
      args.push('--body-file', inputPath);
    }
    const { stdout } = await exec(process.execPath, args, {
      env: { ...process.env, CANVAS_AUTH_TOKEN: '' },
      maxBuffer: 2 * 1024 * 1024,
    });
    return JSON.parse(stdout);
  }

  it('reads capabilities and completes operation/replay/receipt over the public CLI', async () => {
    const projectId = await createProject(runtime(), 'CLI canvas owner');
    const prefix = `/api/projects/${encodeURIComponent(projectId)}/canvas`;
    const capability = await cli('GET', `${prefix}/capabilities`) as { protocolVersion: number; operations: string[] };
    expect(capability).toMatchObject({ protocolVersion: 1 });
    expect(capability.operations).toContain('node.create');
    const original = await cli('GET', `${prefix}/state`) as { state: Record<string, unknown>; revision: number };
    const operationId = randomUUID();
    const nodeId = `text-${randomUUID()}`;
    const input = { operationId, baseRevision: original.revision,
      operations: [{ type: 'node.create', node: { id: nodeId, kind: 'text', x: 10, y: 20, text: 'CLI result' } }] };
    const result = await cli('POST', `${prefix}/operations`, input) as { receipt: { operationId: string }; revision: number; replayed: boolean };
    expect(result).toMatchObject({ receipt: { operationId }, replayed: false });
    expect(await cli('GET', `${prefix}/operations/${operationId}`)).toMatchObject({ receipt: result.receipt });
    expect(await cli('POST', `${prefix}/operations`, input)).toMatchObject({ replayed: true, revision: result.revision });
    const saved = await cli('GET', `${prefix}/state`) as { state: { workbenchBasicNodes: Array<{ id: string; text: string }> }; revision: number };
    expect(saved.revision).toBe(result.revision);
    expect(saved.state.workbenchBasicNodes).toContainEqual(expect.objectContaining({ id: nodeId, text: 'CLI result' }));
  });
});
