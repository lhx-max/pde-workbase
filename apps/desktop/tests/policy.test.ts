import { describe, expect, it, vi } from 'vitest';
import type { OnBeforeRequestListenerDetails, Session } from 'electron';
import { allowedBrowserUrl, allowedBrowserSubresourceUrl, authenticates, captureClip, localAppUrl, requireHostToken, trustedDocument } from '../src/policy.js';
import { observeBrowserRequests, setBrowserRequestPolicy } from '../src/main/browser-request-policy.js';

describe('independent host trust policy', () => {
  it.each(['https://evil.test', 'file:///private', 'http://user@localhost', 'http://localhost/?secret=x', undefined])('rejects nonlocal/ambiguous launch URL %s', value => {
    expect(() => localAppUrl(value, 'TEST')).toThrow();
  });
  it('trusts only the configured local app document, not previews or another port', () => {
    const app = localAppUrl('http://127.0.0.1:3210/', 'TEST');
    expect(trustedDocument('http://127.0.0.1:3210/?project=p#canvas', app)).toBe(true);
    for (const url of ['http://127.0.0.1:3210/artifacts/a.html', 'http://127.0.0.1:3210/api/file', 'http://127.0.0.1:3211/', 'http://user@127.0.0.1:3210/']) expect(trustedDocument(url, app)).toBe(false);
  });
  it.each(['file:///private', 'javascript:alert(1)', 'data:text/html,hello', 'blob:https://host/id', 'https://user:secret@host', 'chrome://settings', '//example.org'])('blocks dangerous browser navigation %s', url => {
    expect(allowedBrowserUrl(url)).toBe(false);
  });
  it('allows ordinary web navigation but not configured privileged origins', () => {
    expect(allowedBrowserUrl('about:blank')).toBe(true);
    expect(allowedBrowserUrl('https://example.org/path')).toBe(true);
    expect(allowedBrowserUrl('http://127.0.0.1:3210/', ['http://127.0.0.1:3210'])).toBe(false);
  });
  it.each(['localhost', 'localhost.', 'app.localhost', '[::1]', '127.0.0.2', '127.1', '2130706433', '0x7f000001', '0177.0.0.1', '[::ffff:127.0.0.1]'])('blocks privileged loopback alias %s for navigation and subresources', host => {
    const blocked = ['http://127.0.0.1:3210'];
    expect(allowedBrowserUrl(`http://${host}:3210/api/health`, blocked)).toBe(false);
    for (const scheme of ['http', 'https', 'ws', 'wss']) expect(allowedBrowserSubresourceUrl(`${scheme}://${host}:3210/resource`, blocked)).toBe(false);
    expect(allowedBrowserUrl(`http://${host}:3211/fixture`, blocked)).toBe(true);
    expect(allowedBrowserSubresourceUrl(`ws://${host}:3211/live`, blocked)).toBe(true);
  });
  it('normalizes default ports and blocks privileged blob origins without blocking independent sites', () => {
    expect(allowedBrowserSubresourceUrl('ws://localhost/live', ['http://127.0.0.1:80'])).toBe(false);
    expect(allowedBrowserSubresourceUrl('wss://[::1]/live', ['https://127.0.0.1:443'])).toBe(false);
    expect(allowedBrowserSubresourceUrl('blob:http://localhost:3210/id', ['http://127.0.0.1:3210'])).toBe(false);
    for (const url of ['https://example.org:3210/a', 'wss://example.org:3210/live', 'data:image/png;base64,aGVsbG8=', 'blob:https://example.org/id']) expect(allowedBrowserSubresourceUrl(url, ['http://127.0.0.1:3210'])).toBe(true);
    for (const url of ['file:///tmp/private', 'chrome://settings', 'https://user:secret@example.org/a']) expect(allowedBrowserSubresourceUrl(url)).toBe(false);
  });
  it('authenticates only an exact constant-time bearer value', () => {
    const token = requireHostToken('A'.repeat(43));
    expect(authenticates(`Bearer ${token}`, token)).toBe(true);
    for (const header of [undefined, token, 'Bearer short', `Bearer ${'B'.repeat(43)}`]) expect(authenticates(header, token)).toBe(false);
    expect(() => requireHostToken('short')).toThrow();
  });
  it('bounds screenshot rectangles', () => {
    const bounds = { width: 100, height: 100 };
    expect(captureClip(undefined, bounds)).toBeUndefined();
    expect(captureClip({ x: 1.4, y: 2.7, width: 50.9, height: 20 }, bounds)).toEqual({ x: 1, y: 2, width: 50, height: 20 });
    for (const clip of [{ x: -1, y: 0, width: 20, height: 20 }, { x: 0, y: 0, width: Infinity, height: 20 }, { x: 90, y: 0, width: 20, height: 20 }]) expect(() => captureClip(clip, bounds)).toThrow();
  });
  it('keeps the request security gate active across capture start/stop', () => {
    let listener: ((details: OnBeforeRequestListenerDetails, callback: (value: unknown) => void) => void) | undefined;
    const s = { webRequest: { onBeforeRequest: vi.fn((_filter, callback) => { listener = callback; }) } } as unknown as Session;
    setBrowserRequestPolicy(s, d => allowedBrowserUrl(d.url));
    const observe = vi.fn(); const stop = observeBrowserRequests(s, observe);
    const callback = vi.fn();
    listener!({ url: 'file:///private' } as OnBeforeRequestListenerDetails, callback);
    expect(callback).toHaveBeenLastCalledWith({ cancel: true }); expect(observe).not.toHaveBeenCalled();
    listener!({ url: 'https://example.org/' } as OnBeforeRequestListenerDetails, callback);
    expect(observe).toHaveBeenCalledOnce(); expect(callback).toHaveBeenLastCalledWith({});
    stop(); listener!({ url: 'file:///private' } as OnBeforeRequestListenerDetails, callback);
    expect(callback).toHaveBeenLastCalledWith({ cancel: true });
    expect(s.webRequest.onBeforeRequest).not.toHaveBeenLastCalledWith(null);
  });
});
