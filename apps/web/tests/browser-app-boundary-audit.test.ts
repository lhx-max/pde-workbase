import {afterEach,it,expect,vi} from 'vitest';
import {proxyBrowserAppRequest} from '../src/server/browser-app-proxy';
import {browserAppFetch} from '../src/app-surfaces/browser-transport';
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
it('does not let an untrusted browser Origin borrow the host service credential',async()=>{
 vi.stubEnv('NODE_ENV','development');vi.stubEnv('CANVAS_WEB_URL','http://127.0.0.1:17580');vi.stubEnv('BROWSER_APP_AUTH_TOKEN','fixture-service-key');const forwarded=vi.fn(async()=>Response.json({ok:true}));vi.stubGlobal('fetch',forwarded);
 const result=await proxyBrowserAppRequest(new Request('http://127.0.0.1:17580/api/browser-app/api/projects',{method:'POST',headers:{origin:'https://untrusted.example','content-type':'application/json'},body:'{}'}),{path:['api','projects']});expect(result.status).toBe(403);expect(forwarded).not.toHaveBeenCalled();
});
it('does not forward credential-bearing requests through upstream redirects',async()=>{
 vi.stubEnv('NODE_ENV','development');vi.stubEnv('CANVAS_WEB_URL','http://127.0.0.1:17580');vi.stubGlobal('fetch',vi.fn(async()=>new Response(null,{status:307,headers:{location:'https://untrusted.example/steal'}})));
 const result=await proxyBrowserAppRequest(new Request('http://127.0.0.1:17580/api/browser-app/api/projects',{headers:{'x-mav-sso-authorization':'Bearer fixture'}}),{path:['api','projects']});expect(result.status).toBe(502);expect(result.headers.get('location')).toBeNull();
});
it('blocks a missed rewrite from reaching the canvas API',async()=>{
 vi.stubGlobal('location',{origin:'http://127.0.0.1:17580'});const forwarded=vi.fn(async()=>Response.json({ok:true}));vi.stubGlobal('fetch',forwarded);
 await expect(browserAppFetch('/api/projects/host-canvas',{method:'DELETE'})).rejects.toThrow();expect(forwarded).not.toHaveBeenCalled();
});
it('strips business credentials from external image/resource reads',async()=>{
 vi.stubGlobal('location',{origin:'http://127.0.0.1:17580'});const forwarded=vi.fn(async(_input:RequestInfo|URL,_init?:RequestInit)=>new Response('image'));vi.stubGlobal('fetch',forwarded);
 await browserAppFetch('https://images.example/file.png',{headers:{'x-mav-sso-authorization':'Bearer fixture','authorization':'Bearer fixture','x-team-id':'fixture-team'},credentials:'include'});
 const init=forwarded.mock.calls[0]?.[1];const headers=new Headers(init?.headers);expect(headers.has('x-mav-sso-authorization')).toBe(false);expect(headers.has('authorization')).toBe(false);expect(headers.has('x-team-id')).toBe(false);expect(init?.credentials).toBe('omit');
});
