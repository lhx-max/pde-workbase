import { describe, expect, expectTypeOf, it } from 'vitest';
import { settingsSectionToTracking } from '../src/analytics/events/mappers';
import type { TrackingSettingsArea, UiClickProps } from '../src/analytics/events/ui-click';

describe('retired pet settings analytics', () => {
  it('does not map a legacy pet section to an active settings area', () => {
    expect(settingsSectionToTracking('pet')).toBe(settingsSectionToTracking('unknown-retired-section'));
  });
  it('preserves unrelated settings routing', () => {
    expect(settingsSectionToTracking('appearance')).toBe('appearance');
    expect(settingsSectionToTracking('notifications')).toBe('notifications');
    expect(settingsSectionToTracking('orbit')).toBe('orbit');
  });
  it('excludes the removed surface from public analytics contracts', () => {
    expectTypeOf<Extract<TrackingSettingsArea, 'pets'>>().toEqualTypeOf<never>();
    expectTypeOf<Extract<UiClickProps, {area: 'pets'}>>().toEqualTypeOf<never>();
  });
});
