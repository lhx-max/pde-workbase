import {describe, expect, it} from 'vitest';
import {canvasRuntimeConfigErrors} from '../src/runtime-config.js';

const production = {
  NODE_ENV:'production', CANVAS_STORAGE_MODE:'appwrite', APPWRITE_ENDPOINT:'https://storage.example/v1',
  APPWRITE_PROJECT:'project', APPWRITE_DATABASE:'canvas_staging', APPWRITE_BUCKET:'canvas_staging_assets',
  APPWRITE_API_KEY:'fixture-service-key', APPWRITE_RUNTIME_COLLECTION:'app_runtime_state', CANVAS_RUNTIME_NAMESPACE:'staging',
  CANVAS_APPWRITE_SINGLE_WRITER:'true', CANVAS_REPLICAS:'1', MAV_API_ORIGIN:'https://ma.example',
  CANVAS_WEB_URL:'https://canvas.example', CANVAS_DATA_DIR:'/var/run/canvas-working',
};
describe('canvas deployment configuration',()=>{
  it('accepts explicit single-writer cloud deployment and explicit isolated local tests',()=>{
    expect(canvasRuntimeConfigErrors(production)).toEqual([]);
    expect(canvasRuntimeConfigErrors({CANVAS_STORAGE_MODE:'local-test'})).toEqual([]);
  });
  it('does not use a partial cloud config as permission to fall back',()=>{
    expect(canvasRuntimeConfigErrors({APPWRITE_API_KEY:'fixture'})).toContain('APPWRITE_ENDPOINT is required for cloud storage');
    expect(canvasRuntimeConfigErrors({CANVAS_STORAGE_MODE:'local-test',APPWRITE_ENDPOINT:production.APPWRITE_ENDPOINT})).toContain('local-test cannot be combined with Appwrite configuration');
  });
  it('rejects production developer storage, maintenance identity and local Provider shortcuts',()=>{
    const errors=canvasRuntimeConfigErrors({...production,APPWRITE_DATABASE:'canvas_app_dev',APPWRITE_SESSION_COOKIE:'fixture',CANVAS_PROVIDER_LOCAL_DEVELOPMENT:'true'});
    expect(errors).toContain('Production requires separately provisioned private storage');
    expect(errors).toContain('Production maintenance sessions are forbidden');
    expect(errors).toContain('Local Provider identity is forbidden in production');
  });
  it('requires real authority even when a static canvas token exists',()=>{
    expect(canvasRuntimeConfigErrors({...production,MAV_API_ORIGIN:undefined,CANVAS_AUTH_TOKEN:'fixture'})).toContain('Production requires verified MA authority');
  });
  it('rejects public HTTP, URL credentials, source-owned caches and multiple replicas',()=>{
    const errors=canvasRuntimeConfigErrors({...production,CANVAS_REPLICAS:'2',APPWRITE_ENDPOINT:'http://storage.example',MAV_API_ORIGIN:'https://user:password@ma.example',CANVAS_DATA_DIR:new URL('../',import.meta.url).pathname.replace(/\/$/,'')});
    expect(errors).toContain('Cloud storage requires exactly one writer replica');
    expect(errors).toContain('APPWRITE_ENDPOINT must be a credential-free HTTPS URL');
    expect(errors).toContain('MAV_API_ORIGIN must be a credential-free HTTPS URL');
    expect(errors).toContain('CANVAS_DATA_DIR must be outside the application source');
  });
});
