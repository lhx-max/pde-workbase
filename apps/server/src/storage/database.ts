import {createRequire} from 'node:module';
import path from 'node:path';
import {mkdirSync} from 'node:fs';
import type {DatabaseSync as DatabaseSyncType, SQLInputValue} from 'node:sqlite';
/** node:sqlite is unflagged but still experimental from Node 22.13.0. Loading
 * the builtin lazily lets runtimes without it (older Node 22 images) fail the
 * Database constructor with an explicit error instead of crashing the whole
 * module graph at import time. */
const DatabaseSync:typeof DatabaseSyncType|undefined=(()=>{try{return (createRequire('/canvas-entry.js')('node:sqlite') as typeof import('node:sqlite')).DatabaseSync;}catch{return undefined;}})();
/** Narrow synchronous SQL port for the extracted workflow/media engines.
 * Only their domain tables live here; there is no conversation/message database.
 */
export class Database {
 private readonly database:DatabaseSyncType;
 constructor(file:string){if(!DatabaseSync)throw new Error('node:sqlite is unavailable in this runtime (requires Node >=22.13 or the --experimental-sqlite flag)');if(file!==':memory:'&&!path.isAbsolute(file))throw new Error('Database requires an explicit absolute filename');if(file!==':memory:')mkdirSync(path.dirname(file),{recursive:true});this.database=new DatabaseSync(file);this.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON');}
 get inTransaction():boolean{return this.database.isTransaction;}
 prepare(sql:string){const statement=this.database.prepare(sql);return {
  get:(...parameters:SQLInputValue[]):unknown=>statement.get(...parameters),
  all:(...parameters:SQLInputValue[]):unknown[]=>statement.all(...parameters),
  run:(...parameters:SQLInputValue[])=>{const result=statement.run(...parameters);return {changes:Number(result.changes),lastInsertRowid:Number(result.lastInsertRowid)};},
 };}
 exec(sql:string):void{this.database.exec(sql);}
 pragma(sql:string,options?:{simple?:boolean}):unknown{const rows=this.database.prepare(`PRAGMA ${sql}`).all();return options?.simple?Object.values(rows[0]??{})[0]:rows;}
 transaction<T extends unknown[],R>(operation:(...args:T)=>R){
  const run=(mode:string,...args:T):R=>{
   const nested=this.database.isTransaction;const savepoint=`nested_${++this.sequence}`;
   this.exec(nested?`SAVEPOINT ${savepoint}`:`BEGIN ${mode}`);
   try{const result=operation(...args);this.exec(nested?`RELEASE ${savepoint}`:'COMMIT');return result;}catch(error){this.exec(nested?`ROLLBACK TO ${savepoint}; RELEASE ${savepoint}`:'ROLLBACK');throw error;}
  };
  const execute=(...args:T)=>run('DEFERRED',...args);
  return Object.assign(execute,{immediate:(...args:T)=>run('IMMEDIATE',...args),deferred:execute,exclusive:(...args:T)=>run('EXCLUSIVE',...args)});
 }
 private sequence=0;
 close():void{this.database.close();}
}
