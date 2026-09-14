/**
 * Logs Anthropic's per-response rate-limit headers so real request/token
 * budget is visible in prod logs instead of only surfacing as a 429.
 */
export function logAnthropicRateLimits(headers: Headers, label: string): void {
  const get = (name: string) => headers.get(name) ?? "?";
  console.log(
    `[anthropic ${label}] rate limits —`,
    `requests: ${get("anthropic-ratelimit-requests-remaining")}/${get("anthropic-ratelimit-requests-limit")}`,
    `(resets ${get("anthropic-ratelimit-requests-reset")})`,
    `| input-tokens: ${get("anthropic-ratelimit-input-tokens-remaining")}/${get("anthropic-ratelimit-input-tokens-limit")}`,
    `(resets ${get("anthropic-ratelimit-input-tokens-reset")})`,
    `| output-tokens: ${get("anthropic-ratelimit-output-tokens-remaining")}/${get("anthropic-ratelimit-output-tokens-limit")}`,
    `(resets ${get("anthropic-ratelimit-output-tokens-reset")})`
  );
}
