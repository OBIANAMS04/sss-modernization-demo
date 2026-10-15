// STORY-018: where an answer comes from. Claude is never called: the real SDK is pointed at a small local server that plays the
// API, so what is checked is what really goes over the wire (headers, body) and how the replies are read.
import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import { AddressInfo } from 'node:net';
import Anthropic from '@anthropic-ai/sdk';
import { MAX_OUTPUT_TOKENS, NO_ANSWER, askClaude, askStub, buildRequest, configuredMode, documentBlocks, modelName } from './assistantModel';
import { checkGrounding } from './groundingCheck';
import { RetrievedPassage } from './policyCorpus';

const passage = (id: string, body: string, rank = 0.5): RetrievedPassage => ({
  id,
  docSlug: id.split(':')[0],
  docTitle: `Title of ${id.split(':')[0]}`,
  heading: id.split(':')[1],
  position: 0,
  body,
  version: 'v'.repeat(64),
  rank,
});

const TYPE_A = passage(
  'exemption-type-a:who-qualifies',
  'A registrant qualifies for Type A when they are 65 years old or older. A registrant who is 64 does not qualify. Age is worked out in whole years.'
);
const TYPE_B = passage(
  'exemption-type-b:who-qualifies-the-income-limit',
  'A registrant qualifies for Type B when the annual income on the profile is below $20,000. If no annual income is on file, the result is Not Eligible.'
);
const APPEALS = passage('appeals:how-to-appeal', 'Open the case from the Cases page. On a Denied case, select Appeal this decision and confirm.');
const PASSAGES = [TYPE_A, TYPE_B, APPEALS];

describe('configuredMode', () => {
  it.each([
    [{}, 'passages-only'],
    [{ ANTHROPIC_API_KEY: '' }, 'passages-only'],
    [{ ANTHROPIC_API_KEY: '   ' }, 'passages-only'],
    [{ ANTHROPIC_API_KEY: 'sk-ant-test' }, 'ai'],
    [{ ANTHROPIC_API_KEY: 'sk-ant-test', AI_PROVIDER: 'off' }, 'passages-only'],
    [{ ANTHROPIC_API_KEY: 'sk-ant-test', AI_PROVIDER: 'OFF' }, 'passages-only'],
    [{ AI_PROVIDER: 'stub' }, 'stub'],
    [{ AI_PROVIDER: ' Stub ', ANTHROPIC_API_KEY: 'sk-ant-test' }, 'stub'],
    [{ AI_PROVIDER: 'claude', ANTHROPIC_API_KEY: 'sk-ant-test' }, 'ai'],
    [{ AI_PROVIDER: 'claude' }, 'passages-only'],
  ])('%j gives %s', (env, mode) => {
    expect(configuredMode(env as NodeJS.ProcessEnv)).toBe(mode);
  });
});

describe('modelName', () => {
  it('is claude-opus-5-5 unless AI_MODEL says otherwise', () => {
    expect(modelName({})).toBe('claude-opus-5-5');
    expect(modelName({ AI_MODEL: '' })).toBe('claude-opus-5-5');
    expect(modelName({ AI_MODEL: ' claude-sonnet-5-5 ' })).toBe('claude-sonnet-5-5');
  });
});

describe('buildRequest (the call as the claude-api skill shapes it)', () => {
  const request = buildRequest('How old must a registrant be for Type A?', PASSAGES, 'claude-opus-5-5');

  it('sends each passage as a plain-text document with native citations on, titled with the passage id', () => {
    const content = request.messages[0].content as { type: string; [k: string]: any }[];
    expect(content.slice(0, 3)).toEqual([
      {
        type: 'document',
        source: { type: 'text', media_type: 'text/plain', data: TYPE_A.body },
        title: TYPE_A.id,
        context: 'Title of exemption-type-a: who-qualifies',
        citations: { enabled: true },
      },
      expect.objectContaining({ title: TYPE_B.id, citations: { enabled: true } }),
      expect.objectContaining({ title: APPEALS.id, citations: { enabled: true } }),
    ]);
    // The question comes last, as plain text
    expect(content[3]).toEqual({ type: 'text', text: 'How old must a registrant be for Type A?' });
    expect(request.messages).toHaveLength(1);
  });

  it('puts the stable instructions in the system prompt with a cache breakpoint', () => {
    expect(request.system).toEqual([{ type: 'text', text: expect.stringContaining(NO_ANSWER), cache_control: { type: 'ephemeral' } }]);
    const system = (request.system as { text: string }[])[0].text;
    expect(system).toContain('Answer only from those documents');
    expect(system).toContain('not real Selective Service System policy');
    // Nothing that varies by request may be in it, or the cache never hits
    expect(system).not.toContain('Type A');
    expect(JSON.stringify(buildRequest('another question', [TYPE_B], 'claude-opus-5-5').system)).toBe(JSON.stringify(request.system));
  });

  it('sets effort explicitly, leaves thinking at its default, and sends no budget, sampling parameters or structured output', () => {
    expect(request.output_config).toEqual({ effort: 'low' });
    const body = JSON.stringify(request);
    expect(request).not.toHaveProperty('thinking');
    for (const forbidden of ['budget_tokens', 'disabled', 'temperature', 'top_p', 'top_k', 'tool_choice', '"format"']) {
      expect(body).not.toContain(forbidden);
    }
    expect(request.max_tokens).toBe(MAX_OUTPUT_TOKENS);
    expect(request.max_tokens).toBeGreaterThanOrEqual(2048); // thinking counts toward it
  });

  it('enables the server-side refusal fallback with the header that goes with that form', () => {
    expect(request.betas).toEqual(['server-side-fallback-2026-07-01']);
    expect(request.fallbacks).toBe('default');
    expect(request.model).toBe('claude-opus-5-5');
  });

  it('leaves the fallback off for a Haiku model, which has none and rejects the parameter', () => {
    const haiku = buildRequest('q', PASSAGES, 'claude-haiku-5-5');
    expect(haiku.fallbacks).toBeUndefined();
    expect(haiku.betas).toBeUndefined();
  });

  it('documentBlocks gives one block per passage, in order', () => {
    expect(documentBlocks(PASSAGES).map((d) => d.title)).toEqual(PASSAGES.map((p) => p.id));
  });
});

describe('askStub (the stand-in for tests)', () => {
  it('answers from the best sentence of each of the top two passages, each cited to itself', () => {
    const outcome = askStub('What is the income limit for Type B?', PASSAGES);
    expect(outcome.type).toBe('answer');
    if (outcome.type !== 'answer') return;
    expect(outcome.model).toBe('stub');
    const cited = outcome.segments.filter((s) => s.citations.length > 0);
    expect(cited.map((s) => s.citations[0].passageId)).toEqual([TYPE_A.id, TYPE_B.id]);
    expect(cited[1].text).toBe('A registrant qualifies for Type B when the annual income on the profile is below $20,000.');
    expect(cited.every((s) => s.citations[0].quote === s.text)).toBe(true);
  });

  it('is grounded by construction, so a stub answer is level 0 with two or more passages', () => {
    for (const question of ['How old must a registrant be?', 'How do I appeal?', 'weather', 'What is the income limit?']) {
      const outcome = askStub(question, PASSAGES);
      if (outcome.type !== 'answer') throw new Error('expected an answer');
      const grounding = checkGrounding(outcome.segments, PASSAGES);
      expect(grounding).toMatchObject({ grounded: true, coverage: 1, unsupported: [] });
      expect(grounding.citedPassages).toHaveLength(2);
    }
  });

  it('gives the same answer for the same question, and never reads its own answer from outside the passages', () => {
    expect(askStub('How old must a registrant be?', PASSAGES)).toEqual(askStub('How old must a registrant be?', PASSAGES));
  });

  it('has nothing to say when nothing was retrieved', () => {
    expect(askStub('What is the weather?', [])).toEqual({ type: 'no-answer', model: 'stub' });
  });

  it('adds an uncited sentence with an invented number when the question says stub-ungrounded', () => {
    const outcome = askStub('How do I appeal? stub-ungrounded', PASSAGES);
    if (outcome.type !== 'answer') throw new Error('expected an answer');
    const grounding = checkGrounding(outcome.segments, PASSAGES);
    expect(grounding.grounded).toBe(false);
    expect(grounding.unsupported.map((u) => u.type).sort()).toEqual(['uncited-sentence', 'unsupported-number']);
  });

  it('fails like an outage when the question says stub-unavailable', () => {
    expect(askStub('How do I appeal? stub-unavailable', PASSAGES)).toEqual({ type: 'unavailable', reason: 'stub' });
  });
});

// ---- The real SDK, against a local server that plays the API

const KEY = 'sk-ant-test-key-0123456789abcdef';
interface Seen {
  method?: string;
  url?: string;
  headers: IncomingMessage['headers'];
  body: any;
}
let server: Server;
let baseURL: string;
let seen: Seen[];
let reply: (res: ServerResponse) => void;

const message = (over: Record<string, unknown> = {}) => ({
  id: 'msg_test',
  type: 'message',
  role: 'assistant',
  model: 'claude-opus-5-5',
  content: [],
  stop_reason: 'end_turn',
  stop_sequence: null,
  stop_details: null,
  usage: { input_tokens: 100, output_tokens: 20, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
  ...over,
});
const json = (status: number, body: unknown) => (res: ServerResponse) => {
  res.writeHead(status, { 'content-type': 'application/json', 'request-id': 'req_test_123' });
  res.end(JSON.stringify(body));
};
const text = (t: string, citations: unknown[] | null = null) => ({ type: 'text', text: t, citations });
const charLocation = (index: number, title: string | null, quote: string) => ({
  type: 'char_location',
  cited_text: quote,
  document_index: index,
  document_title: title,
  start_char_index: 0,
  end_char_index: quote.length,
  file_id: null,
});

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, headers: req.headers, body: raw ? JSON.parse(raw) : null });
      reply(res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  seen = [];
  reply = json(200, message());
});

const client = (over: Record<string, unknown> = {}) => new Anthropic({ apiKey: KEY, authToken: null, baseURL, maxRetries: 0, ...over });

describe('askClaude (the real SDK against a local stand-in for the API)', () => {
  it('sends the request the skill describes, with only the API key as credentials', async () => {
    reply = json(200, message({ content: [text('Type A is for registrants of 65 or older.', [charLocation(0, TYPE_A.id, 'A registrant qualifies for Type A when they are 65 years old or older.')])] }));
    await askClaude('How old must a registrant be for Type A?', PASSAGES, { client: client() });

    expect(seen).toHaveLength(1);
    const { method, url, headers, body } = seen[0];
    expect([method, url?.split('?')[0]]).toEqual(['POST', '/v1/messages']);
    expect(headers['x-api-key']).toBe(KEY);
    expect(headers['authorization']).toBeUndefined();
    expect(String(headers['anthropic-beta'])).toContain('server-side-fallback-2026-07-01');
    expect(body).toMatchObject({
      model: 'claude-opus-5-5',
      max_tokens: MAX_OUTPUT_TOKENS,
      fallbacks: 'default',
      output_config: { effort: 'low' },
      system: [{ type: 'text', cache_control: { type: 'ephemeral' } }],
    });
    expect(body).not.toHaveProperty('thinking');
    expect(body.messages[0].content.map((b: any) => b.type)).toEqual(['document', 'document', 'document', 'text']);
    expect(body.messages[0].content[0]).toMatchObject({ title: TYPE_A.id, citations: { enabled: true } });
  });

  it('reads the answer in its pieces, with each citation resolved to the passage that was sent', async () => {
    const quoteA = 'A registrant qualifies for Type A when they are 65 years old or older.';
    reply = json(
      200,
      message({
        model: 'claude-opus-5-5',
        content: [
          { type: 'thinking', thinking: '', signature: 'sig' },
          text('Type A is for registrants of 65 or older', [charLocation(0, TYPE_A.id, quoteA)]),
          text('. '),
          text('Type B needs an income below $20,000', [charLocation(1, TYPE_B.id, 'A registrant qualifies for Type B when the annual income on the profile is below $20,000.')]),
          text('.'),
        ],
      })
    );
    const outcome = await askClaude('q', PASSAGES, { client: client() });
    expect(outcome).toEqual({
      type: 'answer',
      model: 'claude-opus-5-5',
      segments: [
        { text: 'Type A is for registrants of 65 or older', citations: [{ passageId: TYPE_A.id, quote: quoteA }] },
        { text: '. ', citations: [] },
        { text: 'Type B needs an income below $20,000', citations: [{ passageId: TYPE_B.id, quote: expect.stringContaining('$20,000') }] },
        { text: '.', citations: [] },
      ],
    });
    if (outcome.type === 'answer') expect(checkGrounding(outcome.segments, PASSAGES).grounded).toBe(true);
  });

  it('reports the model that served the answer, which is the fallback model when the fallback ran', async () => {
    reply = json(200, message({ model: 'claude-opus-4-8', content: [text('Fine.', [charLocation(0, TYPE_A.id, 'A registrant who is 64 does not qualify.')])] }));
    expect(await askClaude('q', PASSAGES, { client: client() })).toMatchObject({ type: 'answer', model: 'claude-opus-4-8' });
  });

  it('resolves a citation to no passage when its document index or title does not match what was sent', async () => {
    reply = json(
      200,
      message({
        content: [
          text('a', [charLocation(7, 'exemption-type-a:who-qualifies', 'x')]),
          text('b', [charLocation(0, 'some-other:passage', 'y')]),
          text('c', [{ type: 'page_location', cited_text: 'z', document_index: 0, document_title: null, start_page_number: 1, end_page_number: 2, file_id: null }]),
        ],
      })
    );
    const outcome = await askClaude('q', PASSAGES, { client: client() });
    if (outcome.type !== 'answer') throw new Error('expected an answer');
    expect(outcome.segments.map((s) => s.citations[0].passageId)).toEqual([null, null, null]);
  });

  it.each(['NO_ANSWER', ' no_answer. ', '"NO_ANSWER"'])('treats %j as the model saying the documents do not answer', async (said) => {
    reply = json(200, message({ content: [text(said)] }));
    expect(await askClaude('q', PASSAGES, { client: client() })).toEqual({ type: 'no-answer', model: 'claude-opus-5-5' });
  });

  it('does not take an answer that merely contains the words for no answer', async () => {
    reply = json(200, message({ content: [text('There is NO_ANSWER to that in the documents.')] }));
    expect((await askClaude('q', PASSAGES, { client: client() })).type).toBe('answer');
  });

  it('checks the stop reason before reading the content: a refusal is declined whatever came with it', async () => {
    reply = json(200, message({ stop_reason: 'refusal', stop_details: { type: 'refusal', category: 'cyber', explanation: null }, content: [text('partial', [])] }));
    expect(await askClaude('q', PASSAGES, { client: client() })).toEqual({ type: 'declined', model: 'claude-opus-5-5', reason: 'refusal', detail: 'cyber' });
  });

  it('declines a reply cut off by the length limit, and any other stop reason', async () => {
    reply = json(200, message({ stop_reason: 'max_tokens', content: [text('Half an ans')] }));
    expect(await askClaude('q', PASSAGES, { client: client() })).toMatchObject({ type: 'declined', reason: 'max_tokens' });
    reply = json(200, message({ stop_reason: 'pause_turn', content: [text('x')] }));
    expect(await askClaude('q', PASSAGES, { client: client() })).toMatchObject({ type: 'declined', reason: 'other', detail: 'pause_turn' });
  });

  it('declines a reply with no text in it', async () => {
    reply = json(200, message({ content: [{ type: 'thinking', thinking: '', signature: 's' }] }));
    expect(await askClaude('q', PASSAGES, { client: client() })).toMatchObject({ type: 'declined', reason: 'empty' });
  });

  describe('typed SDK errors become "unavailable" with a reason, and never reach the caller as exceptions', () => {
    let errors: jest.SpyInstance;
    beforeEach(() => {
      errors = jest.spyOn(console, 'error').mockImplementation(() => {});
    });
    afterEach(() => errors.mockRestore());

    it.each([
      [429, 'rate_limit_error', 'rate-limited'],
      [401, 'authentication_error', 'authentication'],
      [403, 'permission_error', 'permission'],
      [404, 'not_found_error', 'model-not-found'],
      [400, 'invalid_request_error', 'bad-request'],
      [500, 'api_error', 'server-error'],
      [529, 'overloaded_error', 'server-error'],
      [413, 'request_too_large', 'status-413'],
    ])('HTTP %i (%s) is %s', async (status, type, reason) => {
      reply = json(status, { type: 'error', error: { type, message: 'secret detail that must not be logged' } });
      expect(await askClaude('q', PASSAGES, { client: client() })).toEqual({ type: 'unavailable', reason });
      const logged = JSON.stringify(errors.mock.calls);
      expect(logged).toContain('req_test_123'); // the request id is kept, for a support request
      expect(logged).not.toContain('secret detail');
    });

    it('a call that takes too long is "timeout"', async () => {
      reply = () => {}; // never answers
      const started = Date.now();
      expect(await askClaude('q', PASSAGES, { client: client({ timeout: 80 }) })).toEqual({ type: 'unavailable', reason: 'timeout' });
      expect(Date.now() - started).toBeLessThan(3000);
    });

    it('a refused connection is "connection"', async () => {
      const closed = new Anthropic({ apiKey: KEY, authToken: null, baseURL: 'http://127.0.0.1:1', maxRetries: 0 });
      expect(await askClaude('q', PASSAGES, { client: closed })).toEqual({ type: 'unavailable', reason: 'connection' });
    });

    it('an error that is not the SDK\'s is a bug and is rethrown', async () => {
      const broken = { beta: { messages: { create: () => Promise.reject(new TypeError('bug')) } } } as unknown as Anthropic;
      await expect(askClaude('q', PASSAGES, { client: broken })).rejects.toThrow('bug');
    });
  });

  it('never writes the API key, the question or the passages to the console', async () => {
    const spies = (['log', 'error', 'warn', 'info'] as const).map((method) => jest.spyOn(console, method).mockImplementation(() => {}));
    try {
      reply = json(429, { type: 'error', error: { type: 'rate_limit_error', message: 'slow down' } });
      await askClaude('a very personal question', PASSAGES, { client: client() });
      const logged = JSON.stringify(spies.flatMap((s) => s.mock.calls));
      for (const secret of [KEY, 'a very personal question', TYPE_A.body]) expect(logged).not.toContain(secret);
    } finally {
      spies.forEach((s) => s.mockRestore());
    }
  });
});

describe('the client askClaude makes for itself', () => {
  it('uses ANTHROPIC_API_KEY alone: an auth token in the environment is not sent as well', async () => {
    const saved = { key: process.env.ANTHROPIC_API_KEY, token: process.env.ANTHROPIC_AUTH_TOKEN, base: process.env.ANTHROPIC_BASE_URL };
    process.env.ANTHROPIC_API_KEY = KEY;
    process.env.ANTHROPIC_AUTH_TOKEN = 'bearer-token-that-must-not-be-sent';
    process.env.ANTHROPIC_BASE_URL = baseURL;
    try {
      reply = json(200, message({ content: [text('Fine.', [charLocation(0, TYPE_A.id, 'A registrant who is 64 does not qualify.')])] }));
      expect((await askClaude('q', PASSAGES)).type).toBe('answer');
      expect(seen[0].headers['x-api-key']).toBe(KEY);
      expect(seen[0].headers['authorization']).toBeUndefined();
    } finally {
      for (const [name, value] of [['ANTHROPIC_API_KEY', saved.key], ['ANTHROPIC_AUTH_TOKEN', saved.token], ['ANTHROPIC_BASE_URL', saved.base]] as const) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });
});
