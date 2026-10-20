import { describe, expect, it } from 'vitest';
import {
  TEAM_DISSOLVE_CONFIRMATION_EN,
  TEAM_DISSOLVE_CONFIRMATION_LEGACY_ZH,
  TEAM_DISSOLVE_CONFIRMATION_TOKEN,
  isTeamDissolveConfirmation,
} from '../src/api/team-authority.js';

describe('team dissolve confirmation contract', () => {
  it('accepts the stable token and both shipped UI phrases', () => {
    expect(isTeamDissolveConfirmation(TEAM_DISSOLVE_CONFIRMATION_TOKEN)).toBe(true);
    expect(isTeamDissolveConfirmation(TEAM_DISSOLVE_CONFIRMATION_LEGACY_ZH)).toBe(true);
    expect(isTeamDissolveConfirmation(TEAM_DISSOLVE_CONFIRMATION_EN)).toBe(true);
  });

  it('rejects lookalikes so ACL still requires an explicit phrase', () => {
    expect(isTeamDissolveConfirmation('yes')).toBe(false);
    expect(isTeamDissolveConfirmation('解散')).toBe(false);
    expect(isTeamDissolveConfirmation('dissolve team')).toBe(false);
    expect(isTeamDissolveConfirmation('')).toBe(false);
    expect(isTeamDissolveConfirmation(null)).toBe(false);
  });
});
