/** Read-only validation for the App standard package and optional project indexes. */
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readFile,readdir,stat} from 'node:fs/promises';
import {parseArgs} from 'node:util';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const {values}=parseArgs({options:{'extra-md':{type:'string',multiple:true}}});
const files:string[]=[];
async function collect(dir:string):Promise<void>{
 for(const entry of await readdir(dir,{withFileTypes:true})){
  const p=path.join(dir,entry.name);
  if(entry.isDirectory())await collect(p);
  else if(entry.isFile()&&entry.name.endsWith('.md'))files.push(p);
 }
}
await collect(path.join(root,'.devin/skills/designai-app-platform'));
for(const extra of values['extra-md']??[]){
 if(!path.isAbsolute(extra))throw Error('--extra-md must be an absolute Markdown path');
 files.push(extra);
}
function prose(content:string):string{
 let marker='';
 return content.split('\n').map(line=>{
  const fence=/^\s*(`{3,}|~{3,})/.exec(line);
  if(fence){if(!marker)marker=fence[1][0];else if(marker===fence[1][0])marker='';return '';}
  return marker?'':line;
 }).join('\n');
}
function headings(content:string):Set<string>{
 const ids=new Set<string>();const seen=new Map<string,number>();
 for(const line of prose(content).split('\n')){
  for(const m of line.matchAll(/\bid\s*=\s*["']([^"']+)["']/g))ids.add(m[1]);
  const m=/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);if(!m)continue;
  const label=m[1].replace(/\[([^\]]+)\]\([^)]*\)/g,'$1').replace(/<[^>]*>/g,'').replace(/[`*_~]/g,'');
  const slug=label.toLowerCase().replace(/[^\p{L}\p{N}\p{M}_\-\s]/gu,'').replace(/\s/g,'-');
  const n=seen.get(slug)??0;seen.set(slug,n+1);ids.add(slug+(n?`-${n}`:''));
 }
 return ids;
}
const errors:Array<{file:string;line?:number;target?:string;message:string}>=[];
let references=0;
const cache=new Map<string,string>();
async function source(p:string){let text=cache.get(p);if(text===undefined){text=await readFile(p,'utf8');cache.set(p,text);}return text;}
for(const file of [...new Set(files)]){
 const content=await source(file);
 let active='';
 for(const [index,line] of content.split('\n').entries()){
  const fence=/^\s*(`{3,}|~{3,})/.exec(line);
  if(fence){if(!active)active=fence[1][0];else if(active===fence[1][0])active='';continue;}
  if(active)continue;
  for(const link of line.matchAll(/\]\((<[^>]+>|[^\s)]+)(?:\s+["'][^)]*)?\)/g)){
   const raw=link[1].replace(/^<|>$/g,'');
   if(/^[a-z][a-z0-9+.-]*:/i.test(raw)||raw.startsWith('//'))continue;
   const [filePart,fragment]=raw.split('#',2);
   const target=path.resolve(path.dirname(file),decodeURIComponent(filePart||path.basename(file)));
   references++;
   try{
    const entry=await stat(target);if(!entry.isFile())continue;
    if(fragment&&target.endsWith('.md')&&!headings(await source(target)).has(decodeURIComponent(fragment)))
     errors.push({file,line:index+1,target:raw,message:'Markdown heading or explicit anchor is missing'});
   }catch{errors.push({file,line:index+1,target:raw,message:'Local file is missing or unreadable'});}
  }
 }
 if(active)errors.push({file,message:'Unclosed fenced code block'});
}
console.log(JSON.stringify({checkedFiles:new Set(files).size,localReferences:references,passed:errors.length===0,errors},null,2));
process.exitCode=errors.length?1:0;
