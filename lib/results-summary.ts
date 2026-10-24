/** Display only server-reported charges; estimates never authorize billing. */
export function resultsChargeMessage(spent: number, estimate: number | null): string {
  if (estimate !== null && spent < estimate) {
    return `You saved ${estimate - spent} Sparks — charged ${spent} of the estimated ${estimate}.`;
  }
  return spent === 0 ? 'No Sparks were charged.' : `Charged ${spent} Sparks for this analysis.`;
}
