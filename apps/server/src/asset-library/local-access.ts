import { PersonalAssetError } from './core.js';
import { currentRequestTenant } from '../tenant.js';

/** The built-in library has one local-personal owner, not tenant-scoped ACLs. */
export class LocalAssetLibraryAccessError extends PersonalAssetError {
  readonly code = 'ASSET_LIBRARY_LOCAL_ONLY';
  constructor() {
    super(403, 'The built-in asset library is local-only; tenant access requires an authorized external asset-library adapter');
  }
}

export function assertLocalAssetLibraryAccess(): void {
  const tenant = currentRequestTenant();
  // Explicitly constructed local/background services have no HTTP caller.
  // HTTP identity is captured by the trusted host adapter before routing.
  if (tenant && (tenant.teamId !== 'local' || tenant.userId !== 'local')) {
    throw new LocalAssetLibraryAccessError();
  }
}
