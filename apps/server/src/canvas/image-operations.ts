import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { PROJECT_LAYOUT, withCanvasResultHistory, type CanvasOperation } from '@bezier/contracts';
import type { AssetLibraryAdapter } from '../asset-library/service.js';
import { assertProjectPathHasNoSymlinks } from '../project-layout.js';
import { CanvasStateError } from './errors.js';

export type ImageOperation = Extract<CanvasOperation, {type:'image.attach'|'image.replace'|'image.transform'|'image.select'}>;
type Item = Record<string, unknown> & {id:string};
const CANVAS_IMAGE_CONTENT_KEYS = ['path', 'name', 'naturalWidth', 'naturalHeight', 'sourceAsset', 'sourceProjectFilePath'];
const invalid = (message:string):never => {throw new CanvasStateError(400,'CANVAS_INVALID_IMAGE',message);};

export async function readCanvasImage(root:string, relative:string):Promise<Buffer> {
  if (!relative || path.isAbsolute(relative) || relative.includes('\\') || relative.split('/').some(p=>!p || p==='.' || p==='..')) invalid('Image must be a project-relative file');
  try { assertProjectPathHasNoSymlinks(root,relative); } catch { invalid('Image path contains a symbolic link or invalid segment'); }
  const file=path.join(root,relative);
  try {
    const info=await stat(file);
    if (!info.isFile() || info.size > 40*1024*1024) invalid('Image must be a file no larger than 40 MB');
    return await readFile(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code==='ENOENT') throw new CanvasStateError(404,'CANVAS_IMAGE_NOT_FOUND','Image file not found');
    throw error;
  }
}

/** Immutable project image snapshots; never fetch a caller-supplied URL. */
export async function prepareCanvasImage(root:string, projectId:string, operationId:string, op:ImageOperation, current?:Item, assets?:AssetLibraryAdapter):Promise<Item> {
  if('expectedPath' in op && op.expectedPath!==undefined && op.expectedPath!==current?.path) throw new CanvasStateError(409,'CANVAS_REVISION_CONFLICT','Selected image version has changed');
  let bytes:Buffer, name:string, sourceAsset:unknown;
  if (op.type==='image.attach' || op.type==='image.replace') {
    if ('assetId' in op.source) {
      if (!assets) throw new CanvasStateError(503,'CANVAS_CAPABILITY_UNAVAILABLE','Asset service unavailable');
      let content:Awaited<ReturnType<AssetLibraryAdapter['content']>>;
      try {content=await assets.content(op.source.assetId,op.source.versionId);} catch(error) {
        if((error as {status?:number}|null)?.status===403)throw new CanvasStateError(403,'CANVAS_ASSET_FORBIDDEN','Image asset source is not authorized for this caller');
        throw new CanvasStateError(404,'CANVAS_ASSET_NOT_FOUND','Image asset/version unavailable');
      }
      if (content.asset.deletedAt) throw new CanvasStateError(404,'CANVAS_ASSET_NOT_FOUND','Image asset/version unavailable');
      if(content.asset.kind!=='image') invalid('Asset is not an image');
      bytes=content.bytes; name=content.asset.name;
      sourceAsset={assetId:content.asset.id,versionId:content.version.id};
    } else { bytes=await readCanvasImage(root,op.source.path); name=path.basename(op.source.path); }
  } else {
    if (!current || !current.path) return invalid('Image has no saved content');
    if (op.type==='image.select' && ![current.path,...(Array.isArray(current.resultHistory)?current.resultHistory.map(v=>v.path):[])].includes(op.path)) invalid('Result is not a version of this image');
    bytes=await readCanvasImage(root,String(op.type==='image.select'?op.path:current.path));
    name=String(current.name || 'image.png');
    const selected=op.type==='image.select' && op.path!==current.path && Array.isArray(current.resultHistory)
      ? current.resultHistory.find(v=>v.path===op.path) : current;
    sourceAsset=selected?.sourceAsset;
    if(selected?.name) name=String(selected.name);
  }
  if (bytes.length > 40*1024*1024) invalid('Image exceeds 40 MB');
  let output:Buffer, width:number, height:number;
  try {
    const metadata=await sharp(bytes,{limitInputPixels:40_000_000}).metadata();
    if (!['png','jpeg','webp','avif','heif','tiff','gif'].includes(metadata.format || '') || (metadata.pages || 1)>1) invalid('Only still raster images are supported');
    const normalized=await sharp(bytes,{limitInputPixels:40_000_000}).rotate().png().toBuffer({resolveWithObject:true});
    let pipeline=sharp(normalized.data,{limitInputPixels:40_000_000});
    if(op.type==='image.transform') {
      if(!op.crop && !op.rotate) invalid('Provide crop or rotate');
      if(op.crop) {
        if(op.crop.x+op.crop.width>normalized.info.width || op.crop.y+op.crop.height>normalized.info.height) invalid('Crop exceeds image bounds');
        pipeline=pipeline.extract({left:op.crop.x,top:op.crop.y,width:op.crop.width,height:op.crop.height});
      }
      if(op.rotate) pipeline=pipeline.rotate(op.rotate);
    }
    const result=await pipeline.png().toBuffer({resolveWithObject:true});
    output=result.data; width=result.info.width; height=result.info.height;
  } catch(error) { if(error instanceof CanvasStateError) throw error; return invalid('Image could not be decoded or processed'); }
  const hash=createHash('sha256').update(output).digest('hex');
  const relative=`${PROJECT_LAYOUT.images}/canvas-${hash}.png`;
  assertProjectPathHasNoSymlinks(root,relative);
  await mkdir(path.dirname(path.join(root,relative)),{recursive:true});
  try { await writeFile(path.join(root,relative),output,{flag:'wx'}); } catch(error) {
    if((error as NodeJS.ErrnoException).code!=='EEXIST') throw error;
    if(!(await readCanvasImage(root,relative)).equals(output)) throw new CanvasStateError(409,'CANVAS_IMAGE_CONTENT_CHANGED','Stored image snapshot has changed');
  }
  const patch={path:relative,src:`/api/projects/${encodeURIComponent(projectId)}/files/${relative.split('/').map(encodeURIComponent).join('/')}`,
    name:op.type==='image.attach' && op.name ? op.name : name,naturalWidth:width,naturalHeight:height,status:'ready',error:undefined,sourceAsset,
    ...(op.type==='image.attach' || op.type==='image.replace' ? ('path' in op.source ? { sourceProjectFilePath: op.source.path } : {}) : {}),
    replacementRequestId:operationId};
  const node=op.type==='image.attach'?{id:op.nodeId,x:op.x,y:op.y,assetKind:'uploaded'}:current!;
  return withCanvasResultHistory(node,patch,CANVAS_IMAGE_CONTENT_KEYS);
}
