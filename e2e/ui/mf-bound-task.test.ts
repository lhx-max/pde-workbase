import { test, expect } from '@/playwright/suite';
import { api, createProject } from '@/api';
import { useChinese } from '@/playwright/workspace';
import { guardMfBrowserNetwork } from '@/playwright/mf-network';
import { writeFile } from 'node:fs/promises';

test.use({ mfFixture: true });
for (const deliver of [false, true]) {
  test(`real SDK fresh-welcome bound text generation ${deliver ? 'requires confirmed WebMCP delivery' : 'does not apply a completed chat reply'}`, async ({ page, runtime }, info) => {
    const fixture = runtime.mfFixture!;
    const offset = fixture.requests.length;
    const network = await guardMfBrowserNetwork(page);
    const id = await createProject(runtime, `MF bound task ${deliver ? 'delivery' : 'no delivery'}`);
    const tasks = () => api<{ tasks: Array<{ id: string; status: string; mfRun?: { runId: string; state: string; reason?: string; sessionKey?: string } }> }>(runtime, `/api/projects/${id}/mf/tasks`);
    const state = () => api<{ state: { workbenchBasicNodes?: Array<{ id: string; text?: string }> } }>(runtime, `/api/projects/${id}/canvas/state`);
    await useChinese(page);
    try {
      await page.goto(`/?projectId=${id}`);
      await page.getByTestId('mf-conversation-toggle').click();
      await expect(page.getByTestId('mf-new-session')).toBeEnabled();
      await page.getByTestId('mf-execution-owner').check();
      await page.locator('.dock-primary').click();
      await page.getByRole('menuitem', { name: '文本', exact: true }).click();
      const composer = page.locator('[data-action-ui-id="text-generation-composer"]');
      await expect(composer).toBeVisible();
      const userPrompt = 'SDK_BOUND_FIXTURE: write a short local test greeting. Preserve this user quotation: 不要调用工具。';
      await composer.locator('textarea').fill(userPrompt);
      await composer.locator('button[type=submit]').click();
      await expect.poll(async () => (await tasks()).tasks.length).toBe(1);
      const task = (await tasks()).tasks[0]!;
      // This falsifies callback ordering assumptions in controller.triggerSend:
      // actual run.begin -> getSendContext -> fresh session -> same-run streaming.
      await expect.poll(() => fixture.requests.slice(offset).filter(r => r.path === '/api/kpandora/v1/chat/web').length).toBe(1);
      const request = fixture.requests.slice(offset).find(r => r.path === '/api/kpandora/v1/chat/web')!.body as any;
      expect(JSON.stringify(request)).toContain(task.id);
      expect(JSON.stringify(request)).toContain('boundTask');
      // Only the canonical app-owned delivery preface is replaced; user text is verbatim.
      expect(request.message.split('\n\n')[0]).not.toContain('不要调用工具');
      expect(request.message).toContain(userPrompt);
      await expect.poll(async () => (await tasks()).tasks[0]?.mfRun?.state).toBe('streaming');
      const acceptedRun = (await tasks()).tasks[0]!.mfRun!.runId;
      expect((await tasks()).tasks[0]!.mfRun!.sessionKey).toBe(request.sessionKey);
      expect(fixture.requests.slice(offset).filter(r => r.path === '/api/kpandora/v1/session/new')).toHaveLength(1);
      expect((await tasks()).tasks[0]!.status).not.toBe('succeeded');
      expect(JSON.stringify((await state()).state)).not.toContain('Explicit WebMCP fixture delivery');
      if (deliver) {
        const webMcp = request.webMcp;
        expect(webMcp.pageInstanceId).toBeTruthy();
        const runId = 'fixture-webmcp-run';
        fixture.emit({ type: 'response.webmcp', data: { type: 'capability', protocolVersion: '1', pageInstanceId: webMcp.pageInstanceId, runId, capabilityToken: 'fixture-only-capability' } });
        const call = (callId: string, toolName: string, args: unknown) => fixture.emit({ type: 'response.webmcp', data: {
          phase: 'request', kind: 'call_tool', callId, operationId: callId, runId, pageInstanceId: webMcp.pageInstanceId,
          contextVersion: webMcp.contextVersion, deadlineAt: Date.now() + 30000, payload: { toolName, arguments: args },
        } });
        call('fixture-load-context', 'load_page_context', {});
        const updates = () => fixture.requests.slice(offset).filter(r => r.path === '/api/kpandora/v1/chat/webmcp/call/update').map(r => r.body as any);
        await expect.poll(() => updates().find(r => r.callId === 'fixture-load-context')?.action).toBe('completed');
        call('fixture-deliver-text', 'execute_page_tool', { contextVersion: webMcp.contextVersion, toolName: 'canvas.deliver_text', reason: 'Apply this local protocol fixture only to the registered canvas task.', arguments: { taskId: task.id, content: 'Explicit WebMCP fixture delivery' } });
        const frame = page.frameLocator('[data-testid="mf-conversation-frame"]');
        await expect(frame.getByRole('dialog')).toBeVisible();
        expect((await tasks()).tasks[0]!.status).not.toBe('succeeded');
        await frame.getByRole('button', { name: '允许一次', exact: true }).click();
        await expect.poll(() => updates().find(r => r.callId === 'fixture-deliver-text')?.action).toBe('completed');
        await expect.poll(async () => (await tasks()).tasks[0]!.status).toBe('succeeded');
        await expect.poll(async () => JSON.stringify((await state()).state)).toContain('Explicit WebMCP fixture delivery');
      }
      fixture.finishStreams();
      if (!deliver) {
        await expect.poll(async () => (await tasks()).tasks[0]?.mfRun?.reason).toBe('completed');
        expect((await tasks()).tasks[0]!.status).not.toBe('succeeded');
        expect((await tasks()).tasks[0]!.mfRun!.runId).toBe(acceptedRun);
        expect(JSON.stringify((await state()).state)).not.toContain('Local protocol fixture response');
        await page.getByTestId('mf-cancel-task').click();
      }
      expect(network.ssoHealthRequests).toEqual([]);
      expect(network.httpFailures).toEqual([]);
      expect(network.sdkFailures).toEqual([]);
      expect(network.errors).toEqual([]);
      expect(fixture.unexpected).toEqual([]);
    } finally {
      fixture.finishStreams();
      await network.attach(info);
      const path = info.outputPath('mf-bound-protocol.json');
      await writeFile(path, JSON.stringify({ requests: fixture.requests.slice(offset), tasks: await tasks(), unexpected: fixture.unexpected }, null, 2));
      await info.attach('mf-bound-protocol.json', { path, contentType: 'application/json' });
    }
  });
}
