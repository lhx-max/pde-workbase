import {lstatSync, mkdirSync} from 'node:fs';
import path from 'node:path';
import {Database} from './database.js';

/** Never follow links for the library directory, SQLite file or its sidecars.
 * The configured dataRoot is the only authority; no cwd/env/upstream fallback.
 */
export function openAssetLibraryDatabase(dataRoot:string):Database {
  if (!dataRoot || !path.isAbsolute(dataRoot)) throw new Error('Asset library requires an explicit absolute dataRoot');
  const root=path.resolve(dataRoot);
  const assertEntry=(file:string,directory:boolean)=>{
    try { const stat=lstatSync(file); if(stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile())) throw new Error('Unsafe asset library storage path'); }
    catch(error) { if((error as NodeJS.ErrnoException).code!=='ENOENT') throw error; }
  };
  assertEntry(root,true);mkdirSync(root,{recursive:true});
  const directory=path.join(root,'asset-library');assertEntry(directory,true);mkdirSync(directory,{recursive:true});
  const file=path.join(directory,'library.sqlite');
  for(const suffix of ['', '-wal', '-shm', '-journal']) assertEntry(file+suffix,false);
  return new Database(file);
}
