import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { testProcessRunner } from '../tests/helpers/process-runner.ts';
const {run}=testProcessRunner();

test('runner preserves missing executable identity and its existing human-readable error',async()=>{
 await assert.rejects(run(path.join(tmpdir(),'klyp-missing-executable'),[]),(error:any)=>error.kind==='spawn'&&error.code==='ENOENT'&&/not installed or not on PATH/.test(error.message));
});
for(const option of ['maxRunMs','stallTimeoutMs'] as const) test(`runner marks ${option} as timeout without changing its error message`,async()=>{
 await assert.rejects(run(process.execPath,['-e','setTimeout(()=>{},500)'],{[option]:100}),(error:any)=>error.kind==='timeout'&&/timed out|stalled/.test(error.message));
});
test('runner distinguishes resource exhaustion, signals and ordinary nonzero exits',async()=>{
 await assert.rejects(run(process.execPath,['-e','process.stderr.write("Cannot allocate memory");process.exit(1)']),(error:any)=>error.kind==='resource'&&error.exitCode===1);
 await assert.rejects(run('klyp-signal-fixture',[]),(error:any)=>error.kind==='signal'&&error.signal==='SIGKILL');
 await assert.rejects(run(process.execPath,['-e','process.stderr.write("invalid data");process.exit(1)']),(error:any)=>error.kind==='exit'&&error.exitCode===1&&/exited with code 1: invalid data/.test(error.message));
});
