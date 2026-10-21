import { describe, expect, it } from 'vitest';
import { readerPermissions, writerExecuteRoles, validateRestrictedResource } from '../src/storage/developer-access-policy.js';

describe('developer access policy', () => {
  it('defaults authenticated project users to read without granting anonymous access or writes', () => {
    const result = readerPermissions('users', ['maintainer']);
    expect(result).toContain('read("users")');
    expect(result).not.toContain('read("any")');
    expect(result).not.toContain('create("users")');
    expect(result).not.toContain('update("users")');
    expect(result).not.toContain('delete("users")');
  });
  it('gives only the selected reader team read while preserving explicit service writers', () => {
    const result = readerPermissions('app_developer_readers', ['maintainer', 'service']);
    expect(result).toContain('read("team:app_developer_readers")');
    expect(result).toContain('update("user:service")');
    expect(result.some(value => /(?:create|update|delete)\("(?:users|any|team:)/.test(value))).toBe(false);
  });
  it('does not let readers execute write-capable functions', () => {
    expect(writerExecuteRoles(['maintainer'])).toEqual(['user:maintainer']);
  });
  it('rejects missing writers and malformed role identifiers before touching cloud resources', () => {
    expect(() => readerPermissions('readers', [])).toThrow();
    expect(() => readerPermissions('readers', ['users"):delete("any'])).toThrow();
  });
  it('refuses per-item ACL bypasses and validates all privileges exactly', () => {
    const wanted = readerPermissions('readers', ['maintainer']);
    expect(() => validateRestrictedResource(wanted, wanted, false)).not.toThrow();
    expect(() => validateRestrictedResource([...wanted, 'update("users")'], wanted, false)).toThrow();
    expect(() => validateRestrictedResource(wanted, wanted, true)).toThrow();
  });
});
