// STORY-026 and 027: what a model call costs, what is recorded about it, and what the span about it holds. Claude is never called: the real
// SDK is pointed at a small local server that plays the API.
import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import Anthropic from '@anthropic-ai/sdk';
import { InMemorySpanExporter, NodeTracerProvider, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-node';
import { askClaude } from './assistantModel';
import { dailyBudgetUsd, estimateCostUsd, MODEL_PRICES, priceFor } from './aiPricing';
import { collectAiUsage, inModelSpan, usageFromApi } from '../observability/aiUsage';
import { RetrievedPassage } from './policyCorpus';

const PASSAGE: RetrievedPassage = {
  id: 'exemption-type-a:who-qualifies', docSlug: 'exemption-type-a', docTitle: 'Type A', heading: 'who-qualifies', position: 0,
  body: 'A registrant qualifies for Type A when they are 65 years old or older.', version: 'v'.repeat(64), rank: 0.5,
};
const SECRET_QUESTION = 'Why was Jane Doe at jane.doe@example.com refused, SSN 123-45-6789?';

describe('aiPricing', () => {
  it('prices claude-opus-5-5 at $4 per million input, $20 per million output and $0.20 per million cache reads', () => {
    expect(MODEL_PRICES['claude-opus-5-5']).toMatchObject({ input: 4, output: 20, cacheRead: 0.2 });
    expect(estimateCostUsd('claude-opus-5-5', { inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 })).toBe(4);
    expect(estimateCostUsd('claude-opus-5-5', { inputTokens: 0, outputTokens: 1_000_000, cacheReadTokens: 0, cacheCreationTokens: 0 })).toBe(20);
    expect(estimateCostUsd('claude-opus-5-5', { inputTokens: 0, outputTokens: 0, cacheReadTokens: 1_000_000, cacheCreationTokens: 0 })).toBeCloseTo(0.2, 10);
  });
  it('adds up one call: 2,000 in, 500 out, 10,000 cached', () => {
    const cost = estimateCostUsd('claude-opus-5-5', { inputTokens: 2000, outputTokens: 500, cacheReadTokens: 10_000, cacheCreationTokens: 0 });
    expect(cost).toBeCloseTo(0.008 + 0.01 + 0.002, 10);
  });
  it('prices a dated name as its family and an unknown model as the default, so spend is never counted as zero', () => {
    expect(priceFor('claude-opus-5-5-20261001')).toBe(MODEL_PRICES['claude-opus-5-5']);
    expect(priceFor('some-future-model').input).toBe(4);
    expect(priceFor(null).output).toBe(20);
  });
  it('reads the daily budget from AI_DAILY_BUDGET_USD, default 2', () => {
    expect(dailyBudgetUsd({})).toBe(2);
    expect(dailyBudgetUsd({ AI_DAILY_BUDGET_USD: '5.5' } as NodeJS.ProcessEnv)).toBe(5.5);
    expect(dailyBudgetUsd({ AI_DAILY_BUDGET_USD: 'lots' } as NodeJS.ProcessEnv)).toBe(2);
    expect(dailyBudgetUsd({ AI_DAILY_BUDGET_USD: '-1' } as NodeJS.ProcessEnv)).toBe(2);
  });
});

describe('usageFromApi', () => {
  it('reads the four counts from the API usage block, and treats missing ones as zero', () => {
    expect(usageFromApi({ input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 7, cache_creation_input_tokens: 3 })).toEqual({
      inputTokens: 10, outputTokens: 5, cacheReadTokens: 7, cacheCreationTokens: 3,
    });
    expect(usageFromApi({ input_tokens: 1, cache_read_input_tokens: null })).toEqual({ inputTokens: 1, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 });
    expect(usageFromApi(undefined).inputTokens).toBe(0);
  });
});

describe('a model call', () => {
  let server: Server;
  let baseURL: string;
  const exporter = new InMemorySpanExporter();
  const provider = new NodeTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });

  beforeAll(async () => {
    provider.register();
    server = createServer((req, res) => {
      req.resume();
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'end_turn', stop_sequence: null, stop_details: null,
          content: [{ type: 'text', text: 'Registrants of 65 or older qualify.', citations: null }],
          usage: { input_tokens: 2000, output_tokens: 500, cache_read_input_tokens: 10_000, cache_creation_input_tokens: 0 },
        }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    await provider.shutdown();
  });
  beforeEach(() => exporter.reset());

  const run = () => {
    const client = new Anthropic({ apiKey: 'sk-ant-test', authToken: null, baseURL, maxRetries: 0 });
    return collectAiUsage(() => inModelSpan('ai', () => askClaude(SECRET_QUESTION, [PASSAGE], { client }), (o) => ({ outcome: o.type, model: 'model' in o ? o.model : null })));
  };

  it('is added up for the work that made it: tokens as the API reported them, and the estimated cost', async () => {
    const { usage } = await run();
    expect(usage).toMatchObject({ calls: 1, inputTokens: 2000, outputTokens: 500, cacheReadTokens: 10_000, cacheCreationTokens: 0 });
    expect(usage.costUsd).toBeCloseTo(0.02, 10);
  });

  it('has a span with the model, token counts, latency and outcome', async () => {
    await run();
    const span = exporter.getFinishedSpans().find((s) => s.name === 'assistant.model_call')!;
    expect(span.attributes).toMatchObject({
      'ai.mode': 'ai', 'ai.model': 'claude-opus-5-5', 'ai.outcome': 'answer',
      'ai.tokens.input': 2000, 'ai.tokens.output': 500, 'ai.tokens.cache_read': 10_000, 'ai.tokens.cache_creation': 0,
    });
    expect(typeof span.attributes['ai.latency_ms']).toBe('number');
  });

  it('never has the question, the passage text or the answer on the span', async () => {
    await run();
    const everything = JSON.stringify(exporter.getFinishedSpans().map((s) => ({ name: s.name, attributes: s.attributes, events: s.events })));
    for (const secret of ['Jane', 'jane.doe', '123-45-6789', 'registrant qualifies', 'Registrants of 65']) expect(everything).not.toContain(secret);
  });
});
