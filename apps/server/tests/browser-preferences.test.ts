import { afterEach, describe, expect, it } from 'vitest';
import { Database } from '../src/storage/database.js';
import { BrowserPreferencesService } from '../src/services/browser-preferences.js';

const databases: Database[] = [];
function setup() { const db = new Database(':memory:'); databases.push(db); return { db, service: new BrowserPreferencesService(db) }; }
afterEach(() => { for (const db of databases.splice(0)) db.close(); });

describe('durable browser preferences', () => {
  it('distinguishes untouched defaults from intentionally empty bookmarks', () => {
    const { service } = setup();
    expect(service.read()).toEqual({ revision: 0, preferences: {} });
    expect(service.update({ revision: 0, patch: { browserBookmarks: [] } })).toEqual({ revision: 1, preferences: { browserBookmarks: [] } });
  });
  it('persists original bookmark/reference/capture fields across service instances', () => {
    const { service, db } = setup();
    service.update({ revision: 0, patch: { browserBookmarks: [{ title: 'Fixture', url: 'https://example.com/' }] } });
    service.update({ revision: 1, patch: { browserCapture: { enabled: false, text: true, images: false }, browserReferences: { customSites: [{ id: 'custom-1', title: 'Fixture', url: 'https://example.com/', category: 'inspiration', description: 'Saved reference' }], hiddenUrls: ['https://hidden.example/'] } } });
    expect(new BrowserPreferencesService(db).read()).toEqual(service.read());
    expect(service.read().preferences.browserBookmarks).toHaveLength(1);
  });
  it('rejects concurrent stale writers without losing another owned key', () => {
    const { service } = setup();
    service.update({ revision: 0, patch: { browserBookmarks: [] } });
    expect(() => service.update({ revision: 0, patch: { browserCapture: { enabled: false, text: false, images: false } } })).toThrow(/changed/i);
    expect(service.read()).toEqual({ revision: 1, preferences: { browserBookmarks: [] } });
  });
  it.each(['javascript:alert(1)', 'file:///etc/passwd', 'https://user:secret@example.com/', '//example.com/'])('rejects unsafe persisted URL %s', url => {
    const { service } = setup();
    expect(() => service.update({ revision: 0, patch: { browserBookmarks: [{ title: 'Bad', url }] } })).toThrow();
    expect(service.read().revision).toBe(0);
  });
  it('rejects malformed and unrelated configuration rather than becoming an app-config backdoor', () => {
    const { service } = setup();
    for (const patch of [{ browserCapture: { enabled: 'yes' } }, { apiKey: 'secret' }, { browserBookmarks: null }, { browserReferences: { hiddenUrls: [], customSites: [{ id: 1 }] } }]) {
      expect(() => service.update({ revision: 0, patch } as never)).toThrow();
    }
  });
  it('never heals corrupt persisted configuration by silently clearing it', () => {
    const { service, db } = setup();
    service.update({ revision: 0, patch: { browserBookmarks: [] } });
    db.prepare('UPDATE browser_preferences SET preferences = ? WHERE id = 1').run('{broken');
    expect(() => service.read()).toThrow();
    expect(() => service.update({ revision: 1, patch: {} })).toThrow();
    expect(db.prepare('SELECT preferences FROM browser_preferences WHERE id = 1').get()).toEqual({ preferences: '{broken' });
  });
});
