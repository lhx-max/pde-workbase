import { describe, expect, it } from 'vitest';
import { mediaImageOperationDenial } from '../src/api/media.js';

describe('image operation capability contract', () => {
  it('accepts another capable model without a provider-name allowlist', () => {
    const capableStub = {
      id: 'fixture-native-editor', provider: 'fixture-provider',
      imageCapabilities: { imageEdit: true, transparentBackground: true },
    };
    expect(mediaImageOperationDenial(capableStub, 'cutout')).toBeNull();
  });
  it('requires both edit and transparent output, not a generic image capability', () => {
    expect(mediaImageOperationDenial({ id: 'fixture-image', imageCapabilities: { imageEdit: true, transparentBackground: false } }, 'cutout'))
      .toMatchObject({ code: 'MEDIA_CAPABILITY_UNSUPPORTED', missingCapabilities: ['transparentBackground'] });
    expect(mediaImageOperationDenial({ id: 'fixture-unknown' }, 'cutout'))
      .toMatchObject({ missingCapabilities: ['imageEdit', 'transparentBackground'] });
  });
});
