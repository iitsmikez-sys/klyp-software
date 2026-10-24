import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createClient} from '@supabase/supabase-js';
import * as assets from './editor-assets.ts';

// Exercise the real Supabase query builder against a bounded PostgREST response.
// Only HTTP/database IO is replaced; filters, ordering and range queries are real.
function repository(fetcher:typeof fetch):assets.EditorAssetRepository {
 const client=createClient('https://database.test','test-key',{global:{fetch:fetcher},auth:{persistSession:false,autoRefreshToken:false}});
 const code=ts.transpileModule(readFileSync(new URL('./editor-assets-store.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const context={exports:{} as any,require:(id:string)=>id==='./editor-assets.ts'?assets:{createAdminClient:()=>client}};
 vm.runInNewContext(code,context);return context.exports.editorAssetRepository();
}

test('asset library includes older referenced assets across database pages',async()=>{
 const rows=Array.from({length:451},(_,i)=>({id:String(i).padStart(4,'0'),created_at:new Date(1700000000000-i*1000).toISOString(),status:'verified',clip_id:'clip',user_id:'owner'}));
 const repo=repository(async(input)=>{
  const url=new URL(String(input));
  assert.equal(url.searchParams.get('user_id'),'eq.owner');assert.equal(url.searchParams.get('clip_id'),'eq.clip');assert.equal(url.searchParams.get('status'),'eq.verified');
  const offset=Number(url.searchParams.get('offset')||0),limit=Math.min(200,Number(url.searchParams.get('limit')||1000));
  return Response.json(rows.slice(offset,offset+limit));
 });
 const result=await repo.list('owner','clip');
 assert.equal(result.length,451);assert.equal(result[450].id,'0450','saved draft can still select its oldest asset');
 assert.equal(new Set(result.map(a=>a.id)).size,451);
});

test('cleanup repository selects only due manifests and deletes paths only after successful storage removal',async()=>{
 const calls:string[]=[];
 const repo=repository(async(input,init)=>{
  const url=new URL(String(input));calls.push(`${init?.method||'GET'} ${url.pathname}`);
  if(url.pathname.endsWith('/editor_asset_cleanup')) {
   if(init?.method==='DELETE'){assert.equal(url.searchParams.get('storage_path'),'in.(owner/clip/a.png)');return new Response(null,{status:204});}
   assert.equal(url.searchParams.get('not_before'),'lt.2026-10-23T00:00:00Z');return Response.json([{storage_path:'owner/clip/a.png'}]);
  }
  assert.equal(url.pathname,'/storage/v1/object/editor-media');
  assert.deepEqual(JSON.parse(String(init?.body)),{prefixes:['owner/clip/a.png']});return Response.json([]);
 });
 const pending=await repo.pendingCleanup('2026-10-23T00:00:00Z');
 assert.equal(pending[0].storage_path,'owner/clip/a.png');
 await repo.removeObjects(pending.map(p=>p.storage_path));await repo.deleteCleanupRecords(pending.map(p=>p.storage_path));
 assert.deepEqual(calls,['GET /rest/v1/editor_asset_cleanup','DELETE /storage/v1/object/editor-media','DELETE /rest/v1/editor_asset_cleanup']);
});
