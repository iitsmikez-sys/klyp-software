import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

function matches(clip, moment) {
  const overlap = Math.max(0, Math.min(clip.end, moment.end) - Math.max(clip.start, moment.start));
  return overlap >= (moment.end - moment.start) * 0.5 &&
    clip.start <= moment.start + 10 && clip.end >= moment.end - 10;
}

export function scoreRun(run, gold, vodSeconds) {
  const found = gold.filter(moment => run.clips.some(clip => matches(clip, moment)));
  const dimensions = ['relevance', 'context', 'payoff', 'editing'];
  const quality = Object.fromEntries(dimensions.map(name => [name,
    run.clips.length ? run.clips.reduce((sum, clip) => sum + clip[name], 0) / run.clips.length : 0]));
  const hours = Math.ceil(vodSeconds / 3600);
  return {
    knownMomentRecall: gold.length ? found.length / gold.length : 0,
    foundIds: found.map(moment => moment.id),
    coveredHours: Array.from({ length: hours }, (_, hour) =>
      run.clips.some(clip => clip.start < (hour + 1) * 3600 && clip.end > hour * 3600)),
    quality,
    costUsd: run.costUsd,
    processingSeconds: run.processingSeconds,
  };
}

export function compareRuns(input) {
  const { gold, baseline, candidate, vodSeconds } = input;
  if (!gold?.length || !baseline?.clips || !candidate?.clips) throw new Error('Need labeled real moments and both clip runs');
  for (const run of [baseline, candidate]) {
    if (!Number.isFinite(run.costUsd) || !Number.isFinite(run.processingSeconds) ||
      run.clips.some(clip => !Number.isFinite(clip.start) || !Number.isFinite(clip.end) ||
        ['relevance', 'context', 'payoff', 'editing'].some(name => !Number.isFinite(clip[name]) || clip[name] < 1 || clip[name] > 5))) {
      throw new Error('Each run needs measured cost/time and human ratings (1-5) for every clip');
    }
  }
  const old = scoreRun(baseline, gold, vodSeconds);
  const next = scoreRun(candidate, gold, vodSeconds);
  const qualityRegression = next.knownMomentRecall < old.knownMomentRecall ||
    Object.keys(old.quality).some(name => next.quality[name] < old.quality[name]);
  return { baseline: old, candidate: next, qualityRegression,
    costChangeUsd: next.costUsd - old.costUsd,
    processingChangeSeconds: next.processingSeconds - old.processingSeconds };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const input = JSON.parse(await readFile(process.argv[2], 'utf8'));
  const report = compareRuns(input);
  console.log(JSON.stringify(report, null, 2));
  if (report.qualityRegression) process.exitCode = 2;
}
