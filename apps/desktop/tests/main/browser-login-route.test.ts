import { describe, expect, it } from 'vitest';
import { browserLoginRoute } from '../../src/main/browser-login-route.js';

describe('browser login routing', () => {
  it('keeps supported session handoff distinct from external-only login', () => {
    expect(browserLoginRoute('https://www.pinterest.com/signup/')).toEqual({ name: 'Pinterest', loginUrl: 'https://www.pinterest.com/login/', sessionReturn: 'pinterest' });
    expect(browserLoginRoute('https://dribbble.com/session/new')).toEqual({ name: 'Dribbble', loginUrl: 'https://dribbble.com/session/new', sessionReturn: null });
  });
  it('resolves the observed Behance Adobe hop without forwarding OAuth state', () => {
    expect(browserLoginRoute('https://auth.services.adobe.com/en_US/index.html?client_id=BehanceWebSusi1&state=secret')).toEqual({ name: 'Behance', loginUrl: 'https://www.behance.net/', sessionReturn: null });
    expect(browserLoginRoute('https://auth.services.adobe.com/en_US/index.html?client_id=another')).toBeNull();
  });
  it('never routes a provider auth URL or impersonating host as a supported site', () => {
    for (const url of ['https://accounts.google.com/v3/signin/identifier', 'http://dribbble.com/', 'file:///tmp/test', 'https://user:secret@dribbble.com/', 'https://auth.services.adobe.com/?client_id=BehanceWebSusi1&client_id=other']) expect(browserLoginRoute(url)).toBeNull();
    expect(browserLoginRoute('https://pinterest.com.evil.test/login?state=secret')).toEqual({ name: 'pinterest.com.evil.test', loginUrl: 'https://pinterest.com.evil.test/', sessionReturn: null });
  });
});
