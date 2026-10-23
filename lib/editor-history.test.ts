import test from 'node:test';
import assert from 'node:assert/strict';
import { reset, apply, undo, redo } from './editor-history.ts';
test('whole snapshots restore split, delete, caption and style; new edits clear redo',()=>{
 const original={segments:['a'],caption:'hello',style:'BOLD'};
 let h=reset(original);
 const edits=[{...original,segments:['a','b']},{...original,segments:['b']},{...original,caption:'corrected'},{...original,style:'CLEAN'}];
 for(const edit of edits) h=apply(h,edit);
 for(let i=edits.length-2;i>=0;i--){h=undo(h);assert.deepEqual(h.present,edits[i]);}
 h=undo(h);assert.deepEqual(h.present,original); h=redo(h);assert.deepEqual(h.present,edits[0]);
 h=apply(h,{...original,caption:'new'});assert.equal(h.future.length,0);
});
