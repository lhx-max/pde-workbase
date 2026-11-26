import { describe, expect, it } from 'vitest';
import { maApplicationManifestSchema, maProviderActionRequestSchema } from '../src/api/ma-applications';

/** 与根 examples/notes-app/manifest.ts 保持同值的测试副本（contracts 的
 * rootDir 不允许测试直接引用包外源文件）。 */
const notesManifest = {
  schemaVersion: 1, slug: 'notes-example', version: '1.0.0', name: '便签示例',
  description: '用于验证 App 接入流程的便签板', instanceMode: 'multiple',
  frontend: { moduleId: 'notes-example', exportName: 'NotesApp' },
  provider: { baseUrl: 'http://127.0.0.1:4310', protocolVersion: '1.0' },
  permissions: ['notes:read', 'notes:write'],
  actions: [
    { id: 'notes.read', title: '读取便签', description: '读取当前便签板和版本', effect: 'read',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false }, requiredPermissions: ['notes:read'] },
    { id: 'notes.add', title: '添加便签', description: '向当前便签板添加文字', effect: 'write',
      inputSchema: { type: 'object', properties: { text: { type: 'string', minLength: 1, maxLength: 500 } }, required: ['text'], additionalProperties: false }, requiredPermissions: ['notes:write'] },
  ],
} as const;

describe('session apps 接入契约', () => {
  it('便签示例 Manifest 通过校验', () => {
    const parsed = maApplicationManifestSchema.parse(notesManifest);
    expect(parsed.slug).toBe('notes-example');
    expect(parsed.frontend.moduleId).toBe('notes-example');
    expect(parsed.actions.map(action => action.id)).toEqual(['notes.read', 'notes.add']);
    expect(parsed.provider.baseUrl).toBe('http://127.0.0.1:4310');
  });

  it.each([
    { missing: 'slug' }, { extra: 'unknownField' }, { badProvider: '127.0.0.1:4310' },
  ])('拒绝非法 Manifest %#', patch => {
    const value: Record<string, unknown> = JSON.parse(JSON.stringify(notesManifest));
    if ('missing' in patch) delete value[patch.missing as string];
    if ('extra' in patch) value.extra = 'x';
    if ('badProvider' in patch) (value.provider as Record<string, unknown>).baseUrl = patch.badProvider;
    expect(maApplicationManifestSchema.safeParse(value).success).toBe(false);
  });

  it('Provider 动作请求校验实例/会话 ID 与 revision', () => {
    const base = { applicationInstanceId: 'ai_000000000000000000000001', sessionId: 'local_dev_session', actionId: 'notes.read', input: {} };
    expect(maProviderActionRequestSchema.safeParse(base).success).toBe(true);
    expect(maProviderActionRequestSchema.safeParse({ ...base, expectedRevision: 3 }).success).toBe(true);
    expect(maProviderActionRequestSchema.safeParse({ ...base, expectedRevision: 0 }).success).toBe(false);
    expect(maProviderActionRequestSchema.safeParse({ ...base, applicationInstanceId: 'ai_not_hex' }).success).toBe(false);
    expect(maProviderActionRequestSchema.safeParse({ ...base, sessionId: '../x' }).success).toBe(false);
  });
});
