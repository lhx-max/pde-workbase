import { describe, expect, it, vi } from 'vitest';
import { isPinterestGoogleButton, isGoogleButton, isGoogleLoginUrl, googleButtonClickScript } from '../../src/main/pinterest-google-button.js';

describe('Pinterest Google iframe boundary', () => {
  it('recognizes shared Google entry points without widening cookie access', () => {
    expect(isGoogleButton('https://design.example/login', 'https://accounts.google.com/gsi/button')).toBe(true);
    expect(isPinterestGoogleButton('https://design.example/login', 'https://accounts.google.com/gsi/button')).toBe(false);
    expect(isGoogleButton('https://accounts.google.com/signin', 'https://accounts.google.com/gsi/button')).toBe(false);
    expect(isGoogleButton('file:///private/test', 'https://accounts.google.com/gsi/button')).toBe(false);
    for (const path of ['/o/oauth2/auth', '/o/oauth2/v2/auth', '/v3/signin/identifier', '/signin/oauth']) {
      expect(isGoogleLoginUrl(`https://accounts.google.com${path}`)).toBe(true);
    }
    for (const url of ['https://accounts.google.com.evil.test/o/oauth2/auth', 'http://accounts.google.com/o/oauth2/auth', 'https://accounts.google.com/gsi/button', 'https://accounts.google.com/signinfoo']) expect(isGoogleLoginUrl(url)).toBe(false);
  });
  it('only accepts the actual GIS button under Pinterest', () => {
    expect(isPinterestGoogleButton('https://www.pinterest.com/signup/', 'https://accounts.google.com/gsi/button?size=large')).toBe(true);
    for (const url of ['https://accounts.google.com/signin', 'https://accounts.google.com/gsi/iframe/select', 'https://accounts.google.com.evil.test/gsi/button', 'http://accounts.google.com/gsi/button']) {
      expect(isPinterestGoogleButton('https://www.pinterest.com/', url)).toBe(false);
    }
    expect(isPinterestGoogleButton('https://evil.test/', 'https://accounts.google.com/gsi/button')).toBe(false);
  });
  it('only forwards trusted button clicks; does not read credentials', () => {
    let handler: (event: unknown) => void = () => undefined;
    const info = vi.fn();
    class Element { constructor(private button: boolean) {} closest() { return this.button; } }
    const document = { addEventListener: (_: string, fn: typeof handler) => { handler = fn; }, removeEventListener: vi.fn() };
    new Function('window', 'document', 'console', 'Element', googleButtonClickScript('test-marker'))({}, document, { info }, Element);
    const event = (trusted: boolean, button: boolean) => ({ isTrusted: trusted, target: new Element(button), preventDefault: vi.fn(), stopImmediatePropagation: vi.fn() });
    handler(event(false, true)); handler(event(true, false)); expect(info).not.toHaveBeenCalled();
    const click = event(true, true); handler(click);
    expect(info).toHaveBeenCalledWith('test-marker'); expect(click.preventDefault).toHaveBeenCalled();
  });
});
