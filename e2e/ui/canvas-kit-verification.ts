/** Real browser acceptance against the explicit local Kit data root, never the user's live canvas. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, expect } from '@playwright/test';

const origin = process.env.CANVAS_KIT_URL ?? 'http://127.0.0.1:4173';
const output = path.resolve(process.env.CANVAS_KIT_EVIDENCE ?? 'docs/verification/canvas-kit-runtime');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors: string[] = [];
const checks: string[] = [];
const traffic: { method: string; url: string; status: number }[] = [];
page.on('pageerror', error => errors.push(error.message));
page.on('response', res => { if (res.url().includes('/canvas-provider/')) traffic.push({ method: res.request().method(), url: res.url(), status: res.status() }); });
const context = { applicationId: 'app_canvas_workspace_v1', applicationVersion: '0.1.0', applicationInstanceId: 'ai_workspace_a', providerInstanceId: 'pi_workspace_a', actor: { userId: 'u_preview', tenantId: 'local' }, bizId: 'b_preview', sessionId: 's_preview' };
async function call(actionId: string, input: Record<string, unknown> = {}, expectedRevision?: number, key = crypto.randomUUID()) {
  const response = await fetch(`${origin}/canvas-provider/open-platform/v1/instances/${context.providerInstanceId}/actions/${actionId}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...context, protocolVersion: '1.0', requestId: key, idempotencyKey: key, actionId, input, expectedRevision }) });
  const body = await response.json();
  return { status: response.status, body };
}
function nodes(state: Record<string, unknown>): Record<string, any>[] {
  return ['workbenchBasicNodes', 'workbenchImages'].flatMap(key => Array.isArray(state[key]) ? state[key] as Record<string, any>[] : []);
}
try {
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '画布工作区', exact: true }).click();
  const surface = page.locator('[data-canvas-instance-id]');
  await expect(surface).toBeVisible({ timeout: 30000 });
  await expect(page.getByTestId('canvas-workbench-surface')).toBeVisible();
  const rect = await surface.boundingBox();
  assert(rect && rect.width > 1000 && rect.height > 700, 'full canvas has usable host dimensions');
  const a = await surface.getAttribute('data-canvas-instance-id');
  let read = await call('canvas.read');
  assert.equal(read.status, 200); assert.equal(a, read.body.data.canvasInstanceId);
  checks.push('Registry mounts original full canvas and resolves Provider instance');

  const beforeIds = new Set(nodes(read.body.data.state).map(node => node.id));
  await page.locator('.dock-primary').click();
  await page.getByRole('menuitem', { name: '视频', exact: true }).click();
  let created: Record<string, any> | undefined;
  await expect.poll(async () => {
    read = await call('canvas.read');
    created = nodes(read.body.data.state).find(node => !beforeIds.has(node.id));
    return Boolean(created);
  }, { timeout: 15000 }).toBe(true);
  assert(created);
  checks.push('UI add-video-card action persists into the same Provider state');

  const title = `Provider verified ${Date.now()}`;
  const key = crypto.randomUUID();
  const revision = read.body.revision;
  const input = { operations: [{ type: 'node.rename', nodeId: created.id, title }] };
  const changed = await call('canvas.operations', input, revision, key);
  assert.equal(changed.status, 200, JSON.stringify(changed.body));
  await expect(page.getByText(title, { exact: true }).first()).toBeVisible({ timeout: 15000 });
  const replay = await call('canvas.operations', input, revision, key);
  assert.deepEqual(replay, changed);
  const stale = await call('canvas.operations', { operations: [{ type: 'node.rename', nodeId: created.id, title: 'MUST NOT SAVE' }] }, revision);
  assert.equal(stale.status, 409);
  checks.push('Provider edit appears in UI; old-key replay is stable; stale writes return 409');

  const picker = page.locator('.preview-nav select');
  await picker.selectOption('1');
  await expect(surface).not.toHaveAttribute('data-canvas-instance-id', a!);
  const b = await surface.getAttribute('data-canvas-instance-id');
  await expect(page.getByText(title, { exact: true })).toHaveCount(0);
  await picker.selectOption('0');
  await expect(surface).toHaveAttribute('data-canvas-instance-id', a!);
  await expect(page.getByText(title, { exact: true }).first()).toBeVisible({ timeout: 15000 });
  assert.notEqual(a, b);
  checks.push('A/B instances switch only after flush, remain isolated, and restore A');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '画布工作区', exact: true }).click();
  await expect(surface).toHaveAttribute('data-canvas-instance-id', a!, { timeout: 30000 });
  await expect(page.getByText(title, { exact: true }).first()).toBeVisible({ timeout: 15000 });
  checks.push('Browser reload restores the same persisted canvas and Provider edit');
  assert.deepEqual(errors, [], 'no uncaught browser errors');
  await page.screenshot({ path: path.join(output, 'canvas-kit.png'), fullPage: true });
  await writeFile(path.join(output, 'result.json'), JSON.stringify({ passed: true, origin, checks, a, b, nodeId: created.id, title, errors, traffic }, null, 2));
  console.log(JSON.stringify({ passed: true, checks, evidence: output }, null, 2));
} catch (error) {
  await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true });
  await writeFile(path.join(output, 'failure.json'), JSON.stringify({ passed: false, checks, error: String(error), errors, traffic, body: await page.locator('body').innerText() }, null, 2));
  throw error;
} finally { await browser.close(); }
