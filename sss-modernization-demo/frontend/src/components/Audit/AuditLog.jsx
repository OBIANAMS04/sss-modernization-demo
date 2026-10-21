import { useState, useEffect } from 'react';
import { getUser } from '../../utils/tokenManager';
import { getApiErrorMessage } from '../../utils/apiError';
import { isStaffUser } from '../../utils/roles';
import { auditService } from '../../services/auditService';
import AppNav from '../Common/AppNav';
import DemoEnvironmentBanner from '../DemoEnvironmentBanner';

const PAGE_SIZE = 50;
const EMPTY = { startDate: '', endDate: '', user: '', action: '', resource: '', status: '' };
const RESOURCES = ['auth', 'users', 'mfa', 'exemptions', 'cases', 'compliance', 'freshness', 'audit', 'notifications', 'policies', 'assistant', 'system'];

const LABELS = {
  USER_LOGIN: 'Sign-in',
  USER_LOGOUT: 'Sign-out',
  SESSION_EXTEND: 'Session extended',
  USER_REGISTRATION: 'Registration',
  MFA_SETUP: 'MFA setup',
  MFA_ENABLE: 'MFA enabled',
  MFA_CHALLENGE: 'MFA code requested',
  MFA_VERIFIED: 'MFA code accepted',
  MFA_RECOVERY_CODES_CREATED: 'MFA recovery codes made',
  MFA_RECOVERY_CODE_USED: 'MFA recovery code used',
  MFA_VERIFY_FAILED: 'MFA code refused',
  MFA_DISABLE: 'MFA turned off',
  ACCESS_DENIED: 'Access denied',
  PERMISSION_GRANT: 'Role granted',
  PERMISSION_REVOKE: 'Role removed',
  POLICY_CHANGE: 'Access policy changed',
  PROFILE_UPDATE: 'Profile update',
  DATA_READ: 'Data read',
  DATA_EXPORT: 'Data export',
  CASE_CREATE: 'Application',
  CASE_UPDATE: 'Case assignment',
  CASE_STATUS_CHANGE: 'Case status change',
  CASE_NOTE_ADD: 'Internal note',
  CASE_DOCUMENT_UPLOAD: 'Document added',
  EXEMPTION_CHECK: 'Eligibility check',
  COMPLIANCE_CHECK: 'Compliance check',
  COMPLIANCE_ALERT: 'Compliance alert',
  OVERRIDE: 'Override',
  AI_ANSWER: 'Assistant answer',
  AI_FEEDBACK: 'Assistant feedback',
  AI_REVIEW: 'Assistant answer reviewed',
  AI_CORPUS_UPDATE: 'Policy documents updated',
  ALERT_TRIGGERED: 'Freshness alert',
  DEPLOYMENT: 'Deployment',
  SERVER_START: 'Server restart',
  CONFIG_CHANGE: 'Configuration change',
};

const inputClass =
  'w-full px-3 py-2 border border-gray-500 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none text-sm bg-white focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-transparent';

function who(log) {
  if (log.actorEmail) return log.actorEmail;
  if (log.details?.email && log.resource === 'auth') return `${log.details.email} (not signed in)`;
  return log.resource === 'system' || log.action.startsWith('PERMISSION_') ? 'System' : 'Not signed in';
}

function describe(log) {
  const d = log.details || {};
  if (d.route) {
    const query = Object.entries(d.query || {}).map(([k, v]) => `${k}=${v}`).join('&');
    return `${d.route}${query ? `?${query}` : ''}`;
  }
  // STORY-016: a request the access policy refused also says which rule decided, why, and which version of the policy it was
  if (d.path) {
    const refusal = d.rule ? ` · rule: ${d.rule} · ${d.reason}${d.policyVersion !== undefined ? ` (policy version ${d.policyVersion})` : ''}` : '';
    return `${d.method} ${d.path} → ${d.status}${refusal}`;
  }
  // A policy change leads with what changed and why (stored JSON does not keep key order)
  if (log.action === 'POLICY_CHANGE' && d.summary) return `version ${d.version}: ${d.summary}${d.reason ? ` · reason: ${d.reason}` : ''}`;
  // The assistant (STORY-017 to 023): the entry names the exchange and what happened to it. The question and the answer are never in it.
  if (log.action === 'AI_REVIEW' && d.outcome) {
    return [`outcome: ${d.outcome}`, d.reported && 'reported by the person', `level ${d.level}`, `exchange ${String(d.traceId).slice(0, 8)}`, d.note && `note: ${d.note}`].filter(Boolean).join(' · ');
  }
  if (log.action === 'AI_FEEDBACK' && d.rating) {
    return [`rating: ${d.rating}`, d.queued && 'sent to the review queue', d.commented && 'with a comment', `exchange ${String(d.traceId).slice(0, 8)}`].filter(Boolean).join(' · ');
  }
  if (log.action === 'AI_ANSWER' && d.status) {
    return [`${d.status}, level ${d.level}`, `${d.mode} mode`, d.grounded === false && 'failed the grounding check', d.fallback && `fallback: ${d.fallback}`, `exchange ${String(d.traceId).slice(0, 8)}`].filter(Boolean).join(' · ');
  }
  // A role change leads with the person and the reason. Stored JSON does not keep key order, which put the reason last,
  // and a long address or reason then cut it off.
  if (log.action.startsWith('PERMISSION_') && d.email) {
    return [d.email, d.reason && `reason: ${d.reason}`, d.role && `role: ${d.role}`, d.via && `via: ${d.via}`].filter(Boolean).join(' · ');
  }
  // Lists of records read briefly, e.g. "Type A Eligible" (stored JSON does not keep key order)
  const item = (v) => {
    if (!v || typeof v !== 'object') return v;
    if (v.exemptionType) return `${v.exemptionType} ${v.status ?? ''}`.trim();
    return Object.values(v).slice(0, 2).join(' ');
  };
  const text = Object.entries(d)
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.map(item).join(', ') || 'none' : typeof v === 'object' && v !== null ? JSON.stringify(v) : v}`)
    .join(' · ');
  return text || '—';
}

// Long details are shortened in the table; the full text shows on hover
const shorten = (text) => (text.length > 160 ? `${text.slice(0, 157)}...` : text);

export default function AuditLog() {
  const staff = isStaffUser(getUser());
  const [draft, setDraft] = useState(EMPTY);
  const [filters, setFilters] = useState(EMPTY);
  const [page, setPage] = useState(1);
  const [result, setResult] = useState({ logs: [], total: 0 });
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (staff) auditService.stats().then(setStats).catch(() => {});
  }, [staff]);

  useEffect(() => {
    if (!staff) return;
    setLoading(true);
    auditService
      .list(filters, page, PAGE_SIZE)
      .then((r) => {
        setResult(r);
        setError('');
      })
      .catch((err) => setError(getApiErrorMessage(err, 'Could not load the audit log.')))
      .finally(() => setLoading(false));
  }, [filters, page, staff]);

  const apply = (e) => {
    e.preventDefault();
    setPage(1);
    setFilters(draft);
  };
  const set = (name) => (e) => setDraft((prev) => ({ ...prev, [name]: e.target.value }));
  const pages = Math.max(1, Math.ceil(result.total / PAGE_SIZE));
  const actions = stats ? Object.keys(stats.eventsByAction).sort() : [];

  return (
    <div className="min-h-screen bg-gray-50">
      <AppNav title="Security Audit Log" subtitle="Every sign-in, refusal, data access, change and alert" />

      <main id="main" tabIndex={-1} className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8 focus:outline-none">
        <DemoEnvironmentBanner />

        {!staff ? (
          <div className="bg-white rounded-lg shadow-md p-6 text-gray-700">The audit log is available to case managers only.</div>
        ) : (
          <>
            {error && <div role="alert" className="mb-4 p-4 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">{error}</div>}

            {stats && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                <div className={`rounded-lg p-4 text-sm border ${stats.immutable ? 'bg-green-50 border-green-200 text-green-800' : 'bg-red-50 border-red-300 text-red-800'}`}>
                  <p className="font-semibold">{stats.immutable ? 'Write-once' : 'Not write-once'}</p>
                  <p>{stats.immutable ? 'The database refuses any edit or deletion of an entry.' : 'The database is not refusing edits; check migration 015.'}</p>
                </div>
                <div className="rounded-lg p-4 text-sm border bg-white border-gray-200 text-gray-700">
                  <p className="font-semibold text-gray-900">Kept for {stats.retention}</p>
                  <p>{stats.totalEvents.toLocaleString()} entries, {stats.failedEvents.toLocaleString()} of them refusals or failures.</p>
                </div>
                <div className="rounded-lg p-4 text-sm border bg-white border-gray-200 text-gray-700">
                  <p className="font-semibold text-gray-900">No personal data</p>
                  <p>SSNs, passwords, codes and tokens are removed before an entry is written.</p>
                </div>
              </div>
            )}

            <form onSubmit={apply} className="bg-white rounded-lg shadow-md p-6 mb-6 grid grid-cols-1 md:grid-cols-7 gap-4 items-end">
              <div>
                <label htmlFor="l-from" className="block text-xs font-medium text-gray-600 mb-1">From</label>
                <input id="l-from" type="date" value={draft.startDate} onChange={set('startDate')} className={inputClass} />
              </div>
              <div>
                <label htmlFor="l-to" className="block text-xs font-medium text-gray-600 mb-1">To</label>
                <input id="l-to" type="date" value={draft.endDate} onChange={set('endDate')} className={inputClass} />
              </div>
              <div>
                <label htmlFor="l-user" className="block text-xs font-medium text-gray-600 mb-1">User</label>
                <input id="l-user" value={draft.user} onChange={set('user')} placeholder="Email" className={inputClass} />
              </div>
              <div>
                <label htmlFor="l-action" className="block text-xs font-medium text-gray-600 mb-1">Event</label>
                <select id="l-action" value={draft.action} onChange={set('action')} className={inputClass}>
                  <option value="">All</option>
                  {actions.map((a) => (
                    <option key={a} value={a}>{LABELS[a] || a}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="l-resource" className="block text-xs font-medium text-gray-600 mb-1">Area</label>
                <select id="l-resource" value={draft.resource} onChange={set('resource')} className={inputClass}>
                  <option value="">All</option>
                  {RESOURCES.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="l-status" className="block text-xs font-medium text-gray-600 mb-1">Result</label>
                <select id="l-status" value={draft.status} onChange={set('status')} className={inputClass}>
                  <option value="">All</option>
                  <option value="success">Succeeded</option>
                  <option value="failure">Refused or failed</option>
                </select>
              </div>
              <div className="flex gap-2">
                <button type="submit" className="flex-1 bg-blue-600 text-white px-3 py-2 rounded-lg text-sm font-medium hover:bg-blue-700">Search</button>
                <button
                  type="button"
                  onClick={() => {
                    setDraft(EMPTY);
                    setPage(1);
                    setFilters(EMPTY);
                  }}
                  className="px-3 py-2 rounded-lg text-sm border border-gray-300 hover:bg-gray-50"
                >
                  Reset
                </button>
              </div>
            </form>

            <section className="bg-white rounded-lg shadow-md overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 text-left text-gray-600">
                  <tr>
                    <th className="px-4 py-3 font-medium">When</th>
                    <th className="px-4 py-3 font-medium">User</th>
                    <th className="px-4 py-3 font-medium">Event</th>
                    <th className="px-4 py-3 font-medium">Area</th>
                    <th className="px-4 py-3 font-medium">Result</th>
                    <th className="px-4 py-3 font-medium">Details</th>
                    <th className="px-4 py-3 font-medium">From</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {loading ? (
                    <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-500">Loading...</td></tr>
                  ) : result.logs.length === 0 ? (
                    <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-500">No entries match these filters.</td></tr>
                  ) : (
                    result.logs.map((log) => (
                      <tr key={log.id} className="align-top">
                        <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{new Date(log.timestamp).toLocaleString()}</td>
                        <td className="px-4 py-3 text-gray-900">{who(log)}</td>
                        <td className="px-4 py-3">
                          <p className="text-gray-900">{LABELS[log.action] || log.action}</p>
                          <p className="font-mono text-xs text-gray-500">{log.action}</p>
                        </td>
                        <td className="px-4 py-3 text-gray-700">{log.resource}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${log.status === 'success' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                            {log.status === 'success' ? 'Succeeded' : 'Refused or failed'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-gray-700 max-w-md break-words" title={describe(log)}>{shorten(describe(log))}</td>
                        <td className="px-4 py-3 font-mono text-xs text-gray-500 whitespace-nowrap">{log.ipAddress || '—'}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
              <div className="flex justify-between items-center px-4 py-3 border-t border-gray-100 text-sm text-gray-600">
                <span>{result.total.toLocaleString()} entr{result.total === 1 ? 'y' : 'ies'}</span>
                <div className="flex items-center gap-2">
                  <button onClick={() => setPage((p) => p - 1)} disabled={page <= 1} className="px-3 py-1 border rounded-lg disabled:opacity-40">Previous</button>
                  <span>Page {page} of {pages}</span>
                  <button onClick={() => setPage((p) => p + 1)} disabled={page >= pages} className="px-3 py-1 border rounded-lg disabled:opacity-40">Next</button>
                </div>
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
