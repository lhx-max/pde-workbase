import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { PROJECT_LAYOUT, withCanvasResultHistory, type CanvasOperation } from '@bezier/contracts';
import { assertProjectPathHasNoSymlinks } from '../project-layout.js';
import { CanvasStateError } from './errors.js';

type Item = Record<string, unknown> & { id: string };
export type DocumentOperation = Extract<CanvasOperation, {type:'document.create'|'document.select'|'document.begin'}>;
export async function readCanvasDocument(root:string, relative:string):Promise<string> {
  if (!relative || path.isAbsolute(relative) || relative.includes('\\') || relative.split('/').some(p=>!p || p==='.' || p==='..') || !/\.html?$/i.test(relative))
    throw new CanvasStateError(400,'CANVAS_INVALID_DOCUMENT','Expected a project-relative HTML file');
  assertDocumentPath(root, relative);
  const file=path.join(root,relative),info=await stat(file).catch(()=>null);
  if(!info?.isFile()) throw new CanvasStateError(404,'CANVAS_DOCUMENT_NOT_FOUND','HTML file not found');
  if(info.size>5_000_000) throw new CanvasStateError(400,'CANVAS_INVALID_DOCUMENT','HTML exceeds 5 MB');
  return readFile(file,'utf8');
}

/** A new card owns its HTML copy. Sibling placement preserves relative resources.
 * Subsequent edits use the existing file-version service, not canvas snapshots. */
export async function prepareCanvasDocument(root:string,operationId:string,op:DocumentOperation,current?:Item):Promise<Item> {
  if(op.type==='document.begin') {
    if(!current || current.kind!=='page') throw new CanvasStateError(400,'CANVAS_OPERATION_UNSUPPORTED','Target is not a document');
    if(op.expectedPath!==undefined && (current.projectFilePath||'')!==op.expectedPath) throw new CanvasStateError(409,'CANVAS_REVISION_CONFLICT','Document target changed');
    const output=op.outputPath;
    if(path.isAbsolute(output) || output.includes('\\') || output.split('/').some(p=>!p || p==='.' || p==='..') || !/\.html?$/i.test(output)) throw new CanvasStateError(400,'CANVAS_INVALID_DOCUMENT','Invalid generation output');
    assertDocumentPath(root, output);
    if(await stat(path.join(root,output)).catch(()=>null)) throw new CanvasStateError(409,'CANVAS_INVALID_DOCUMENT','Use a new output path for generation');
    return {...current,generation:{requestId:op.requestId,status:'running',previewPath:output}};
  }
  if(op.type==='document.select') {
    if(!current || current.kind!=='page') throw new CanvasStateError(400,'CANVAS_OPERATION_UNSUPPORTED','Target is not a webpage or presentation');
    if(op.expectedPath!==undefined && current.projectFilePath!==op.expectedPath) throw new CanvasStateError(409,'CANVAS_REVISION_CONFLICT','Document target changed');
    if(![current.projectFilePath,...(Array.isArray(current.resultHistory)?current.resultHistory.map(v=>v.projectFilePath):[])].includes(op.path)) throw new CanvasStateError(400,'CANVAS_INVALID_DOCUMENT','Path is not in this card history');
    await readCanvasDocument(root,op.path);
    return withCanvasResultHistory(current,{projectFilePath:op.path,generation:undefined},['projectFilePath']);
  }
  let relative:string|undefined;
  if(op.source) {
    const html='path' in op.source?await readCanvasDocument(root,op.source.path):op.source.html;
    if(Buffer.byteLength(html, 'utf8') > 5_000_000) throw new CanvasStateError(400,'CANVAS_INVALID_DOCUMENT','HTML exceeds 5 MB');
    if(!html.trim() || !/<(?:html|body|section|div|main|article|!doctype)\b/i.test(html)) throw new CanvasStateError(400,'CANVAS_INVALID_DOCUMENT','Expected HTML content');
    const directory='path' in op.source?path.posix.dirname(op.source.path):PROJECT_LAYOUT.pages;
    const hash=createHash('sha256').update(JSON.stringify([operationId,op.nodeId,html])).digest('hex').slice(0,24);
    relative=path.posix.join(directory,`canvas-${op.format==='presentation'?'deck':'page'}-${hash}.html`);
    assertDocumentPath(root, relative);await mkdir(path.dirname(path.join(root,relative)),{recursive:true});
    try {await writeFile(path.join(root,relative),html,{flag:'wx'});} catch(error) {
      if((error as NodeJS.ErrnoException).code!=='EEXIST' || await readCanvasDocument(root,relative)!==html) throw error;
    }
  }
  return {id:op.nodeId,kind:'page',artifactFormat:op.format,x:op.x,y:op.y,width:op.width || 420,height:op.height || 300,title:op.title || (op.format==='presentation'?'PPT':'网页'),text:op.prompt || '',...(relative?{projectFilePath:relative,sourceMime:'text/html'}:{})};
}

function assertDocumentPath(root: string, relative: string): void {
  try { assertProjectPathHasNoSymlinks(root, relative); }
  catch { throw new CanvasStateError(400, 'CANVAS_INVALID_DOCUMENT', 'Document path must not contain symlinks'); }
}
