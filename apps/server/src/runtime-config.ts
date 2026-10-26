import path from 'node:path';

/** Deployment checks are pure: do not load secrets, open listeners or create data. */
export function canvasRuntimeConfigErrors(env: NodeJS.ProcessEnv): string[] {
  const errors: string[] = [];
  const production = env.NODE_ENV === 'production';
  const keys = ['APPWRITE_ENDPOINT', 'APPWRITE_PROJECT', 'APPWRITE_DATABASE', 'APPWRITE_BUCKET', 'APPWRITE_API_KEY', 'APPWRITE_SESSION_SECRET', 'APPWRITE_SESSION_COOKIE'] as const;
  const cloud = keys.some(key => Boolean(env[key]?.trim()));
  const local = env.CANVAS_STORAGE_MODE === 'local-test';
  if (env.CANVAS_STORAGE_MODE && !['appwrite', 'local-test'].includes(env.CANVAS_STORAGE_MODE)) errors.push('CANVAS_STORAGE_MODE must be appwrite or local-test');
  if (local && cloud) errors.push('local-test cannot be combined with Appwrite configuration');
  if (!local && !cloud) errors.push('Explicit Appwrite storage is required');
  if(Boolean(env.CANVAS_IMAGE_APP_ORIGIN)!==Boolean(env.CANVAS_IMAGE_APPLICATION_ID))errors.push('Independent Image requires both CANVAS_IMAGE_APP_ORIGIN and CANVAS_IMAGE_APPLICATION_ID');
  if(env.CANVAS_IMAGE_APP_ORIGIN){
    try{const url=new URL(env.CANVAS_IMAGE_APP_ORIGIN);if(url.origin!==env.CANVAS_IMAGE_APP_ORIGIN||url.username||url.password||(url.protocol!=='https:'&&(production||url.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(url.hostname))))errors.push('CANVAS_IMAGE_APP_ORIGIN requires an exact trusted HTTPS origin (loopback HTTP outside production)');}catch{errors.push('CANVAS_IMAGE_APP_ORIGIN is invalid');}
    if(!env.CANVAS_TRUSTED_APP_ORIGINS?.split(',').map(s=>s.trim()).includes(env.CANVAS_IMAGE_APP_ORIGIN))errors.push('Independent Image origin must be explicitly listed in CANVAS_TRUSTED_APP_ORIGINS');
  }
  if (cloud) {
    for (const key of ['APPWRITE_ENDPOINT', 'APPWRITE_PROJECT', 'APPWRITE_DATABASE', 'APPWRITE_BUCKET', 'APPWRITE_RUNTIME_COLLECTION', 'CANVAS_RUNTIME_NAMESPACE'] as const)
      if (!env[key]?.trim()) errors.push(`${key} is required for cloud storage`);
    if (!env.APPWRITE_API_KEY?.trim() && !env.APPWRITE_SESSION_SECRET?.trim() && !env.APPWRITE_SESSION_COOKIE?.trim()) errors.push('Cloud storage requires a backend credential');
    if (env.CANVAS_APPWRITE_SINGLE_WRITER !== 'true' || env.CANVAS_REPLICAS !== '1') errors.push('Cloud storage requires exactly one writer replica');
  }
  if (production) {
    if(env.APPWRITE_SESSION_MODE)errors.push('Production maintenance session mode is forbidden');
    if (local || !cloud) errors.push('Production requires cloud storage');
    if (env.APPWRITE_SESSION_SECRET || env.APPWRITE_SESSION_COOKIE) errors.push('Production maintenance sessions are forbidden');
    if (!env.APPWRITE_API_KEY?.trim()) errors.push('Production requires an Appwrite runtime service key');
    if (!env.APPWRITE_DATABASE || env.APPWRITE_DATABASE.endsWith('_dev') || !env.APPWRITE_BUCKET || env.APPWRITE_BUCKET === 'canvas_assets_v2') errors.push('Production requires separately provisioned private storage');
    const authority = Boolean(env.MAV_API_ORIGIN?.trim()) || env.MAV_API_TRANSPORT === 'appwrite' && Boolean(env.MAV_APPWRITE_ENDPOINT?.trim()) && Boolean(env.MAV_APPWRITE_PROJECT_ID?.trim());
    if (!authority) errors.push('Production requires verified MA authority');
    if (!env.CANVAS_WEB_URL?.trim()) errors.push('Production requires CANVAS_WEB_URL');
    for (const key of ['APPWRITE_ENDPOINT', 'MAV_API_ORIGIN', 'MAV_APPWRITE_ENDPOINT', 'CANVAS_WEB_URL'] as const) {
      const raw = env[key]?.trim();
      if (!raw) continue;
      try {
        const url = new URL(raw);
        if (url.protocol !== 'https:' || url.username || url.password || url.hash) errors.push(`${key} must be a credential-free HTTPS URL`);
      } catch { errors.push(`${key} must be a valid HTTPS URL`); }
    }
    const dataRoot = env.CANVAS_DATA_DIR;
    if (!dataRoot || !path.isAbsolute(dataRoot)) errors.push('Production requires an explicit absolute CANVAS_DATA_DIR for disposable working files');
    else {
      const packageRoot = path.resolve(import.meta.dirname, '..');
      const resolved = path.resolve(dataRoot);
      if (resolved === packageRoot || resolved.startsWith(packageRoot + path.sep)) errors.push('CANVAS_DATA_DIR must be outside the application source');
    }
    if (env.CANVAS_PROVIDER_LOCAL_DEVELOPMENT === 'true') errors.push('Local Provider identity is forbidden in production');
  }
  return errors;
}
