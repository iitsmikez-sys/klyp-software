import test from 'node:test';
import assert from 'node:assert/strict';
import { saveTransition, needsNavigationGuard, deleteTarget, trimSelected } from './editor-session.ts';
test('save only confirms the submitted snapshot and errors retain dirty changes',()=>{
 let s:import('./editor-session.ts').SaveState={confirmed:'a',pending:null,error:null};
 s=saveTransition(s,{type:'pending',snapshot:'b'}); assert.equal(s.confirmed,'a');assert.equal(needsNavigationGuard(s,'b'),true);
 s=saveTransition(s,{type:'success'});assert.equal(s.confirmed,'b');assert.equal(needsNavigationGuard(s,'c'),true);
 s=saveTransition(s,{type:'pending',snapshot:'c'});s=saveTransition(s,{type:'error',message:'offline'});assert.equal(s.confirmed,'b');assert.equal(s.error,'offline');
});
test('selection routes delete explicitly',()=>{assert.equal(deleteTarget(null),'none');assert.equal(deleteTarget({type:'caption',id:'a'}),'caption');assert.equal(deleteTarget({type:'video',id:'a'}),'video');});
test('selected trim expands within original bounds and rejects neighbor overlap',()=>{const s=[{id:'a',start_seconds:102,end_seconds:105},{id:'b',start_seconds:110,end_seconds:115}];assert.equal(trimSelected(s,'a',100,109,100,120)[0].start_seconds,100);assert.throws(()=>trimSelected(s,'a',99,109,100,120));assert.throws(()=>trimSelected(s,'a',100,111,100,120));});
