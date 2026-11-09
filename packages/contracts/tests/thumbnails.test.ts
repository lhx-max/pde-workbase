import { describe, expect, it } from 'vitest';
import { thumbnailDocumentRequestSchema, thumbnailPageQuerySchema } from '../src/api/thumbnails.js';

const input = { source: { kind: 'project-file', projectId: 'project', filename: 'deck.html' }, mode: 'deck', viewport: { width: 1600, height: 900 } };
describe('thumbnail API contract', () => {
  it('accepts typed sources and bounded editor content, never arbitrary URL authority', () => {
    expect(thumbnailDocumentRequestSchema.parse({ ...input, html: '<h1>Draft</h1>' }).html).toBe('<h1>Draft</h1>');
    for (const source of [{ kind: 'url', url: 'file:///private' }, { kind: 'project-file', projectId: 'project', filename: 'deck.html', url: 'http://localhost/' }]) {
      expect(thumbnailDocumentRequestSchema.safeParse({ ...input, source }).success).toBe(false);
    }
  });
  it.each([
    { width: 0, height: 900 }, { width: 4097, height: 900 },
    { width: 4096, height: 4096 }, { width: 1600.5, height: 900 },
  ])('rejects invalid or excessive viewport %j', viewport => {
    expect(thumbnailDocumentRequestSchema.safeParse({ ...input, viewport }).success).toBe(false);
  });
  it('accepts only the two image buckets and explicit priority levels', () => {
    expect(thumbnailPageQuerySchema.parse({})).toEqual({ width: 320, priority: 'visible' });
    expect(thumbnailPageQuerySchema.parse({ width: '640', priority: 'active' })).toEqual({ width: 640, priority: 'active' });
    expect(thumbnailPageQuerySchema.safeParse({ width: '4096' }).success).toBe(false);
    expect(thumbnailPageQuerySchema.safeParse({ priority: 'unlimited' }).success).toBe(false);
  });
});
