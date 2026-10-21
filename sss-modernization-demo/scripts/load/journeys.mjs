// STORY-030 journeys. Each journey is a list of autocannon requests that run in order on one connection, then loop. A request has a
// `label` (the route the report groups by), an `ok` list of statuses that count as success, and setupRequest/onResponse hooks that
// carry the token and ids between steps in the connection's own context (autocannon clears it at the end of each loop).
// The accounts the other journeys use come from `shared.pools`, created through the API before the run (setup.mjs).

// autocannon writes Content-Length into the headers object it is given, so every request builds a fresh one (a shared object leaked a stale length into later GETs)
const jsonHeaders = () => ({ 'content-type': 'application/json' });
let counter = 0;
const PASSWORD = 'Str0ng!Passw0rd';

const bearer = (token) => ({ ...jsonHeaders(), authorization: `Bearer ${token}` });
const parse = (body) => {
  try {
    return JSON.parse(body.toString());
  } catch {
    return {};
  }
};
const pick = (list, ctx) => list[(ctx.n ??= counter++) % list.length];

/** Registrant: register, sign in, profile, eligibility check, list exemptions, apply, own cases, own dashboard. */
export function registrant(shared, runId) {
  return [
    {
      label: 'POST /auth/register', ok: [201], method: 'POST',
      setupRequest(req, ctx) {
        ctx.email = `load-${runId}-${counter++}@example.com`;
        req.path = '/auth/register';
        req.headers = jsonHeaders();
        req.body = JSON.stringify({ email: ctx.email, password: PASSWORD, fullName: 'Load Registrant', ssn: '900-00-0010', dob: '1950-06-01' });
        return req;
      },
      onResponse(status, body, ctx) {
        const d = parse(body);
        ctx.token = d.token;
        ctx.userId = d.user?.id;
      },
    },
    {
      label: 'POST /auth/login', ok: [200], method: 'POST',
      setupRequest(req, ctx) {
        req.path = '/auth/login';
        req.headers = jsonHeaders();
        req.body = JSON.stringify({ email: ctx.email, password: PASSWORD });
        return req;
      },
      onResponse(status, body, ctx) {
        ctx.token = parse(body).token ?? ctx.token;
      },
    },
    { label: 'GET /users/:id', ok: [200], method: 'GET', setupRequest(req, ctx) { req.path = `/users/${ctx.userId}`; req.headers = bearer(ctx.token); return req; } },
    { label: 'POST /exemptions/check', ok: [200], method: 'POST', setupRequest(req, ctx) { req.path = '/exemptions/check'; req.headers = bearer(ctx.token); req.body = '{}'; return req; } },
    {
      label: 'GET /exemptions', ok: [200], method: 'GET',
      setupRequest(req, ctx) { req.path = '/exemptions'; req.headers = bearer(ctx.token); return req; },
      onResponse(status, body, ctx) {
        ctx.exemptionId = parse(body).exemptions?.find((e) => e.exemptionType === 'Type A')?.id;
      },
    },
    {
      label: 'POST /cases', ok: [201], method: 'POST',
      setupRequest(req, ctx) { req.path = '/cases'; req.headers = bearer(ctx.token); req.body = JSON.stringify({ exemptionId: ctx.exemptionId }); return req; },
      onResponse(status, body) {
        const id = parse(body).id;
        if (status === 201 && id) shared.submittedCases.push(id); // case managers decide these
      },
    },
    { label: 'GET /cases (own)', ok: [200], method: 'GET', setupRequest(req, ctx) { req.path = '/cases'; req.headers = bearer(ctx.token); return req; } },
    { label: 'GET /dashboards/citizen', ok: [200], method: 'GET', setupRequest(req, ctx) { req.path = '/dashboards/citizen'; req.headers = bearer(ctx.token); return req; } },
  ];
}

/** Case manager: list submitted cases, open one, add a note, assign to self, review, decide (a case a registrant journey submitted, else a seeded one). */
export function caseManager(shared) {
  const manager = (ctx) => (ctx.m ??= pick(shared.pools.managers, ctx));
  const caseOf = (ctx) => (ctx.caseId ??= shared.submittedCases.shift() ?? shared.pools.seedCases[counter++ % shared.pools.seedCases.length]);
  const at = (req, ctx, path, body) => {
    req.path = path;
    req.headers = bearer(manager(ctx).token);
    if (body) req.body = JSON.stringify(body);
    return req;
  };
  return [
    { label: 'GET /cases (staff list)', ok: [200], method: 'GET', setupRequest: (req, ctx) => at(req, ctx, '/cases?scope=all&status=Submitted&limit=25') },
    { label: 'GET /cases/:id', ok: [200], method: 'GET', setupRequest: (req, ctx) => at(req, ctx, `/cases/${caseOf(ctx)}`) },
    { label: 'POST /cases/:id/notes', ok: [201], method: 'POST', setupRequest: (req, ctx) => at(req, ctx, `/cases/${caseOf(ctx)}/notes`, { content: 'Load test note.' }) },
    { label: 'PUT /cases/:id/assignment', ok: [200], method: 'PUT', setupRequest: (req, ctx) => at(req, ctx, `/cases/${caseOf(ctx)}/assignment`, { assignedTo: manager(ctx).email }) },
    // A case that is already decided answers 400, a normal outcome of reusing seeded cases, not a fault.
    { label: 'POST /cases/:id/status (review)', ok: [200, 400], method: 'POST', setupRequest: (req, ctx) => at(req, ctx, `/cases/${caseOf(ctx)}/status`, { status: 'In Review' }) },
    { label: 'POST /cases/:id/status (decide)', ok: [200, 400], method: 'POST', setupRequest: (req, ctx) => at(req, ctx, `/cases/${caseOf(ctx)}/status`, { status: 'Approved' }) },
  ];
}

/** Assistant (AI_PROVIDER=stub only): ask a policy question, read own history. A 429 is the per-user hourly limit working. */
export function assistant(shared) {
  const who = (ctx) => (ctx.u ??= pick(shared.pools.assistant, ctx));
  const questions = ['What is the income limit for the Type B exemption?', 'How do I appeal a denied exemption?', 'Who qualifies for the Type A exemption?'];
  return [
    {
      label: 'POST /assistant/ask (stub)', ok: [200], limited: [429], method: 'POST',
      setupRequest(req, ctx) { req.path = '/assistant/ask'; req.headers = bearer(who(ctx).token); req.body = JSON.stringify({ question: questions[counter++ % questions.length] }); return req; },
    },
    { label: 'GET /assistant/history', ok: [200], method: 'GET', setupRequest(req, ctx) { req.path = '/assistant/history'; req.headers = bearer(who(ctx).token); return req; } },
  ];
}

/** Dashboards: the four role dashboards, plus the staff views behind them. */
export function dashboards(shared) {
  const p = shared.pools;
  const get = (label, path, who) => ({ label, ok: [200], method: 'GET', setupRequest(req, ctx) { req.path = path; req.headers = bearer(who(ctx).token); return req; } });
  const citizen = (ctx) => (ctx.c ??= pick(p.citizens, ctx));
  const manager = (ctx) => (ctx.m ??= pick(p.managers, ctx));
  return [
    get('GET /dashboards/citizen', '/dashboards/citizen', citizen),
    get('GET /notifications', '/notifications', citizen),
    get('GET /dashboards/case-manager', '/dashboards/case-manager', manager),
    get('GET /cases/stats', '/cases/stats', manager),
    get('GET /dashboards/admin', '/dashboards/admin', () => p.admin),
    get('GET /dashboards/leadership', '/dashboards/leadership', () => p.leadership),
    get('GET /freshness/dashboard', '/freshness/dashboard', manager),
  ];
}

/** Live-safe: read-mostly routes of ONE synthetic account. No AI, no writes. */
export function liveReadMostly(shared) {
  const acct = () => shared.pools.live;
  const get = (label, path) => ({ label, ok: [200], method: 'GET', setupRequest(req) { req.path = path; req.headers = bearer(acct().token); return req; } });
  return [
    get('GET /exemptions', '/exemptions'),
    get('GET /cases (own)', '/cases'),
    get('GET /dashboards/citizen', '/dashboards/citizen'),
    get('GET /notifications', '/notifications'),
    { label: 'GET /users/:id', ok: [200], method: 'GET', setupRequest(req) { req.path = `/users/${acct().userId}`; req.headers = bearer(acct().token); return req; } },
  ];
}

// Connections are split between the journeys by these weights in the mixed profile.
export const SCENARIOS = {
  registrant: { build: registrant, weight: 3 },
  'case-manager': { build: caseManager, weight: 2 },
  assistant: { build: assistant, weight: 2 },
  dashboards: { build: dashboards, weight: 3 },
};
