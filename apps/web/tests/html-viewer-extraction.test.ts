import { describe, expect, it } from 'vitest';
import { HtmlViewerCapabilityUnavailable, resolveHtmlViewerAdapters } from '../src/components/html-viewer/capabilities';
import { applyInspectOverridesToSource, parseInspectOverridesFromSource, serializeInspectOverrides, updateInspectOverride } from '../src/components/html-viewer/inspect-overrides';
import { HtmlSourceSnapshotCache, htmlSourceSnapshotRefreshKey } from '../src/components/html-viewer/html-source-snapshot-cache';
import { resetConsumedSlideNavForTests, shouldConsumeSlideNav } from '../src/components/html-viewer/slide-nav';
import { resolvePoweredBaseOrigin, swapLoopbackHost } from '../src/components/html-viewer/powered-preview';

describe('original HTML viewer inspect source safety', () => {
 it('derives selectors from host-owned IDs and filters injected declarations', () => {
  const css=serializeInspectOverrides({cover:{selector:'body {display:none} /*',props:{color:'red',display:'none','font-size':'20px; background:url(https://evil.test)','border-radius':'8px'}},'bad\"id':{props:{color:'blue'}}});
  expect(css).toBe('[data-bezier-id="cover"] { color: red !important; border-radius: 8px !important }');
 });
 it('preserves deck labels with spaces without trusting inbound selector contents', () => {
  expect(serializeInspectOverrides({'01 Cover':{selector:'[data-screen-label="injected"]',props:{color:'#fff'}}})).toContain('[data-screen-label="01 Cover"]');
 });
 it('retains authored script/comment/text literals when adding or replacing overrides', () => {
  const literal='<style data-bezier-inspect-overrides>[data-bezier-id="fake"] { color: red }</style>';
  const source=`<!doctype html><html><head><script>const sample=${JSON.stringify(literal)};const closing="</head>";</script><!-- ${literal} --><title>${literal}</title></head><body>Original</body></html>`;
  const css=serializeInspectOverrides({real:{props:{color:'blue'}}});
  const updated=applyInspectOverridesToSource(source,css);
  expect(updated).toContain(`<script>const sample=${JSON.stringify(literal)};const closing="</head>";</script>`);
  expect(parseInspectOverridesFromSource(updated)).toEqual({real:{selector:'[data-bezier-id="real"]',props:{color:'blue'}}});
  expect(applyInspectOverridesToSource(updated,css)).toBe(updated);
  expect(applyInspectOverridesToSource(updated,'')).toBe(source);
 });
 it('does not erase CSS whose attribute only mentions the override marker', () => {
  const source='<head><style data-bezier-inspect-overrides-note="docs">.a{color:red}</style><style title="data-bezier-inspect-overrides">.b{color:blue}</style></head>';
  expect(applyInspectOverridesToSource(source,'')).toBe(source);
  expect(parseInspectOverridesFromSource(source)).toEqual({});
 });
 it('rejects non-allowlisted changes and removes empty host entries', () => {
  const original={a:{selector:'[data-bezier-id="a"]',props:{color:'red'}}};
  expect(updateInspectOverride(original,'a','','display','none')).toBe(original);
  expect(updateInspectOverride(original,'a','','color','red;display:none')).toBe(original);
  expect(updateInspectOverride(original,'a','','color','')).toEqual({});
 });
});

describe('original HTML viewer lifecycle caches', () => {
 it('segregates cached source by authorization and exact revision', () => {
  const cache=new HtmlSourceSnapshotCache({maxEntries:2,maxUtf16Bytes:1000});
  const entry={authorizationScopeKey:'local',projectId:'p',fileName:'deck.html',refreshKey:'1',source:'<h1>one</h1>'};
  cache.set(entry);
  expect(cache.get('workspace:other','p','deck.html','1')).toBeNull();
  expect(cache.get('local','p','deck.html','1')?.source).toBe(entry.source);
  expect(cache.get('local','p','deck.html','2')).toBeNull();
  expect(cache.size).toBe(0);
 });
 it('bounds memory using UTF-16 byte accounting and LRU eviction', () => {
  const cache=new HtmlSourceSnapshotCache({maxEntries:2,maxUtf16Bytes:100});
  const put=(fileName:string)=>cache.set({authorizationScopeKey:'local',projectId:'p',fileName,refreshKey:'1',source:'ab'});
  put('a');put('b');cache.get('local','p','a','1');put('c');
  expect(cache.get('local','p','b','1')).toBeNull();
  expect(cache.get('local','p','a','1')).not.toBeNull();
  expect(cache.utf16Bytes).toBe(8);
 });
 it('includes metadata and watcher token in source revision identity', () => {
  expect(htmlSourceSnapshotRefreshKey({mtime:42,size:10},3)).toBe('42:10:3');
 });
 it('consumes a navigation nonce once across viewer remounts but not across files', () => {
  resetConsumedSlideNavForTests();
  expect(shouldConsumeSlideNav('p:deck.html',7)).toBe(true);
  expect(shouldConsumeSlideNav('p:deck.html',7)).toBe(false);
  expect(shouldConsumeSlideNav('p:other.html',7)).toBe(true);
  expect(shouldConsumeSlideNav('p:deck.html',8)).toBe(true);
 });
});

describe('independent viewer capability boundaries', () => {
 it('rejects missing optional capabilities with an explicit typed failure', async () => {
  const adapter=resolveHtmlViewerAdapters({});
  await expect(adapter.saveTemplate({name:'Theme',sourceProjectId:'p'})).rejects.toMatchObject({code:'UNSUPPORTED_CAPABILITY',capability:'saveTemplate'});
  await expect(adapter.handoff({projectId:'p'})).rejects.toBeInstanceOf(HtmlViewerCapabilityUnavailable);
  await expect(adapter.publishProjectFilePublic('p','deck.html')).rejects.toMatchObject({code:'UNSUPPORTED_CAPABILITY'});
 });
 it('keeps embedding capabilities isolated between viewers and propagates real failure', async () => {
  const first=resolveHtmlViewerAdapters({saveTemplate:async input=>({name:`first:${input.name}`})});
  const second=resolveHtmlViewerAdapters({saveTemplate:async()=>{throw new Error('Host permission denied');}});
  await expect(first.saveTemplate({name:'Theme',sourceProjectId:'p'})).resolves.toEqual({name:'first:Theme'});
  await expect(second.saveTemplate({name:'Theme',sourceProjectId:'p'})).rejects.toThrow('Host permission denied');
 });
});

describe('original powered-preview isolation boundary', () => {
 it('requires a separate loopback origin and never grants arbitrary remote same-origin access', () => {
  expect(swapLoopbackHost('http://127.0.0.1:3100')).toBe('http://localhost:3100');
  expect(resolvePoweredBaseOrigin('https://example.com')).toBeNull();
  expect(resolvePoweredBaseOrigin('not a URL')).toBeNull();
  expect(resolvePoweredBaseOrigin('http://localhost:3100')).toBe('http://127.0.0.1:3100');
 });
});
