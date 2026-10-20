import type { PersonalAsset, PersonalAssetCreate } from '@bezier/contracts';
import type { TemplateDemo } from './asset-ui-ports';
export function templateImport(template: TemplateDemo): PersonalAssetCreate & {description:string;tags:string[];style:string;usage:string} {
  const {id,type,referencePath,posterSrc,previewSrc,previewVideo} = template;
  return {name:template.title.replace(/[\\/]/g,'-').slice(0,200),kind:'text',content:template.prompt,
    description:template.description,tags:template.tags,style:template.style || '',usage:template.usage || '',source:{template:{id,type,referencePath,posterSrc,previewSrc,previewVideo}}};
}
export function personalAssetTemplate(asset: PersonalAsset): TemplateDemo | null {
  const source = asset.source.template;
  if (!source || asset.versions.at(-1)?.filename !== 'template-prompt.md') return null;
  return {...source,title:asset.name,description:asset.description,tags:asset.tags,style:asset.style || '',usage:asset.usage || '',
    author:'',accent:'',meta:'',subtype:'',prompt:'',
    cardMedia:source.posterSrc ? {kind:'media',mediaType:'image',poster:source.posterSrc,
      videoUrl:null,audioUrl:null,imageOnly:true,loopHoldMs:null} : null};
}
