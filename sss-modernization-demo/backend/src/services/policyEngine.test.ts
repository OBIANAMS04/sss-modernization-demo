// STORY-016: the access policy as it is deployed. These tests load the REAL committed WebAssembly (backend/policy/sss_authz.wasm,
// built from sss_authz.rego by scripts/opa/build.mjs) and give it the real defaults, then the data an administrator's change would
// produce. The Rego is also tested on its own (sss_authz_test.rego, run by `opa test`); these check that what is deployed is that
// policy, and that the defaults decide exactly as the route guards always have.
jest.mock('../database/connection', () => ({ __esModule: true, default: { query: jest.fn(), connect: jest.fn() } }));

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { BASELINE_ROUTES, PolicyRole, RULES } from '../security/accessPolicy';
import { Decision, evaluate, loadEngine, setData } from './policyEngine';
import { CaseAttributes, Resource } from './policyResources';
import { PolicyState, defaultState, policyData } from './policyService';

const POLICY_DIR = path.resolve(__dirname, '..', '..', 'policy');
const sha256 = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const manifest = JSON.parse(readFileSync(path.join(POLICY_DIR, 'manifest.json'), 'utf8'));

describe('the committed policy', () => {
  it('is a build of the Rego beside it: the .rego was not edited without rebuilding (node scripts/opa/build.mjs)', () => {
    // Line endings do not count: a checkout may convert them
    const rego = readFileSync(path.join(POLICY_DIR, 'sss_authz.rego'), 'utf8').replace(/\r\n/g, '\n');
    expect(sha256(rego)).toBe(manifest.regoSha256);
  });

  it('is the compiled file the manifest names', () => {
    expect(sha256(readFileSync(path.join(POLICY_DIR, 'sss_authz.wasm')))).toBe(manifest.wasmSha256);
  });

  it('says which OPA built it and where the question goes in', () => {
    expect([manifest.opaVersion, manifest.entrypoint]).toEqual(['1.21.0', 'sss/authz/decision']);
    expect(Object.keys(manifest).sort()).toEqual(['entrypoint', 'opaVersion', 'regoSha256', 'wasmSha256']);
  });

  it('loads, and reports what it is', async () => {
    expect(await loadEngine()).toEqual({ name: 'Open Policy Agent', version: '1.21.0', format: 'WebAssembly', wasmSha256: manifest.wasmSha256 });
  });

  it('is not run when the compiled file is not the one the manifest names', async () => {
    let loadAltered!: typeof loadEngine;
    jest.isolateModules(() => {
      jest.doMock('node:fs', () => {
        const actual = jest.requireActual('node:fs');
        return {
          ...actual,
          readFileSync: (file: string, ...rest: unknown[]) => {
            const bytes = actual.readFileSync(file, ...rest);
            if (!String(file).endsWith('sss_authz.wasm')) return bytes;
            const changed = Buffer.from(bytes);
            changed[changed.length - 1] ^= 1; // one bit
            return changed;
          },
        };
      });
      loadAltered = require('./policyEngine').loadEngine;
    });
    jest.dontMock('node:fs');

    await expect(loadAltered()).rejects.toThrow('is not the one manifest.json names');
  });
});

// ---- Decisions

const APPLICANT = { id: 'u-applicant', role: 'citizen' as PolicyRole };
const ANOTHER = { id: 'u-another', role: 'citizen' as PolicyRole };
const ALDER = { id: 'u-alder', role: 'case_manager' as PolicyRole };
const BISHOP = { id: 'u-bishop', role: 'case_manager' as PolicyRole };
const DIRECTOR = { id: 'u-director', role: 'leadership' as PolicyRole };
const MORGAN = { id: 'u-morgan', role: 'admin' as PolicyRole };
const NOBODY = { id: null, role: 'anonymous' as PolicyRole };

const aCase = (attributes: Partial<CaseAttributes> = {}): CaseAttributes => ({
  type: 'case',
  found: true,
  owner_id: APPLICANT.id,
  assigned_to: null,
  status: 'In Review',
  under_compliance_review: false,
  ...attributes,
});

/** Gives the policy the defaults, with the named rules off and the given routes limited to fewer roles. */
function configure(off: string[] = [], routeRoles: PolicyState['routeRoles'] = {}) {
  setData(policyData({ rules: { ...defaultState().rules, ...Object.fromEntries(off.map((id) => [id, false])) }, routeRoles }));
}

function ask(subject: { id: string | null; role: PolicyRole }, route: string, resource: Resource | null = null, action?: 'read' | 'write'): Decision {
  return evaluate({ subject, action: action ?? (route.startsWith('GET ') ? 'read' : 'write'), route, resource });
}

beforeAll(async () => {
  await loadEngine();
});

beforeEach(() => configure());

describe('the defaults on routes that are not about a record: the route decides by role alone', () => {
  const ALL: PolicyRole[] = ['anonymous', 'citizen', 'case_manager', 'leadership', 'admin'];
  const SIGNED_IN = ALL.slice(1);
  const subjects = [NOBODY, APPLICANT, ALDER, DIRECTOR, MORGAN];

  it.each([
    ['GET /health', ALL],
    ['POST /api/auth/login', ALL],
    ['GET /api/dashboards/citizen', SIGNED_IN],
    ['POST /api/mfa/setup', SIGNED_IN],
    ['GET /api/cases/stats', ['case_manager', 'admin']],
    ['GET /api/cases/export', ['case_manager', 'admin']],
    ['POST /api/staff/grant', ['case_manager', 'admin']],
    ['GET /api/dashboards/leadership', ['leadership', 'admin']],
    ['GET /api/dashboards/admin', ['admin']],
    ['GET /api/policies', ['admin']],
  ] as [string, PolicyRole[]][])('%s is open to %j', (route, allowed) => {
    expect(subjects.filter((s) => ask(s, route).allow).map((s) => s.role)).toEqual(allowed);
  });

  it('decides every route in the access table by its label, for every role', () => {
    const wrong: string[] = [];
    for (const [route, entry] of Object.entries(BASELINE_ROUTES).filter(([, e]) => e.resource === null)) {
      for (const subject of subjects) {
        const decision = ask(subject, route);
        if (decision.allow !== entry.roles.includes(subject.role)) wrong.push(`${subject.role} ${route}: ${decision.rule}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it('refuses an anonymous caller on a signed-in route, and says why', () => {
    expect(ask(NOBODY, 'GET /api/dashboards/citizen')).toEqual({ allow: false, rule: 'route-roles', reason: 'Only signed-in people can use this route' });
  });

  it('refuses a citizen on a staff route, and leadership too: it reads aggregates and does no case work', () => {
    const reason = 'Only case managers and administrators can use this route';
    expect(ask(APPLICANT, 'GET /api/cases/stats')).toEqual({ allow: false, rule: 'route-roles', reason });
    expect(ask(DIRECTOR, 'GET /api/cases/stats')).toEqual({ allow: false, rule: 'route-roles', reason });
  });

  it('refuses a case manager on a route that only admins may use', () => {
    expect(ask(ALDER, 'GET /api/dashboards/admin')).toEqual({ allow: false, rule: 'route-roles', reason: 'Only administrators can use this route' });
  });

  it('refuses a route it has no policy for, whoever asks (it fails closed)', () => {
    expect(ask(MORGAN, 'GET /api/not-a-route')).toEqual({ allow: false, rule: 'no-route', reason: 'No policy covers this route, so it is refused' });
  });

  it('refuses a role it does not know', () => {
    expect(ask({ id: 'u-x', role: 'superuser' as PolicyRole }, 'GET /api/dashboards/citizen').allow).toBe(false);
  });

  it('refuses a question with nothing in it', () => {
    expect(evaluate({}).allow).toBe(false);
    expect(evaluate({ subject: MORGAN, action: 'read' }).rule).toBe('no-route');
  });
});

describe('the defaults on cases: exactly what the guards allowed before', () => {
  const VIEW = 'GET /api/cases/:id';
  const WORK = 'PUT /api/cases/:id/assignment';

  it('lets an applicant read and act on their own case, and refuses them another person\'s', () => {
    expect(ask(APPLICANT, VIEW, aCase())).toEqual({ allow: true, rule: 'case-applicant', reason: 'People can view and act on their own applications' });
    expect(ask(APPLICANT, 'POST /api/cases/:id/status', aCase()).allow).toBe(true);
    expect(ask(ANOTHER, VIEW, aCase())).toEqual({ allow: false, rule: 'no-matching-rule', reason: "No rule lets a citizen view another person's case" });
    expect(ask(ANOTHER, 'POST /api/cases/:id/documents', aCase())).toEqual({ allow: false, rule: 'no-matching-rule', reason: "No rule lets a citizen work another person's case" });
  });

  it('keeps applicant-only routes closed to leadership unless the case is theirs', () => {
    expect(ask(DIRECTOR, VIEW, aCase()).allow).toBe(false);
    expect(ask(DIRECTOR, VIEW, aCase({ owner_id: DIRECTOR.id })).allow).toBe(true);
  });

  it('lets a case manager read and work every case (team visibility), and names the more specific rule when it applies', () => {
    expect(ask(ALDER, VIEW, aCase({ assigned_to: BISHOP.id }))).toEqual({
      allow: true,
      rule: 'case-manager-team',
      reason: 'Case managers can view and work every case (team visibility)',
    });
    expect(ask(ALDER, WORK, aCase({ assigned_to: BISHOP.id })).allow).toBe(true);
    expect(ask(ALDER, VIEW, aCase({ assigned_to: ALDER.id })).rule).toBe('case-manager-assigned');
    expect(ask(ALDER, VIEW, aCase()).rule).toBe('case-manager-queue');
  });

  it('lets an admin read and work anything', () => {
    expect(ask(MORGAN, VIEW, aCase({ assigned_to: BISHOP.id }))).toEqual({ allow: true, rule: 'case-admin', reason: 'Administrators can view and work every case' });
    expect(ask(MORGAN, WORK, aCase({ assigned_to: BISHOP.id, under_compliance_review: true })).allow).toBe(true);
  });

  it('refuses a citizen the staff routes about a case, even their own', () => {
    expect(ask(APPLICANT, WORK, aCase()).rule).toBe('route-roles');
    expect(ask(APPLICANT, 'GET /api/cases/:id/notes', aCase()).allow).toBe(false);
    expect(ask(APPLICANT, 'GET /api/compliance/cases/:caseId', aCase()).allow).toBe(false);
  });

  it('lets the request through when there is no such case, so the route answers 404 as it always has', () => {
    for (const subject of [APPLICANT, ALDER, MORGAN]) {
      expect(ask(subject, VIEW, { type: 'case', found: false })).toEqual({ allow: true, rule: 'not-found', reason: 'The record does not exist, so the route answers that itself' });
    }
  });

  it('does not let a missing case open a route that is closed to the role', () => {
    expect(ask(APPLICANT, WORK, { type: 'case', found: false }).allow).toBe(false);
    expect(ask(NOBODY, VIEW, { type: 'case', found: false }).allow).toBe(false);
  });

  it('refuses when the record was not loaded, or is not the kind of record the route is about', () => {
    expect(ask(MORGAN, VIEW, null).allow).toBe(false);
    expect(ask(MORGAN, VIEW, { type: 'account', found: true, owner_id: MORGAN.id }).allow).toBe(false);
  });
});

describe('the defaults on accounts and audit trails', () => {
  it('lets a person reach their own account and nobody else\'s, an administrator included (as the handlers always did)', () => {
    const own = { type: 'account', found: true, owner_id: APPLICANT.id } as const;
    expect(ask(APPLICANT, 'GET /api/users/:id', own)).toEqual({ allow: true, rule: 'account-self', reason: 'People can view and change their own account' });
    expect(ask(APPLICANT, 'PUT /api/users/:id', own).allow).toBe(true);
    expect(ask(ALDER, 'GET /api/users/:id', own)).toEqual({ allow: false, rule: 'no-matching-rule', reason: "No rule lets a case manager view another person's account" });
    expect(ask(MORGAN, 'PUT /api/users/:id', own).reason).toBe("No rule lets an administrator change another person's account");
  });

  it('lets a person read their own audit trail, and staff anyone\'s', () => {
    const trail = { type: 'audit_trail', found: true, owner_id: APPLICANT.id } as const;
    expect(ask(APPLICANT, 'GET /api/audit/user/:userId', trail).rule).toBe('audit-trail-self');
    expect(ask(ALDER, 'GET /api/audit/user/:userId', trail).rule).toBe('audit-trail-staff');
    expect(ask(MORGAN, 'GET /api/audit/user/:userId', trail).rule).toBe('audit-trail-staff');
    expect(ask(ANOTHER, 'GET /api/audit/user/:userId', trail)).toEqual({ allow: false, rule: 'no-matching-rule', reason: "No rule lets a citizen view another person's audit trail" });
    expect(ask(DIRECTOR, 'GET /api/audit/user/:userId', trail).allow).toBe(false);
  });
});

describe('after an administrator changes the data', () => {
  const VIEW = 'GET /api/cases/:id';
  const WORK = 'PUT /api/cases/:id/assignment';

  it('limits a case manager to their own work, the queue and reviews when the team rule is off', () => {
    configure(['case-manager-team']);
    const mine = aCase({ assigned_to: ALDER.id });
    const theirs = aCase({ assigned_to: BISHOP.id });
    expect(ask(ALDER, VIEW, mine)).toEqual({ allow: true, rule: 'case-manager-assigned', reason: 'Case managers can view and work cases assigned to them' });
    expect(ask(ALDER, WORK, mine).allow).toBe(true);
    expect(ask(ALDER, VIEW, theirs)).toEqual({ allow: false, rule: 'no-matching-rule', reason: 'No rule lets a case manager view a case assigned to someone else' });
    expect(ask(ALDER, WORK, theirs)).toEqual({ allow: false, rule: 'no-matching-rule', reason: 'No rule lets a case manager work a case assigned to someone else' });
  });

  it('still lets a case manager pick up the unassigned queue, and read a case waiting for review', () => {
    configure(['case-manager-team']);
    expect(ask(ALDER, WORK, aCase()).rule).toBe('case-manager-queue');
    const waiting = aCase({ assigned_to: BISHOP.id, under_compliance_review: true });
    expect(ask(ALDER, VIEW, waiting).rule).toBe('case-manager-review');
    expect(ask(ALDER, WORK, waiting).allow).toBe(false); // a review is read, not worked
  });

  it('leaves everyone else as they were when the team rule is off', () => {
    configure(['case-manager-team']);
    const theirs = aCase({ assigned_to: BISHOP.id });
    expect(ask(APPLICANT, VIEW, theirs).allow).toBe(true);
    expect(ask(MORGAN, VIEW, theirs).allow).toBe(true);
    expect(ask(BISHOP, VIEW, theirs).allow).toBe(true);
    expect(ask(ALDER, VIEW, { type: 'case', found: false }).allow).toBe(true); // 404 stays 404
  });

  it('gives no effect to a rule that is off, and an unrelated rule off changes nothing else', () => {
    configure(['case-applicant']);
    expect(ask(APPLICANT, VIEW, aCase()).allow).toBe(false);
    expect(ask(ALDER, VIEW, aCase({ owner_id: ALDER.id })).allow).toBe(true); // a case manager's own application, through the team rule
    configure(['audit-trail-self']);
    expect(ask(ALDER, VIEW, aCase()).allow).toBe(true);
  });

  it('refuses everyone when every case rule is off, except where the case does not exist', () => {
    configure(RULES.filter((rule) => rule.resource === 'case').map((rule) => rule.id));
    for (const subject of [APPLICANT, ALDER, MORGAN]) {
      expect(ask(subject, VIEW, aCase({ owner_id: subject.id, assigned_to: subject.id })).rule).toBe('no-matching-rule');
      expect(ask(subject, VIEW, { type: 'case', found: false }).allow).toBe(true);
    }
  });

  it('refuses a case manager on a route limited to admins, and still lets an admin in', () => {
    configure([], { 'GET /api/cases/export': ['admin'] });
    expect(ask(ALDER, 'GET /api/cases/export')).toEqual({ allow: false, rule: 'route-roles', reason: 'Only administrators can use this route' });
    expect(ask(MORGAN, 'GET /api/cases/export').allow).toBe(true);
    expect(ask(ALDER, 'GET /api/cases/stats').allow).toBe(true); // another staff route is untouched
  });

  it('names the roles a limited route still accepts', () => {
    configure([], { 'GET /api/dashboards/citizen': ['citizen', 'admin'] });
    expect(ask(ALDER, 'GET /api/dashboards/citizen').reason).toBe('Only citizens and administrators can use this route');
    configure([], { 'GET /api/dashboards/citizen': ['citizen', 'leadership', 'admin'] });
    expect(ask(ALDER, 'GET /api/dashboards/citizen').reason).toBe('Only citizens, leadership users and administrators can use this route');
  });

  it('limits a route that is about a record: a role taken off the route is refused before the record is considered', () => {
    configure([], { 'GET /api/cases/:id': ['case_manager', 'admin'] });
    expect(ask(APPLICANT, VIEW, aCase()).rule).toBe('route-roles');
    expect(ask(ALDER, VIEW, aCase()).allow).toBe(true);
  });

  it('gives one answer however the data is arranged', () => {
    configure(['case-manager-team', 'case-manager-queue']);
    for (const subject of [NOBODY, APPLICANT, ALDER, DIRECTOR, MORGAN]) {
      for (const route of Object.keys(BASELINE_ROUTES)) {
        const kind = BASELINE_ROUTES[route].resource;
        const resource: Resource | null = kind === 'case' ? aCase() : kind === 'account' ? { type: kind, found: true, owner_id: subject.id ?? 'x' } : kind ? { type: kind, found: true, owner_id: 'u-other' } : null;
        const decision = ask(subject, route, resource);
        expect(Object.keys(decision).sort()).toEqual(['allow', 'reason', 'rule']);
        expect([typeof decision.allow, typeof decision.rule, typeof decision.reason]).toEqual(['boolean', 'string', 'string']);
      }
    }
  });
});
