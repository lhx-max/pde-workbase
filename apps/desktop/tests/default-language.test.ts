import { readFileSync } from 'node:fs';
import { afterEach, expect, it, vi } from 'vitest';
import { bindDesktopLocale, currentDesktopLocale, desktopUiLocale, du } from '../src/main/locales/desktop-ui.js';
import { bindExtensionLocale, currentExtensionLocale, detectExtensionLocale, eu, extensionUiLocale } from '../browser-extension/locales/extension-ui.js';
import { nativeMessage, nativeFailure } from '../src/main/locales/native-messages.js';
import { localizeBridgeError } from '../browser-extension/locales/extension-ui.js';
import { captureMessages } from '../src/locales/browser-capture-messages.js';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
const nativeProgram = ts.transpileModule(readFileSync(new URL('../src/main/locales/native-host-ui.cts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.CommonJS },
}).outputText;
function nativeCopy(localeFile?: string) {
  const exports = {} as { nhu(): { invalidRequest: string }; bindNativeHostLocaleDir(path: string): void };
  runInNewContext(nativeProgram, { exports, process: { env: { LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8' } }, require: (name: string) =>
    name === 'node:path' ? { join: (...parts: string[]) => parts.join('/') } : { readFileSync: () => { if (localeFile === undefined) throw new Error('missing'); return localeFile; } } });
  exports.bindNativeHostLocaleDir('/virtual');
  return exports.nhu();
}

afterEach(() => { bindDesktopLocale('zh-CN'); bindExtensionLocale('zh-CN'); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
it('defaults missing and unsupported locale tags to simplified Chinese while retaining explicit English', () => {
  expect(currentDesktopLocale()).toBe('zh-CN');
  expect(currentExtensionLocale()).toBe('zh-CN');
  for (const tag of [undefined, null, '', 'fr-FR', 'zh_TW']) {
    expect(desktopUiLocale(tag)).toBe('zh-CN');
    expect(extensionUiLocale(tag)).toBe('zh-CN');
  }
  expect(captureMessages().saved).toBe('已保存');
  bindDesktopLocale('en-US'); bindExtensionLocale('en-GB');
  expect(du().cancel).toBe('Cancel'); expect(eu().close).toBe('Close');
  expect(captureMessages('en').saved).toBe('Saved');
});
it('does not silently switch fresh extension/native UI to the OS or browser language', () => {
  vi.stubGlobal('chrome', { i18n: { getUILanguage: () => 'en-US' } });
  vi.stubGlobal('navigator', { language: 'en-US' });
  expect(detectExtensionLocale()).toBe('zh-CN');
  expect(nativeCopy().invalidRequest).toBe('请求无效');
  expect(nativeCopy('en\nCanvas Workspace\n').invalidRequest).toBe('The request is invalid.');
});
it('localizes first-party native consent/export strings without changing consent defaults', () => {
  const copy = du();
  expect(copy.enable).toBe('启用'); expect(copy.enableCapture).toBe('启用外部浏览器采集扩展？');
  expect(copy.enableCaptureDetail).toContain('不能读取浏览器 Cookie 或任意本地文件');
  expect(copy.capturePackageExported).toContain('不会自动安装扩展或修改浏览器配置');
  expect(copy.exportCapture).toContain('导出'); expect(copy.extensionPackage).toBe('扩展压缩包');
  const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
  expect(main).toContain('buttons: [du().cancel, du().enable], defaultId: 0, cancelId: 0');
  expect(main).toContain('detail: du().enableCaptureDetail');
  expect(main).toContain('title: du().exportCapture');
  expect(main).toContain("app.setName('画布工作区')");
  expect(main).toContain("title: '画布工作区'");
  bindDesktopLocale('en'); expect(du().enableCapture).toBe('Enable the external browser capture extension?');
});
it('uses neutral Chinese fallback for unknown native/bridge errors without inventing success', () => {
  expect(nativeMessage('Image read timed out')).toBe('读取图片超时。');
  expect(nativeFailure(new Error('fetch failed'), '读取失败')).toBe('读取失败');
  expect(localizeBridgeError('Unknown network error', eu().actionFailed)).toBe('操作失败，请重试');
  expect(localizeBridgeError('Could not reach 画布工作区', eu().actionFailed)).toBe('操作失败，请重试');
  bindDesktopLocale('en'); bindExtensionLocale('en');
  expect(nativeMessage('Image read timed out')).toBe('Image read timed out');
  expect(localizeBridgeError('', eu().actionFailed)).toBe('The action failed. Try again.');
  expect(localizeBridgeError(eu().connectedPlain, eu().actionFailed)).toBe('Connected to 画布工作区');
});
it('ships Chinese static popup and manifest fallback before scripts initialize', () => {
  const html = readFileSync(new URL('../browser-extension/popup.html', import.meta.url), 'utf8');
  expect(html).toContain('<html lang="zh-CN">');
  expect(html).toContain('正在检测'); expect(html).not.toContain('Checking');
  const manifest = JSON.parse(readFileSync(new URL('../browser-extension/manifest.json', import.meta.url), 'utf8'));
  expect(manifest.default_locale).toBe('zh_CN');
});
