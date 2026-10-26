import { describe, it, expect } from 'vitest';
import { createAppWriteAuthorizer } from '../src/index.js';
const actor = { teamId: 't', bizId: 'b', userId: 'u', applicationId: 'app_doc', applicationInstanceId: 'ai_a', providerInstanceId: 'pid', userVerified: true };
describe('shared MA-scoped write delegation', () => {
  it('defaults to read-only even for an MA instance reader', () => {
    expect(createAppWriteAuthorizer(undefined)(actor, 'doc.write')).toBe(false);
  });
  it('requires exact actor, action and optional application instance', () => {
    const can = createAppWriteAuthorizer(JSON.stringify([{ teamId: 't', bizId: 'b', userId: 'u', applicationInstanceId: 'ai_a', actions: ['doc.write'] }]));
    expect(can(actor, 'doc.write')).toBe(true);
    for (const key of ['teamId', 'bizId', 'userId', 'applicationInstanceId'] as const) expect(can({ ...actor, [key]: 'other' }, 'doc.write')).toBe(false);
    expect(can(actor, 'doc.archive')).toBe(false);
    expect(can({ ...actor, userVerified: false }, 'doc.write')).toBe(false);
    expect(can({ teamId: 't', userId: 'u' }, 'doc.write')).toBe(false);
  });
  it('rejects wildcards, invented roles and malformed grants at configuration time', () => {
    for (const raw of ['{}', '[null]', '[{"teamId":"*","bizId":"b","userId":"u","actions":["doc.write"]}]', '[{"teamId":"t","bizId":"b","userId":"u","actions":["doc.*"]}]', '[{"teamId":"t","bizId":"b","userId":"u","role":"admin","actions":[]}]']) expect(() => createAppWriteAuthorizer(raw)).toThrow();
  });
});
