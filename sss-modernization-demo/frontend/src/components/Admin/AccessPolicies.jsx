import { useState, useEffect, useId, useRef } from 'react';
import { Link } from 'react-router-dom';
import { getUser } from '../../utils/tokenManager';
import { getApiErrorMessage } from '../../utils/apiError';
import { isAdminUser } from '../../utils/roles';
import { policyService } from '../../services/policyService';
import AppNav from '../Common/AppNav';
import DemoEnvironmentBanner from '../DemoEnvironmentBanner';

const MAX_REASON = 500; // the API's limit
const ROLE_LABELS = { anonymous: 'Not signed in', citizen: 'Citizen', case_manager: 'Case manager', leadership: 'Leadership', admin: 'Administrator' };
const RECORD_NAMES = { case: 'case', account: 'account', audit_trail: 'audit trail' };
// Who a rule is about, in words (the rule's `when`)
const CONDITIONS = {
  any: (rule) => `Every ${RECORD_NAMES[rule.resource]}`,
  owner: (rule) => `Their own ${RECORD_NAMES[rule.resource]}`,
  assignee: () => 'A case assigned to them',
  unassigned: () => 'A case assigned to no one',
  under_review: () => 'A case waiting for a compliance review',
};

const inputClass =
  'w-full px-3 py-2 border border-gray-500 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none text-sm bg-white';

const roleList = (roles) => roles.map((role) => ROLE_LABELS[role] || role).join(', ');
const sameRoles = (a, b) => a.length === b.length && a.every((role) => b.includes(role));
const formatTime = (value) => (value ? new Date(value).toLocaleString() : '—');

/**
 * STORY-016: the access policy. Which rules about cases, accounts and audit trails are on, and which roles may use each API route,
 * changed here and applied at once, with a reason that is kept in the audit log and in the history below. Roles can only be
 * taken away from a route, never added beyond what the code allows. Open Policy Agent decides every request.
 */
export default function AccessPolicies() {
  const admin = isAdminUser(getUser());
  const [policy, setPolicy] = useState(null);
  const [loading, setLoading] = useState(admin);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [rulesOn, setRulesOn] = useState({}); // rule id -> on, as the form has it
  const [routeRoles, setRouteRoles] = useState({}); // route -> roles, as the form has it
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState('');
  const [routeError, setRouteError] = useState(null); // { key, message }
  const engineHeadingId = useId();
  const rulesHeadingId = useId();
  const routesHeadingId = useId();
  const saveHeadingId = useId();
  const historyHeadingId = useId();
  const reasonId = useId();
  const reasonHintId = useId();
  const reasonErrorId = useId();
  const routeErrorId = useId();
  const errorRef = useRef(null);
  const historyHeadingRef = useRef(null);

  // The form starts from what the server says is in force
  const show = (view) => {
    setPolicy(view);
    setRulesOn(Object.fromEntries(view.rules.map((rule) => [rule.id, rule.enabled])));
    setRouteRoles(Object.fromEntries(view.routes.map((route) => [route.key, route.roles])));
  };

  useEffect(() => {
    if (!admin) return;
    policyService
      .get()
      .then(show)
      .catch((err) => setError(getApiErrorMessage(err, 'Could not load the access policy.')))
      .finally(() => setLoading(false));
  }, [admin]);

  // A refused change is announced (role="alert") and also takes focus, because the button that was pressed has gone quiet
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  const changedRules = policy ? policy.rules.filter((rule) => rulesOn[rule.id] !== rule.enabled) : [];
  const changedRoutes = policy ? policy.routes.filter((route) => !route.locked && !sameRoles(routeRoles[route.key] ?? route.roles, route.roles)) : [];

  const toggleRole = (route, role, checked) => {
    setRouteError(null);
    setRouteRoles((prev) => {
      const current = prev[route.key] ?? route.roles;
      return { ...prev, [route.key]: route.baselineRoles.filter((r) => (r === role ? checked : current.includes(r))) };
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setNotice('');
    setReasonError('');
    setRouteError(null);

    // The fields in page order, so focus goes to the first one that is wrong
    const empty = changedRoutes.find((route) => routeRoles[route.key].length === 0);
    if (empty) {
      setRouteError({ key: empty.key, message: `Choose at least one role for ${empty.key}.` });
      document.getElementById(`route-${policy.routes.indexOf(empty)}-${empty.baselineRoles[0]}`)?.focus();
      return;
    }
    if (changedRules.length === 0 && changedRoutes.length === 0) {
      setError('Nothing has changed yet. Switch a rule on or off, or limit a route to fewer roles, then save.');
      return;
    }
    if (!reason.trim()) {
      setReasonError('A reason is required. It is kept in the audit log.');
      document.getElementById(reasonId)?.focus();
      return;
    }

    setBusy(true);
    try {
      const saved = await policyService.save({
        rules: Object.fromEntries(changedRules.map((rule) => [rule.id, rulesOn[rule.id]])),
        routes: Object.fromEntries(changedRoutes.map((route) => [route.key, routeRoles[route.key]])),
        reason: reason.trim(),
      });
      show(saved);
      setReason('');
      setNotice(`Saved as version ${saved.current.version}: ${saved.current.summary}. It applies to every request from now on.`);
      historyHeadingRef.current?.focus();
    } catch (err) {
      setError(getApiErrorMessage(err, 'The policy was not saved.'));
    } finally {
      setBusy(false);
    }
  };

  const current = policy?.current;

  return (
    <div className="min-h-screen bg-gray-50">
      <AppNav title="Access Policies" subtitle="Who can reach what in the API, decided by Open Policy Agent and changed without a deploy" />

      <main id="main" tabIndex={-1} className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8 focus:outline-none">
        <DemoEnvironmentBanner />

        {!admin ? (
          <div className="bg-white rounded-lg shadow-md p-6 text-gray-700">
            Access Policies are available to administrators only. If you were just given access, log out and log back in.
          </div>
        ) : (
          <>
            {error && (
              <div ref={errorRef} tabIndex={-1} role="alert" className="mb-4 p-4 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm wrap-anywhere focus:outline-none">
                {error}
              </div>
            )}
            {notice && <div role="status" className="mb-4 p-4 bg-green-50 border border-green-200 text-green-800 rounded-lg text-sm wrap-anywhere">{notice}</div>}

            {loading ? (
              <div role="status" className="text-center py-12">
                <div className="inline-block animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600" aria-hidden="true"></div>
                <p className="mt-4 text-gray-600">Loading the access policy...</p>
              </div>
            ) : (
              policy && (
                <>
                  <section aria-labelledby={engineHeadingId} className="bg-white rounded-lg shadow-md p-6 mb-6">
                    <h2 id={engineHeadingId} className="text-xl font-bold text-gray-900">Policy in force</h2>
                    <p className="text-sm text-gray-700 mt-2 wrap-anywhere">
                      {policy.engine.name} {policy.engine.version}, compiled to {policy.engine.format}, evaluated inside the API on every request. Policy hash{' '}
                      <code title={policy.engine.wasmSha256} className="font-mono text-xs bg-gray-100 px-1 py-0.5 rounded">{policy.engine.wasmSha256.slice(0, 12)}</code>.
                    </p>
                    <p className="text-sm text-gray-700 mt-2 wrap-anywhere">
                      {current.version === 0 ? (
                        <>Version 0: the defaults that come with the code. No one has changed the policy yet.</>
                      ) : (
                        <>
                          Version {current.version}, saved {formatTime(current.changedAt)} by {current.changedBy ?? 'unknown'}. Reason: {current.reason}
                        </>
                      )}
                    </p>
                    <p className="text-sm text-gray-700 mt-2">
                      Every change is recorded in the{' '}
                      <Link to="/audit" className="text-blue-700 underline hover:text-blue-800 rounded focus:outline-none focus:ring-2 focus:ring-blue-500">
                        Security Audit Log
                      </Link>
                      , and so is every request the policy refuses. The checks on each route stay in place behind the policy.
                    </p>
                  </section>

                  <form onSubmit={handleSubmit} noValidate aria-labelledby={saveHeadingId}>
                    <section aria-labelledby={rulesHeadingId} className="bg-white rounded-lg shadow-md mb-6">
                      <h2 id={rulesHeadingId} className="text-xl font-bold text-gray-900 px-6 pt-6">Case and account rules</h2>
                      <p className="text-sm text-gray-600 px-6 mt-1 mb-3">
                        A request is allowed when the route accepts the person&apos;s role and at least one of these rules that is on applies. All are on by default,
                        which is how the API has always behaved. Turn one off to take that access away.
                      </p>
                      {/* relative: the visually hidden labels in the cells are positioned inside this box, so they scroll with it instead of widening the page */}
                      <div className="relative overflow-x-auto">
                        <table className="min-w-full text-sm">
                          <caption className="sr-only">Rules about cases, accounts and audit trails</caption>
                          <thead className="bg-gray-50 text-left text-gray-600">
                            <tr>
                              <th scope="col" className="px-2 sm:px-4 py-3 font-medium">Rule</th>
                              <th scope="col" className="px-2 sm:px-4 py-3 font-medium">What it allows</th>
                              <th scope="col" className="px-2 sm:px-4 py-3 font-medium">Roles</th>
                              <th scope="col" className="px-2 sm:px-4 py-3 font-medium">Actions</th>
                              <th scope="col" className="px-2 sm:px-4 py-3 font-medium">Applies to</th>
                              <th scope="col" className="px-2 sm:px-4 py-3 font-medium">On or off</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                            {policy.rules.map((rule) => (
                              <tr key={rule.id} className="align-top">
                                <th scope="row" className="px-2 sm:px-4 py-3 text-left font-normal text-gray-900">
                                  <code className="font-mono text-xs wrap-anywhere">{rule.id}</code>
                                </th>
                                <td className="px-2 sm:px-4 py-3 text-gray-900 min-w-48">{rule.description}</td>
                                <td className="px-2 sm:px-4 py-3 text-gray-700">{roleList(rule.roles)}</td>
                                <td className="px-2 sm:px-4 py-3 text-gray-700">{rule.actions.length === 2 ? 'View and change' : 'View'}</td>
                                <td className="px-2 sm:px-4 py-3 text-gray-700">{CONDITIONS[rule.when](rule)}</td>
                                <td className="px-2 sm:px-4 py-3 text-gray-700 whitespace-nowrap">
                                  <label className="inline-flex items-center gap-2">
                                    <input
                                      type="checkbox"
                                      checked={rulesOn[rule.id] ?? rule.enabled}
                                      onChange={(e) => setRulesOn((prev) => ({ ...prev, [rule.id]: e.target.checked }))}
                                      className="h-4 w-4"
                                    />
                                    <span aria-hidden="true">{(rulesOn[rule.id] ?? rule.enabled) ? 'On' : 'Off'}</span>
                                    <span className="sr-only">{rule.description}</span>
                                  </label>
                                  {rulesOn[rule.id] !== rule.enabled && <span className="block text-xs text-blue-700 mt-1">Changed, not saved yet</span>}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </section>

                    <section aria-labelledby={routesHeadingId} className="bg-white rounded-lg shadow-md mb-6">
                      <h2 id={routesHeadingId} className="text-xl font-bold text-gray-900 px-6 pt-6">Route restrictions</h2>
                      <p className="text-sm text-gray-600 px-6 mt-1 mb-3">
                        Each route is shown with the roles its code allows. Clear a role to stop it using that route. A role the code does not allow cannot be
                        added here. Sign-in, the health check and these policy pages are locked, so an administrator can never be locked out.
                      </p>
                      <div className="relative overflow-x-auto">
                        <table className="min-w-full text-sm">
                          <caption className="sr-only">Roles allowed on each API route</caption>
                          <thead className="bg-gray-50 text-left text-gray-600">
                            <tr>
                              <th scope="col" className="px-2 sm:px-4 py-3 font-medium">Route</th>
                              <th scope="col" className="px-2 sm:px-4 py-3 font-medium">Roles allowed</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                            {policy.routes.map((route, index) => {
                              const roles = routeRoles[route.key] ?? route.roles;
                              const changed = !route.locked && !sameRoles(roles, route.roles);
                              const invalid = routeError?.key === route.key;
                              return (
                                <tr key={route.key} className="align-top">
                                  <th scope="row" className="px-2 sm:px-4 py-3 text-left font-normal text-gray-900">
                                    <code className="font-mono text-xs wrap-anywhere">{route.method} {route.path}</code>
                                    {changed && <span className="block text-xs text-blue-700 mt-1">Changed, not saved yet</span>}
                                  </th>
                                  <td className="px-2 sm:px-4 py-3 text-gray-700">
                                    {route.locked ? (
                                      <>
                                        Locked<span className="sr-only">: a policy change cannot limit this route</span>
                                      </>
                                    ) : (
                                      <fieldset className="flex flex-wrap gap-x-4 gap-y-1">
                                        <legend className="sr-only">Roles allowed on {route.method} {route.path}</legend>
                                        {route.baselineRoles.map((role) => (
                                          <label key={role} className="inline-flex items-center gap-2 whitespace-nowrap">
                                            <input
                                              id={`route-${index}-${role}`}
                                              type="checkbox"
                                              checked={roles.includes(role)}
                                              onChange={(e) => toggleRole(route, role, e.target.checked)}
                                              aria-invalid={invalid ? 'true' : undefined}
                                              aria-describedby={invalid ? routeErrorId : undefined}
                                              className="h-4 w-4"
                                            />
                                            {ROLE_LABELS[role]}
                                          </label>
                                        ))}
                                      </fieldset>
                                    )}
                                    {invalid && <p id={routeErrorId} className="text-red-700 text-xs mt-1 wrap-anywhere">{routeError.message}</p>}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </section>

                    <section aria-labelledby={saveHeadingId} className="bg-white rounded-lg shadow-md p-6 mb-6">
                      <h2 id={saveHeadingId} className="text-xl font-bold text-gray-900">Save the changes</h2>
                      <p className="text-sm text-gray-600 mt-1 mb-4">
                        {changedRules.length + changedRoutes.length === 0
                          ? 'Nothing has changed yet.'
                          : `${changedRules.length} ${changedRules.length === 1 ? 'rule' : 'rules'} and ${changedRoutes.length} ${changedRoutes.length === 1 ? 'route' : 'routes'} changed.`}
                      </p>
                      <div className="space-y-4 max-w-xl">
                        <div>
                          <label htmlFor={reasonId} className="block text-sm font-medium text-gray-700 mb-1">Reason for this change</label>
                          <textarea
                            id={reasonId}
                            rows={3}
                            required
                            maxLength={MAX_REASON}
                            value={reason}
                            onChange={(e) => {
                              setReason(e.target.value);
                              setReasonError('');
                            }}
                            aria-invalid={reasonError ? 'true' : undefined}
                            aria-describedby={reasonError ? `${reasonHintId} ${reasonErrorId}` : reasonHintId}
                            className={inputClass}
                          />
                          <p id={reasonHintId} className="text-xs text-gray-600 mt-1">Required, up to {MAX_REASON} characters. Kept in the Security Audit Log with your name.</p>
                          {reasonError && <p id={reasonErrorId} className="text-red-700 text-xs mt-1">{reasonError}</p>}
                        </div>
                        <button
                          type="submit"
                          disabled={busy}
                          className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2"
                        >
                          Save policy
                        </button>
                      </div>
                    </section>
                  </form>

                  <section aria-labelledby={historyHeadingId} className="bg-white rounded-lg shadow-md">
                    <h2 id={historyHeadingId} ref={historyHeadingRef} tabIndex={-1} className="text-xl font-bold text-gray-900 px-6 pt-6 focus:outline-none">History</h2>
                    <p className="text-sm text-gray-600 px-6 mt-1 mb-3">The last {policy.history.length === 1 ? 'version' : `${policy.history.length} versions`}, newest first. A version is never edited or deleted.</p>
                    {policy.history.length === 0 ? (
                      <p className="px-6 pb-6 text-sm text-gray-700">No changes yet. The rules and routes above are the defaults that come with the code.</p>
                    ) : (
                      <div className="relative overflow-x-auto">
                        <table className="min-w-full text-sm">
                          <caption className="sr-only">Versions of the access policy, newest first</caption>
                          <thead className="bg-gray-50 text-left text-gray-600">
                            <tr>
                              <th scope="col" className="px-2 sm:px-4 py-3 font-medium">Version</th>
                              <th scope="col" className="px-2 sm:px-4 py-3 font-medium">When</th>
                              <th scope="col" className="px-2 sm:px-4 py-3 font-medium">Who</th>
                              <th scope="col" className="px-2 sm:px-4 py-3 font-medium">What changed</th>
                              <th scope="col" className="px-2 sm:px-4 py-3 font-medium">Reason</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                            {policy.history.map((version) => (
                              <tr key={version.version} className="align-top">
                                <th scope="row" className="px-2 sm:px-4 py-3 text-left font-medium text-gray-900 tabular-nums">{version.version}</th>
                                <td className="px-2 sm:px-4 py-3 text-gray-700">{formatTime(version.changedAt)}</td>
                                <td className="px-2 sm:px-4 py-3 text-gray-700 break-words">{version.changedBy ?? '—'}</td>
                                <td className="px-2 sm:px-4 py-3 text-gray-900 wrap-anywhere min-w-48">{version.summary}</td>
                                <td className="px-2 sm:px-4 py-3 text-gray-700 wrap-anywhere min-w-48">{version.reason}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </section>
                </>
              )
            )}
          </>
        )}
      </main>
    </div>
  );
}
