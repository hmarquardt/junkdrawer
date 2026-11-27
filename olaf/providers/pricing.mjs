// Standard (non-batch) OpenAI list prices per million tokens: [input, cached input, output].
// Source: https://developers.openai.com/api/docs/pricing (checked 2026-11-27).
const prices = {
  'gpt-4.1-mini': [0.4, 0.1, 1.6],
  'gpt-4.1': [2, 0.5, 8],
  'gpt-5.4-mini': [0.75, 0.075, 4.5],
  'gpt-5.4': [2.5, 0.25, 15],
  'gpt-5.5': [5, 0.5, 30],
  'gpt-5.6-luna': [0.2, 0.02, 1.2],
  'gpt-6.1-sol': [2, 0.1, 10],
  'gpt-6.2-sol': [2, 0.1, 10],
};
export function pricingFor(model) {
  if (typeof model !== 'string') return null;
  if (prices[model]) return prices[model];
  const snapshot = Object.keys(prices)
    .sort((a, b) => b.length - a.length)
    .find((id) => model === id || model.startsWith(id + '-'));
  return snapshot ? prices[snapshot] : null;
}
// Returns null when the price is unknown, so benchmarks never invent cost.
export function estimatedUsd({ env = process.env, models = [], actualModel, usage = {} }) {
  const { inputTokens, outputTokens, cachedTokens = 0 } = usage;
  if (inputTokens == null || outputTokens == null) return null;
  const override = env.OLAF_USD_PER_MILLION?.split(',').map(Number);
  let rates =
    models.length === 1 &&
    override?.length === 2 &&
    override.every((v) => Number.isFinite(v) && v >= 0)
      ? [override[0], override[0], override[1]]
      : pricingFor(actualModel);
  if (!rates) return null;
  const cached = Math.min(Math.max(0, cachedTokens), inputTokens);
  return ((inputTokens - cached) * rates[0] + cached * rates[1] + outputTokens * rates[2]) / 1e6;
}
