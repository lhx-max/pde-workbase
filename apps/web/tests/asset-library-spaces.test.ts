// @vitest-environment jsdom
import {afterEach,describe,expect,it,vi} from 'vitest';
import {configureAssetLibraryAdapter,createHttpAssetLibrary} from '../src/providers/asset-library';
import {readProjectFolders,syncProjectFolders,writeProjectFolders} from '../src/state/project-folders';
const restores:Array<()=>void>=[];
function source(id:string,folders:Array<{id:string;name:string;createdAt:number}>){const patchSpaces=vi.fn().mockRejectedValue(new Error('offline'));restores.push(configureAssetLibraryAdapter({...createHttpAssetLibrary(),info:vi.fn().mockResolvedValue({source:{kind:'external',id,name:id}}),spaces:vi.fn().mockResolvedValue({folders,initialized:true}),patchSpaces}));return patchSpaces;}
afterEach(()=>{while(restores.length)restores.pop()!();localStorage.clear();});
describe('source-scoped durable space cache',()=>{
 it('does not show one external source spaces in another source',async()=>{source('A',[{id:'a',name:'Space A',createdAt:1}]);await syncProjectFolders();expect(readProjectFolders().map(row=>row.id)).toContain('a');source('B',[{id:'b',name:'Space B',createdAt:2}]);await syncProjectFolders();expect(readProjectFolders().map(row=>row.id)).toEqual(['default-project','b']);});
 it('never replays an offline outbox into another selected external source',async()=>{const patchA=source('A',[{id:'a',name:'Space A',createdAt:1}]);await syncProjectFolders();writeProjectFolders('local',[{id:'a',name:'Renamed A',createdAt:1}]);await expect(syncProjectFolders()).rejects.toThrow('offline');expect(patchA).toHaveBeenCalled();const patchB=source('B',[]);await syncProjectFolders();expect(patchB).not.toHaveBeenCalled();});
});
