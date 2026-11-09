// @vitest-environment jsdom
import { cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import { readSketchWorkspaceDocument } from '../src/components/sketch-model';
import { browserPageExtractionTurn } from '../src/components/browser-page-extraction';
import { readAssetDocument } from '../src/components/asset-document-content';
import { assetInspectorCopy } from '../src/i18n/locales/asset-inspector-copy';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider, tForLanguageTag } from '../src/i18n';
import { applyManualEditPatch } from '../src/edit-mode/source-patches';
import { SidebarProvider, SidebarTrigger, SidebarRail } from '../src/components/animate-ui/components/radix/sidebar';
import { Dialog, DialogContent, DialogTitle } from '../src/components/animate-ui/components/radix/dialog';
import { Sheet, SheetContent, SheetTitle } from '../src/components/animate-ui/components/radix/sheet';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('deep first-party Chinese messages', () => {
  it('localizes invalid sketch documents without changing default pure diagnostics', () => {
    const t = tForLanguageTag('zh-CN')!;
    expect(() => readSketchWorkspaceDocument(null, t)).toThrow('草图内容不可用');
    expect(() => readSketchWorkspaceDocument('{}', t)).toThrow('不支持此草图文档');
    expect(() => readSketchWorkspaceDocument('{"elements":[],"version":3}', t)).toThrow('不支持此草图版本');
    expect(() => readSketchWorkspaceDocument(null)).toThrow('Sketch content is unavailable');
  });
  it('localizes rejected webpage URLs while preserving validation', () => {
    expect(() => browserPageExtractionTurn({ url: 'file:///secret', title: 'User title' }, 'Extract', tForLanguageTag('zh-CN')!)).toThrow('不支持此网页地址');
  });
  it('uses the caller locale for asset-document errors rather than the global default', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 500 })));
    const en = tForLanguageTag('en')!;
    const zh = tForLanguageTag('zh-CN')!;
    await expect(readAssetDocument('/broken', new AbortController().signal, en)).rejects.toThrow(en('asset.doc.previewFailed'));
    await expect(readAssetDocument('/broken', new AbortController().signal, zh)).rejects.toThrow(zh('asset.doc.previewFailed'));
  });
  it('localizes source patch failures while retaining target identity and the original source', () => {
    const source = '<html><body><p data-bezier-id="a">User text</p></body></html>';
    const result = applyManualEditPatch(source, { kind: 'set-text', id: 'customer-id', value: 'New text' }, tForLanguageTag('zh-CN')!);
    expect(result).toEqual({ ok: false, source, error: '找不到目标：customer-id' });
    expect(applyManualEditPatch(source, { kind: 'set-text', id: 'customer-id', value: 'New text' }).error).toBe('Target not found: customer-id');
  });
  it('keeps nested-content safety errors localized without modifying markup', () => {
    const source = '<html><body><div data-bezier-id="a"><b>One</b><b>Two</b></div></body></html>';
    expect(applyManualEditPatch(source, { kind: 'set-text', id: 'a', value: 'New text' }, tForLanguageTag('zh-CN')!)).toEqual({ ok: false, source, error: '此元素包含嵌套标记，请改用 HTML 选项卡。' });
  });
  it('localizes generic sidebar controls', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
    render(<I18nProvider initial="zh-CN"><SidebarProvider><SidebarTrigger/><SidebarRail/></SidebarProvider></I18nProvider>);
    expect(screen.getAllByRole('button', { name: '切换侧栏' })).toHaveLength(2);
  });
  it('localizes shared dialog and sheet close controls', () => {
    const { unmount } = render(<I18nProvider initial="zh-CN"><Dialog open><DialogContent aria-describedby={undefined}><DialogTitle>用户标题</DialogTitle></DialogContent></Dialog></I18nProvider>);
    expect(screen.getByRole('button', { name: '关闭' })).toBeTruthy();
    unmount();
    render(<I18nProvider initial="zh-CN"><Sheet open><SheetContent aria-describedby={undefined}><SheetTitle>用户标题</SheetTitle></SheetContent></Sheet></I18nProvider>);
    expect(screen.getByRole('button', { name: '关闭' })).toBeTruthy();
  });
});
