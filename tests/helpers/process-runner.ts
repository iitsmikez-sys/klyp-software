import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as childProcess from 'node:child_process';
import vm from 'node:vm';
import ts from 'typescript';
import { EventEmitter } from 'node:events';

/** Exercise the production runner while timeout fixtures exit on their own after 500 ms.
 * The Windows taskkill subprocess is outside this test's classification boundary and
 * cannot complete reliably in the sandbox. Unix signal handling stays untouched. */
export function testProcessRunner(): typeof import('../../lib/bin.ts') {
 const realRequire=createRequire(import.meta.url);
 const code=ts.transpileModule(readFileSync(new URL('../../lib/bin.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
 const context={exports:{} as typeof import('../../lib/bin.ts'),require:(name:string)=>name==='child_process'?{
  ...childProcess,spawn:(command:string,args:string[],options:childProcess.SpawnOptions)=>{
   // Windows reports a child self-SIGKILL as exit 1. Inject the documented Unix
   // exit/close signal events at the OS boundary to cover that production path.
   if(command==='klyp-signal-fixture') {
    const child=Object.assign(new EventEmitter(),{stdout:new EventEmitter(),stderr:new EventEmitter()});
    queueMicrotask(()=>{child.emit('exit',null,'SIGKILL');child.emit('close',null,'SIGKILL');});
    return child;
   }
   return command==='taskkill'?childProcess.spawn(process.execPath,['-e',''],options):childProcess.spawn(command,args,options);
  },
 }:realRequire(name),process,Buffer,console,setTimeout,clearTimeout};
 vm.runInNewContext(code,context);
 return context.exports;
}
