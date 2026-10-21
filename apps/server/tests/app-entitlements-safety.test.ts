import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { AppEntitlementStore } from '../src/storage/app-entitlements.js';

const faults = vi.hoisted(() => ({ readError: '' }));
vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, readFileSync(...args: Parameters<typeof actual.readFileSync>) {
    if (faults.readError) throw Object.assign(new Error('Injected read failure'), { code: faults.readError });
    return actual.readFileSync(...args);
  } };
});
const roots: string[] = [];
const fixture = () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'app-entitlements-safety-')); roots.push(root);
  return { root, file: path.join(root, 'app-entitlements.json'), store: new AppEntitlementStore(root) };
};
afterEach(() => {
  faults.readError = '';
  for (const root of roots.splice(0)) {
    if (path.dirname(root) !== os.tmpdir() || !path.basename(root).startsWith('app-entitlements-safety-')) throw new Error('Unsafe test cleanup');
    rmSync(root, { recursive: true, force: true });
  }
});
const tenant = { teamId: 'team-a', userId: 'alice' };
const rule = { id: 'ent-one', scope: '*', appId: 'doc', effect: 'deny', updatedAt: '2026-01-01T00:00:00.000Z' };

it('retains absent-table default allow and the existing user/team/global priority for valid rules', () => {
  const { root, store } = fixture();
  expect(store.list()).toEqual([]);
  expect(store.resolve('doc', tenant)).toBe('allow');
  store.put({ scope: '*', appId: 'doc', effect: 'deny' });
  expect(new AppEntitlementStore(root).resolve('doc', tenant)).toBe('deny');
  store.put({ scope: 'team:team-a', appId: 'doc', effect: 'allow' });
  expect(store.resolve('doc', tenant)).toBe('allow');
  store.put({ scope: 'user:alice', appId: 'doc', effect: 'deny', updatedBy: 'operator' });
  expect(store.resolve('doc', tenant)).toBe('deny');
  expect(store.resolve('other-app', tenant)).toBe('allow');
  expect(store.remove('user:alice', 'doc')).toBe(true);
  expect(store.resolve('doc', tenant)).toBe('allow');
});

it.each(['', '{bad', 'null', '[]', '{}', '{"version":2,"rules":[]}', '{"version":1,"rules":null}',
  '{"version":1,"rules":[null]}', '{"version":1,"rules":[{}]}',
  JSON.stringify({ version: 1, rules: [{ ...rule, effect: 'unknown' }] }),
  JSON.stringify({ version: 1, rules: [{ ...rule, scope: 'team:' }] }),
  JSON.stringify({ version: 1, rules: [{ ...rule, appId: 123 }] }),
  JSON.stringify({ version: 1, rules: [{ ...rule, updatedAt: null }] }),
  JSON.stringify({ version: 1, rules: [{ ...rule, updatedBy: {} }] }),
])('fails closed on corrupt JSON/schema/rules without replacing the policy: %s', serialized => {
  const { file, store } = fixture();
  store.put({ scope: '*', appId: 'doc', effect: 'deny' });
  expect(store.resolve('doc', tenant)).toBe('deny');
  writeFileSync(file, serialized);
  for (const operation of [() => store.resolve('doc', tenant), () => store.list(),
    () => store.put({ scope: '*', appId: 'doc', effect: 'allow' }), () => store.remove('*', 'doc')]) {
    expect(operation).toThrow(expect.objectContaining({ status: 500, code: 'APP_ENTITLEMENTS_CORRUPT' }));
    expect(readFileSync(file, 'utf8')).toBe(serialized);
  }
});

it.each(['EACCES', 'EPERM', 'EIO'])('does not turn an unreadable deny rule into allow on %s', code => {
  const { file, store } = fixture();
  store.put({ scope: '*', appId: 'doc', effect: 'deny' });
  const serialized = readFileSync(file, 'utf8');
  expect(store.resolve('doc', tenant)).toBe('deny');
  faults.readError = code;
  for (const operation of [() => store.resolve('doc', tenant), () => store.list(),
    () => store.put({ scope: '*', appId: 'doc', effect: 'allow' }), () => store.remove('*', 'doc')]) {
    expect(operation).toThrow(expect.objectContaining({ status: 500, code: 'APP_ENTITLEMENTS_STORAGE_ERROR' }));
  }
  faults.readError = '';
  expect(readFileSync(file, 'utf8')).toBe(serialized);
  expect(store.resolve('doc', tenant)).toBe('deny');
});
