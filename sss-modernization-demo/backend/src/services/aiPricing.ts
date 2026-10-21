// STORY-027: what a model call costs, in one place. Prices are US dollars per million tokens; change a price here and nowhere else.
// These are ESTIMATES from the published list prices, not an invoice: the provider's bill is the source of truth.

export interface ModelPrice {
  input: number;
  output: number;
  /** Reading tokens that are already in the prompt cache. */
  cacheRead: number;
  /** Writing tokens into the prompt cache (5-minute cache: 1.25 times the input price). */
  cacheWrite: number;
}

const OPUS_5_5: ModelPrice = { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 };

export const MODEL_PRICES: Record<string, ModelPrice> = {
  'claude-opus-5-5': OPUS_5_5,
  // The test double reports made-up token counts (a quarter of a character count) so that the budget, the cost columns and the
  // Observability page can be exercised without a key. It is priced like the default model; no money is spent.
  stub: OPUS_5_5,
};

/** The price used for a model that is not in the table (a newer model, or a dated name): the default model's, so spend is never undercounted to zero. */
export const FALLBACK_PRICE: ModelPrice = OPUS_5_5;

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

export function priceFor(model: string | null | undefined): ModelPrice {
  if (!model) return FALLBACK_PRICE;
  if (MODEL_PRICES[model]) return MODEL_PRICES[model];
  // A dated or suffixed name ("claude-opus-5-5-20261001") is priced as the model it starts with
  const family = Object.keys(MODEL_PRICES).find((name) => model.startsWith(`${name}-`));
  return family ? MODEL_PRICES[family] : FALLBACK_PRICE;
}

/** The estimated cost in US dollars of one call (or the sum of several). */
export function estimateCostUsd(model: string | null | undefined, usage: TokenUsage): number {
  const price = priceFor(model);
  return (
    (usage.inputTokens * price.input + usage.outputTokens * price.output + usage.cacheReadTokens * price.cacheRead + usage.cacheCreationTokens * price.cacheWrite) /
    1_000_000
  );
}

/** The daily budget for AI spend in US dollars: AI_DAILY_BUDGET_USD, default 2. */
export function dailyBudgetUsd(env: NodeJS.ProcessEnv = process.env): number {
  const budget = Number.parseFloat(env.AI_DAILY_BUDGET_USD ?? '');
  return Number.isFinite(budget) && budget >= 0 ? budget : 2;
}
