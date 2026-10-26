import {it,expect,vi} from 'vitest';
import {createMaCanvasTransport} from '../src/platform/ma-transport';
it('obtains a request-scoped SDK credential and replaces spoofed authority headers',async()=>{
 const fetcher=vi.fn(async(_input:RequestInfo|URL,_init?:RequestInit)=>Response.json({ok:true}));const credential=vi.fn(async()=>'Bearer sdk-token');
 const transport=createMaCanvasTransport({baseUrl:'https://app.example.test/provider',tenantId:'team-a',applicationInstanceId:'ai_a',getCredential:credential,fetcher});
 await transport.fetch!('https://app.example.test/provider/api/apps/canvas',{headers:{'x-mav-tenant':'forged'}});
 expect(credential).toHaveBeenCalledOnce();const headers=new Headers(fetcher.mock.calls[0]?.[1]?.headers);expect(headers.get('x-mav-tenant')).toBe('team-a');expect(headers.get('x-mav-sso-authorization')).toBe('Bearer sdk-token');
});
it('does not disclose credentials to a different origin or API prefix',async()=>{
 const credential=vi.fn(async()=>'Bearer sdk-token');const fetcher=vi.fn(async(_input:RequestInfo|URL,_init?:RequestInit)=>Response.json({}));
 const transport=createMaCanvasTransport({baseUrl:'https://app.example.test/provider',tenantId:'team-a',applicationInstanceId:'ai_a',getCredential:credential,fetcher});
 await expect(transport.fetch!('https://outside.example.test/api')).rejects.toThrow();await expect(transport.fetch!('https://app.example.test/private')).rejects.toThrow();expect(credential).not.toHaveBeenCalled();expect(fetcher).not.toHaveBeenCalled();
});
