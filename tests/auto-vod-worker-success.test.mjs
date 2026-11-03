import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as planLimits from '../lib/plan-limits.ts';
import * as entitlement from '../lib/auto-clip-entitlement.ts';
import * as clipExtras from "../lib/clip-extras.ts";

const source = readFileSync(new URL('../lib/vod-poll.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module:ts.ModuleKind.CommonJS, target:ts.ScriptTarget.ES2022, esModuleInterop:true } }).outputText;

test('published Twitch VOD runs analysis, saves clips, charges once, and notifies', async () => {
  const job = {id:'job-1',user_id:'user-1',stream_id:'stream-1',video_id:'123',url:'https://www.twitch.tv/videos/123',duration_seconds:3600,attempts:1};
  const clips = [{title:'Funny moment',type:'FUNNY',viral_score:81,caption:'A caption',reason:'A reason',start_seconds:10,end_seconds:35,hooks:['A HOOK'],words:[]}];
  let claimed = false;
  let pipelineCalls = 0;
  let completion;
  const notifications = [];
  const pending = {select() {return this;},lte() {return this;},lt() {return this;},async limit() {return {data:[],error:null};}};
  const admin = {
    async rpc(name,args) {
      if (name === 'claim_auto_vod_job') {if (claimed) return {data:[],error:null}; claimed=true; return {data:[job],error:null};}
      if (name === 'admin_get_profile') return {data:{id:job.user_id,sparks:500},error:null};
      if (name === 'finish_auto_vod_job') {completion=args; return {data:true,error:null};}
      throw new Error(`Unexpected RPC ${name}`);
    },
    from(table) {
      if (table === 'streams') return { select() { return this; }, eq() { return this; }, async maybeSingle() { return { data: { id: job.stream_id, user_id: job.user_id, twitch_login: 'fixture' }, error: null }; } };
      if (table === 'profiles') return { select() { return this; }, eq() { return this; }, async maybeSingle() { return { data: { tier: 'pro', stripe_subscription_id: 'sub_fixture' }, error: null }; } };
      if (table === 'pending_vod_checks') return pending;
      if (table === 'notifications') return {insert:async row=>{notifications.push(row);return {error:null};}};
      throw new Error(`Unexpected table ${table}`);
    },
  };
  const modules = {
    "@/lib/clip-extras": clipExtras,
    'fs/promises':{mkdtemp:async()=> 'fixture-dir',rm:async()=>{}},
    os:{tmpdir:()=> 'fixture-tmp'},path:{join:(...parts)=>parts.join('/')},
    '@/lib/supabase/admin':{createAdminClient:()=>admin},
    '@/lib/twitch':{getRecentVods:async()=>[],parseTwitchDuration:()=>3600},
    '@/lib/vod-discovery':{unseenVods:()=>[]},
    '@/lib/analyze-pipeline':{runAnalysisPipeline:async()=>{pipelineCalls++;return {clips,durationSeconds:3600};}},
    '@/lib/vod-discovery-pipeline':{runDiscoveryPipeline:async()=>{throw new Error('unexpected discovery v2');}},
    '@/lib/vod-source':{vodSourceKey:()=> 'twitch:123'},
    '@/lib/anthropic-credit':{anthropicCreditGate:{blockOn(){}},isAnthropicCreditBalanceError:()=>false,pauseAutomaticClipping:async()=>{}},
    '@/lib/creator-feedback-data':{preferencesForUser:async()=>''},
    '@/lib/clip-archive-worker':{processClipArchiveJobs:async()=>{}},
    '@/lib/r2-maintenance':{processR2Maintenance:async()=>{}},
    '@/lib/job-queue':{runQueued:(_label,fn)=>fn()},
    '@/lib/plan-limits': planLimits, '@/lib/auto-clip-entitlement': entitlement,
    '@/lib/sparks':{estimateSparks:()=>30,clipCharge:()=>10,analysisCharge:()=>40,CLIP_COUNT_COST:{3:10},DEFAULT_CLIP_COUNT:3},
  };
  const exports = {};
  vm.runInNewContext(code,{exports,require:name=>{if (!(name in modules)) throw new Error(`Unexpected import ${name}`);return modules[name];},process:{env:{}},console:{log(){},warn(){},error(){}},setInterval(){},setTimeout,Date,Error,Math,Number,String,Promise});
  exports.startAutoClipWorker();
  await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal(pipelineCalls,1);
  assert.equal(completion?.p_job_id,job.id);
  assert.equal(completion?.p_cost,40);
  assert.equal(completion?.p_clips?.length,1);
  assert.match(notifications[0]?.message ?? '',/1 clip ready/);
});

test('automatic clipping saves top picks only: near-miss extras are left for the dashboard results page', async () => {
  const job = {id:'job-1',user_id:'user-1',stream_id:'stream-1',video_id:'123',url:'https://www.twitch.tv/videos/123',duration_seconds:3600,attempts:1};
  const clips = [{title:'Funny moment',type:'FUNNY',viral_score:81,caption:'A caption',reason:'A reason',start_seconds:10,end_seconds:35,hooks:['A HOOK'],words:[]},{title:'Decent extra',type:'FUNNY',viral_score:60,caption:'c',reason:'r',start_seconds:400,end_seconds:430,hooks:['H'],words:[]}];
  let claimed = false;
  let pipelineCalls = 0;
  let completion;
  const notifications = [];
  const pending = {select() {return this;},lte() {return this;},lt() {return this;},async limit() {return {data:[],error:null};}};
  const admin = {
    async rpc(name,args) {
      if (name === 'claim_auto_vod_job') {if (claimed) return {data:[],error:null}; claimed=true; return {data:[job],error:null};}
      if (name === 'admin_get_profile') return {data:{id:job.user_id,sparks:500},error:null};
      if (name === 'finish_auto_vod_job') {completion=args; return {data:true,error:null};}
      throw new Error(`Unexpected RPC ${name}`);
    },
    from(table) {
      if (table === 'streams') return { select() { return this; }, eq() { return this; }, async maybeSingle() { return { data: { id: job.stream_id, user_id: job.user_id, twitch_login: 'fixture' }, error: null }; } };
      if (table === 'profiles') return { select() { return this; }, eq() { return this; }, async maybeSingle() { return { data: { tier: 'pro', stripe_subscription_id: 'sub_fixture' }, error: null }; } };
      if (table === 'pending_vod_checks') return pending;
      if (table === 'notifications') return {insert:async row=>{notifications.push(row);return {error:null};}};
      throw new Error(`Unexpected table ${table}`);
    },
  };
  const modules = {
    "@/lib/clip-extras": clipExtras,
    'fs/promises':{mkdtemp:async()=> 'fixture-dir',rm:async()=>{}},
    os:{tmpdir:()=> 'fixture-tmp'},path:{join:(...parts)=>parts.join('/')},
    '@/lib/supabase/admin':{createAdminClient:()=>admin},
    '@/lib/twitch':{getRecentVods:async()=>[],parseTwitchDuration:()=>3600},
    '@/lib/vod-discovery':{unseenVods:()=>[]},
    '@/lib/analyze-pipeline':{runAnalysisPipeline:async()=>{pipelineCalls++;return {clips,durationSeconds:3600};}},
    '@/lib/vod-discovery-pipeline':{runDiscoveryPipeline:async()=>{throw new Error('unexpected discovery v2');}},
    '@/lib/vod-source':{vodSourceKey:()=> 'twitch:123'},
    '@/lib/anthropic-credit':{anthropicCreditGate:{blockOn(){}},isAnthropicCreditBalanceError:()=>false,pauseAutomaticClipping:async()=>{}},
    '@/lib/creator-feedback-data':{preferencesForUser:async()=>''},
    '@/lib/clip-archive-worker':{processClipArchiveJobs:async()=>{}},
    '@/lib/r2-maintenance':{processR2Maintenance:async()=>{}},
    '@/lib/job-queue':{runQueued:(_label,fn)=>fn()},
    '@/lib/plan-limits': planLimits, '@/lib/auto-clip-entitlement': entitlement,
    '@/lib/sparks':{estimateSparks:()=>30,clipCharge:()=>10,analysisCharge:()=>40,CLIP_COUNT_COST:{3:10},DEFAULT_CLIP_COUNT:3},
  };
  const exports = {};
  vm.runInNewContext(code,{exports,require:name=>{if (!(name in modules)) throw new Error(`Unexpected import ${name}`);return modules[name];},process:{env:{}},console:{log(){},warn(){},error(){}},setInterval(){},setTimeout,Date,Error,Math,Number,String,Promise});
  exports.startAutoClipWorker();
  await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal(pipelineCalls,1);
  assert.equal(completion?.p_job_id,job.id);
  assert.equal(completion?.p_cost,40);
  assert.equal(completion?.p_clips?.length,1);
  assert.match(notifications[0]?.message ?? '',/1 clip ready/);
});

test('insufficient Sparks stops automatic clipping before any provider call', async () => {
  const job = {id:'job-low-balance',user_id:'user-1',stream_id:'stream-1',video_id:'123',url:'https://www.twitch.tv/videos/123',duration_seconds:3600,attempts:1};
  let providerCalls = 0;
  let failed;
  const notices = [];
  const pending = {select() {return this;},lte() {return this;},lt() {return this;},async limit() {return {data:[],error:null};}};
  const admin = {
    async rpc(name,args) {
      if (name === 'claim_auto_vod_job') return {data:[job],error:null};
      if (name === 'admin_get_profile') return {data:{id:job.user_id,sparks:0},error:null};
      if (name === 'fail_auto_vod_job') {failed=args;return {data:'retry',error:null};}
      throw new Error(`Unexpected RPC ${name}`);
    },
    from(table) {
      if (table === 'streams') return { select() { return this; }, eq() { return this; }, async maybeSingle() { return { data: { id: job.stream_id, user_id: job.user_id, twitch_login: 'fixture' }, error: null }; } };
      if (table === 'profiles') return { select() { return this; }, eq() { return this; }, async maybeSingle() { return { data: { tier: 'pro', stripe_subscription_id: 'sub_fixture' }, error: null }; } };
      if (table === 'pending_vod_checks') return pending;
      if (table === 'notifications') return {insert:async row=>{notices.push(row);return {error:null};}};
      throw new Error(`Unexpected table ${table}`);
    },
  };
  const modules = {
    "@/lib/clip-extras": clipExtras,
    'fs/promises':{mkdtemp:async()=> 'fixture-dir',rm:async()=>{}},os:{tmpdir:()=> 'fixture-tmp'},path:{join:(...parts)=>parts.join('/')},
    '@/lib/supabase/admin':{createAdminClient:()=>admin},'@/lib/twitch':{getRecentVods:async()=>[],parseTwitchDuration:()=>3600},
    '@/lib/vod-discovery':{unseenVods:()=>[]},'@/lib/analyze-pipeline':{runAnalysisPipeline:async()=>{providerCalls++;throw new Error('unexpected');}},
    '@/lib/vod-discovery-pipeline':{runDiscoveryPipeline:async()=>{providerCalls++;throw new Error('unexpected');}},
    '@/lib/vod-source':{vodSourceKey:()=> 'twitch:123'},
    '@/lib/anthropic-credit':{anthropicCreditGate:{blockOn(){}},isAnthropicCreditBalanceError:()=>false,pauseAutomaticClipping:async()=>{}},
    '@/lib/creator-feedback-data':{preferencesForUser:async()=>''},'@/lib/clip-archive-worker':{processClipArchiveJobs:async()=>{}},
    '@/lib/r2-maintenance':{processR2Maintenance:async()=>{}},
    '@/lib/job-queue':{runQueued:(_label,fn)=>fn()},
    '@/lib/plan-limits': planLimits, '@/lib/auto-clip-entitlement': entitlement,
    '@/lib/sparks':{estimateSparks:()=>30,clipCharge:()=>10,analysisCharge:()=>40,CLIP_COUNT_COST:{3:10},DEFAULT_CLIP_COUNT:3},
  };
  const exports = {};
  vm.runInNewContext(code,{exports,require:name=>{if (!(name in modules)) throw new Error(`Unexpected import ${name}`);return modules[name];},process:{env:{}},console:{log(){},warn(){},error(){}},setInterval(){},setTimeout,Date,Error,Math,Number,String,Promise});
  exports.startAutoClipWorker();
  await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal(providerCalls,0);
  assert.equal(failed?.p_job_id,job.id);
  assert.match(notices[0]?.message ?? '',/top up Sparks/);
});
