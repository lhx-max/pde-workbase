/** Reference manifest for the standalone Provider example and its tests. */
export const notesManifest = {
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
