import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../app/api/twitch/eventsub/route.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module:ts.ModuleKind.CommonJS, target:ts.ScriptTarget.ES2022, esModuleInterop:true } }).outputText;

function handlerWithPendingInsert(error) {
  const streams = {select() { return this; },eq() { return this; },async maybeSingle() { return {data:{id:'stream-1'},error:null}; }};
  const pending = {select() { return this; },eq() { return this; },limit() { return this; },async maybeSingle() { return {data:null,error:null}; },async insert() { return {error}; }};
  const admin = {from(table) { return table === 'streams' ? streams : pending; }};
  const exports = {};
  vm.runInNewContext(code, {exports,require(name) {
    if (name === 'next/server') return {NextResponse:{json:(body,init)=>Response.json(body,init)}};
    if (name === '@/lib/twitch') return {verifyEventSubSignature:()=>true};
    if (name === '@/lib/supabase/admin') return {createAdminClient:()=>admin};
    throw new Error(`Unexpected import ${name}`);
  },process:{env:{DEPLOYMENT_TARGET:'processing'}},JSON,Date,Response,URL,console});
  return exports.POST;
}

test('Twitch webhook returns retryable error when the pending check cannot be saved', async () => {
  const handler = handlerWithPendingInsert({message:'database unavailable'});
  const headers = new Headers({
    'twitch-eventsub-message-id':'event-1',
    'twitch-eventsub-message-timestamp':new Date().toISOString(),
    'twitch-eventsub-message-signature':'sha256=valid',
    'twitch-eventsub-message-type':'notification',
  });
  const req = {headers,text:async()=>JSON.stringify({subscription:{type:'stream.offline'},event:{broadcaster_user_id:'123'}})};
  const response = await handler(req);
  assert.equal(response.status,500);
});
