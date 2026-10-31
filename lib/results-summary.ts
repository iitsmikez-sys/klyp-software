/** Display only server-reported charges; estimates never authorize billing. */
export function resultsChargeMessage(
  spent: number,
  estimate: number | null,
  analysisCost?: number | null,
  qualifyingClips?: number
): string {
  if (spent === 0) return 'No Sparks were charged.';
  if (analysisCost !== null && analysisCost !== undefined && spent >= analysisCost &&
      qualifyingClips !== undefined && qualifyingClips >= 0) {
    const breakdown = qualifyingClips === 0
      ? `Charged ${spent} Sparks for VOD analysis. No clips were charged.`
      : `Charged ${spent} Sparks: ${analysisCost} for analysis + ${spent - analysisCost} for ${qualifyingClips} ${qualifyingClips === 1 ? 'clip' : 'clips'}.`;
    return estimate !== null && spent < estimate
      ? `${breakdown} You saved ${estimate - spent} Sparks.`
      : breakdown;
  }
  if (estimate !== null && spent < estimate) {
    return `You saved ${estimate - spent} Sparks — charged ${spent} of the estimated ${estimate}.`;
  }
  return `Charged ${spent} Sparks for this analysis.`;
}
