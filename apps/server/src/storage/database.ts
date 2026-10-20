import {DatabaseSync, type SQLInputValue} from 'node:sqlite';
import path from 'node:path';
import {mkdirSync} from 'node:fs';
/** Narrow synchronous SQL port for the extracted workflow/media engines.
 * Only their domain tables live here; there is no conversation/message database.
 */
export class Database {
 private readonly database:DatabaseSync;
 constructor(file:string){if(file!==':memory:'&&!path.isAbsolute(file))throw new Error('Database requires an explicit absolute filename');if(file!==':memory:')mkdirSync(path.dirname(file),{recursive:true});this.database=new DatabaseSync(file);this.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON');}
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
