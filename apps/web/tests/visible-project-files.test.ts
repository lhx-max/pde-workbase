import {describe,expect,it} from 'vitest';
import type {ProjectFile} from '@bezier/contracts';
import {isVisibleProjectFilePath,visibleProjectFiles} from '../src/state/visible-project-files';
describe('original project assets visibility',()=>{
 it.each(['.bezierdesign/.file-versions/key/uuid.html','.bezierdesign/.file-versions/key/manifest.json','.file-versions/key/uuid.html','.live-artifacts/a/snapshot.html','Presentation.html.artifact.json','canvas-state.json','app/node_modules/lib/index.html','整理/workflows/run/runtime/snapshot.json'])('excludes implementation record %s',path=>expect(isVisibleProjectFilePath(path)).toBe(false));
 it.each(['Presentation.html','outputs/presentations/deck.html','sources/text/node.md','manifest.json','notes.json','app/index.html','images/uuid.png','README.md'])('keeps independently usable project content %s',path=>expect(isVisibleProjectFilePath(path)).toBe(true));
 it('normalizes legacy separators without deleting or mutating source metadata',()=>{const metadata={name:'Presentation.html',kind:'html',size:1,mtime:1,artifactKind:'deck',artifactManifest:{kind:'deck'}} as ProjectFile;const source=[metadata,{name:'.bezierdesign\\.file-versions\\uuid.html',kind:'html',size:1,mtime:1} as ProjectFile];expect(visibleProjectFiles(source)).toEqual([metadata]);expect(source).toHaveLength(2);expect(visibleProjectFiles(source)[0]).toBe(metadata);});
});
