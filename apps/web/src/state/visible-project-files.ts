import {PROJECT_LAYOUT,type ProjectFile} from '@bezier/contracts';
// Original default project file-list visibility (projects.ts collectFiles) plus
// FileWorkspace's live-artifact implementation guard. This is a UI projection;
// it never changes the source list, deletes records, or prevents direct reads.
const ignoredDirectories=new Set(['node_modules','vendor','debug','dist','build','deriveddata','target','out','coverage','venv','__pycache__']);
export function isVisibleProjectFilePath(path:string):boolean{
 const normalized=path.replaceAll('\\','/').replace(/^\.\//,'');
 const parts=normalized.split('/').filter(Boolean);const name=parts.at(-1)||'';
 if(parts.some(part=>part.startsWith('.')))return false;
 if(parts.slice(0,-1).some(part=>ignoredDirectories.has(part.toLowerCase())||part.toLowerCase().startsWith('deriveddata-')))return false;
 if(name.endsWith('.artifact.json')||name==='canvas-state.json')return false;
 if(/(^|\/)整理\/workflows\/[^/]+\/runtime\/(events\.jsonl|snapshot\.json)$/u.test(normalized))return false;
 if([PROJECT_LAYOUT.liveArtifacts,'.live-artifacts'].some(directory=>normalized===directory||normalized.startsWith(`${directory}/`)))return false;
 return true;
}
export function visibleProjectFiles(files:readonly ProjectFile[]):ProjectFile[]{return files.filter(file=>isVisibleProjectFilePath(file.name));}
