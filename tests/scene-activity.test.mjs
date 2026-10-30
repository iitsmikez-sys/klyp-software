import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSceneTimes } from '../lib/scene-activity.ts';

test('scene detector reports timestamps only as candidate signals', () => {
  const text = '[Parsed_showinfo_2] n: 0 pts:123 pts_time:4.2 pos:0\n[Parsed_showinfo_2] n: 1 pts:200 pts_time:8.5 pos:0';
  const points = parseSceneTimes(text, 3600);
  assert.deepEqual(points.map(p => p.seconds), [3604.2, 3608.5]);
  assert.equal('clips' in points, false);
});
