import { AsyncLocalStorage } from 'node:async_hooks';
import { metrics, SpanStatusCode, trace } from '@opentelemetry/api';
import { estimateCostUsd, TokenUsage } from '../services/aiPricing';

// STORY-026 and 027: one record of what the model calls made on behalf of some work cost. askClaude reports each call here as the
// response arrives; the code that started the work (a question, an evaluation run) collects the total and stores it. A span around
// each call carries the model, the token counts, the latency and the outcome, and never the question, the passages or the answer.

export interface AiUsage extends TokenUsage {
  calls: number;
  costUsd: number;
}

export const emptyUsage = (): AiUsage => ({ calls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 0 });

/** The usage block of the API's response (any field may be missing or null). */
export interface ApiUsage {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

export function usageFromApi(usage: ApiUsage | null | undefined): TokenUsage {
  return {
    inputTokens: usage?.input_tokens ?? 0,
    outputTokens: usage?.output_tokens ?? 0,
    cacheReadTokens: usage?.cache_read_input_tokens ?? 0,
    cacheCreationTokens: usage?.cache_creation_input_tokens ?? 0,
  };
}

const storage = new AsyncLocalStorage<AiUsage>();

/** Runs `work` adding the usage of every model call made inside it to `total` (kept even when the work throws). */
export function withAiUsage<T>(total: AiUsage, work: () => Promise<T>): Promise<T> {
  return storage.run(total, work);
}

/** Runs `work` and returns its result with the total usage of every model call made inside it. */
export async function collectAiUsage<T>(work: () => Promise<T>): Promise<{ value: T; usage: AiUsage }> {
  const usage = emptyUsage();
  const value = await storage.run(usage, work);
  return { value, usage };
}

const meter = () => metrics.getMeter('sss-demo-api');
let instruments: { calls: ReturnType<ReturnType<typeof meter>['createCounter']>; tokens: ReturnType<ReturnType<typeof meter>['createCounter']>; cost: ReturnType<ReturnType<typeof meter>['createCounter']> } | undefined;
function counters() {
  instruments ??= {
    calls: meter().createCounter('ai.calls', { description: 'Model calls' }),
    tokens: meter().createCounter('ai.tokens', { description: 'Tokens used by model calls', unit: '{token}' }),
    cost: meter().createCounter('ai.cost', { description: 'Estimated cost of model calls', unit: 'USD' }),
  };
  return instruments;
}

/**
 * Records one model call that returned: adds it to the work collecting usage (if any), puts the counts on the active span, and counts it
 * in the OpenTelemetry metrics. Returns the usage of this call.
 */
export function noteAiCall(model: string, tokens: TokenUsage): AiUsage {
  const costUsd = estimateCostUsd(model, tokens);
  const call: AiUsage = { calls: 1, ...tokens, costUsd };
  const total = storage.getStore();
  if (total) {
    total.calls += 1;
    total.inputTokens += tokens.inputTokens;
    total.outputTokens += tokens.outputTokens;
    total.cacheReadTokens += tokens.cacheReadTokens;
    total.cacheCreationTokens += tokens.cacheCreationTokens;
    total.costUsd += costUsd;
  }
  trace.getActiveSpan()?.setAttributes({
    'ai.model': model,
    'ai.tokens.input': tokens.inputTokens,
    'ai.tokens.output': tokens.outputTokens,
    'ai.tokens.cache_read': tokens.cacheReadTokens,
    'ai.tokens.cache_creation': tokens.cacheCreationTokens,
    'ai.cost_usd': costUsd,
  });
  const c = counters();
  c.calls.add(1, { 'ai.model': model });
  for (const [type, n] of [['input', tokens.inputTokens], ['output', tokens.outputTokens], ['cache_read', tokens.cacheReadTokens], ['cache_creation', tokens.cacheCreationTokens]] as const) {
    if (n > 0) c.tokens.add(n, { 'ai.model': model, 'ai.token_type': type });
  }
  c.cost.add(costUsd, { 'ai.model': model });
  return call;
}

/**
 * Runs a model call inside a span named assistant.model_call. The span gets the mode, the outcome and the latency; the model and token
 * counts are added by noteAiCall. `outcomeOf` reduces the result to a short word and the model, so nothing of the answer reaches the span.
 */
export async function inModelSpan<T>(mode: string, work: () => Promise<T>, outcomeOf: (result: T) => { outcome: string; model?: string | null }): Promise<T> {
  return trace.getTracer('sss-demo-api').startActiveSpan('assistant.model_call', { attributes: { 'ai.mode': mode } }, async (span) => {
    const started = Date.now();
    try {
      const result = await work();
      const { outcome, model } = outcomeOf(result);
      span.setAttributes({ 'ai.outcome': outcome, 'ai.latency_ms': Date.now() - started, ...(model ? { 'ai.model': model } : {}) });
      if (outcome === 'unavailable') span.setStatus({ code: SpanStatusCode.ERROR });
      return result;
    } catch (error) {
      span.setAttributes({ 'ai.outcome': 'error', 'ai.latency_ms': Date.now() - started });
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw error;
    } finally {
      span.end();
    }
  });
}
