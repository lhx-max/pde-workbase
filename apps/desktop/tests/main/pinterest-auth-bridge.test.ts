import { describe, expect, it, vi } from 'vitest';
import { importPinterestCookies, parsePinterestCookies, startPinterestAuthBridge } from '../../src/main/pinterest-auth-bridge.js';

const fixture = [{ name: '_pinterest_sess', value: 'synthetic-test-only', domain: '.pinterest.com', path: '/', secure: true, httpOnly: true, sameSite: 'lax' }];
describe('Pinterest development handoff', () => {
  it('accepts only bounded Pinterest cookies, preserving session attributes', () => {
    expect(parsePinterestCookies(fixture)[0]).toMatchObject({ url: 'https://pinterest.com/', httpOnly: true, secure: true, sameSite: 'lax' });
    for (const domain of ['google.com', '.accounts.google.com', 'pinterest.com.attacker.test']) expect(() => parsePinterestCookies([{ ...fixture[0], domain }])).toThrow();
    expect(() => parsePinterestCookies([{ ...fixture[0], partitionKey: {} }])).toThrow();
    expect(() => parsePinterestCookies([{ ...fixture[0], expirationDate: 1 }])).toThrow();
    expect(() => parsePinterestCookies([...fixture, ...fixture])).toThrow();
    expect(() => parsePinterestCookies([{ ...fixture[0], path: '//evil.test' }])[0].url).not.toThrow();
  });
  it('rejects incorrect tokens and webpage origins without consuming the valid attempt', async () => {
    const accept = vi.fn(async () => true);
    const bridge = await startPinterestAuthBridge({ accept });
    const url = new URL(bridge.code);
    const token = url.hash.slice(1);
    url.hash = ''; url.pathname = '/connect';
    try {
      expect((await fetch(url, { method: 'POST', headers: { Authorization: 'Bearer wrong' } })).status).toBe(403);
      expect((await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, Origin: 'https://attacker.test' } })).status).toBe(403);
      const response = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Origin: `chrome-extension://${'a'.repeat(32)}` }, body: JSON.stringify(fixture) });
      expect(response.status).toBe(200);
      expect(accept).toHaveBeenCalledTimes(1);
      expect(await response.text()).not.toContain('synthetic-test-only');
      await expect(fetch(url)).rejects.toThrow();
    } finally { bridge.close(); }
  });
  it('does not import a payload containing a Google cookie', async () => {
    const accept = vi.fn(async () => true);
    const bridge = await startPinterestAuthBridge({ accept });
    const url = new URL(bridge.code); const token = url.hash.slice(1); url.hash = ''; url.pathname = '/connect';
    try {
      const response = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify([{ ...fixture[0], domain: '.google.com' }]) });
      expect(response.status).toBe(400);
      expect(accept).not.toHaveBeenCalled();
    } finally { bridge.close(); }
  });
  it('expires an unused receiver and never calls the importer', async () => {
    const accept = vi.fn(async () => true);
    const bridge = await startPinterestAuthBridge({ accept, ttlMs: 20 });
    await new Promise(resolve => setTimeout(resolve, 40));
    await expect(fetch(bridge.code.split('#')[0]!)).rejects.toThrow();
    expect(accept).not.toHaveBeenCalled();
    bridge.close();
  });
  it('respects native cancellation without reporting authenticated success', async () => {
    const bridge = await startPinterestAuthBridge({ accept: async () => false });
    const url = new URL(bridge.code); const token = url.hash.slice(1); url.hash = ''; url.pathname = '/connect';
    try {
      const response = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(fixture) });
      expect(response.status).toBe(409);
      expect(await response.text()).toContain('已取消');
    } finally { bridge.close(); }
  });
  it('restores original keys if writing fails instead of clearing browser storage', async () => {
    const set = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('disk')).mockResolvedValue(undefined);
    const remove = vi.fn(async () => undefined);
    const target = { cookies: { get: vi.fn(async () => [{ ...fixture[0], value: 'old-synthetic' }]), set, remove, flushStore: vi.fn() } };
    await expect(importPinterestCookies(target as never, parsePinterestCookies([...fixture, { ...fixture[0], name: 'csrftoken' }]))).rejects.toThrow('原有登录数据已恢复');
    expect(set).toHaveBeenLastCalledWith(expect.objectContaining({ name: '_pinterest_sess', value: 'old-synthetic' }));
    expect(remove).toHaveBeenCalledWith('https://pinterest.com/', 'csrftoken');
  });
});
