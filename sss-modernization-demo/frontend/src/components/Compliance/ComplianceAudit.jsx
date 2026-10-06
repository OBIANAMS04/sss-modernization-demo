import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { getUser } from '../../utils/tokenManager';
import { getApiErrorMessage } from '../../utils/apiError';
import { isStaffUser } from '../../utils/roles';
import { complianceService } from '../../services/complianceService';
import AppNav from '../Common/AppNav';
import DemoEnvironmentBanner from '../DemoEnvironmentBanner';

const PAGE_SIZE = 50;
const EMPTY = { from: '', to: '', user: '', decision: '', controlId: '', result: '' };

const inputClass =
  'w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none text-sm bg-white';

export default function ComplianceAudit() {
  const staff = isStaffUser(getUser());
  const [draft, setDraft] = useState(EMPTY);
  const [filters, setFilters] = useState(EMPTY);
  const [page, setPage] = useState(1);
  const [controls, setControls] = useState([]);
  const [result, setResult] = useState({ checks: [], total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    complianceService.matrix().then((m) => setControls(m.controls)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!staff) return;
    setLoading(true);
    complianceService
      .decisions(filters, page)
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

  return (
    <div className="min-h-screen bg-gray-50">
      <AppNav title="Compliance Audit Log" subtitle="Every control result for every exemption decision" />

      <main className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
        <DemoEnvironmentBanner />
        <Link to="/compliance" className="inline-block mb-4 text-blue-600 font-medium hover:text-blue-700">← Compliance dashboard</Link>

        {!staff ? (
          <div className="bg-white rounded-lg shadow-md p-6 text-gray-700">The audit log is available to case managers only.</div>
        ) : (
          <>
            {error && <div className="mb-4 p-4 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">{error}</div>}

            <form onSubmit={apply} className="bg-white rounded-lg shadow-md p-6 mb-6 grid grid-cols-1 md:grid-cols-7 gap-4 items-end">
              <div>
                <label htmlFor="a-from" className="block text-xs font-medium text-gray-600 mb-1">From</label>
                <input id="a-from" type="date" value={draft.from} onChange={set('from')} className={inputClass} />
              </div>
              <div>
                <label htmlFor="a-to" className="block text-xs font-medium text-gray-600 mb-1">To</label>
                <input id="a-to" type="date" value={draft.to} onChange={set('to')} className={inputClass} />
              </div>
              <div>
                <label htmlFor="a-user" className="block text-xs font-medium text-gray-600 mb-1">Applicant or decider</label>
                <input id="a-user" value={draft.user} onChange={set('user')} placeholder="Email" className={inputClass} />
              </div>
              <div>
                <label htmlFor="a-decision" className="block text-xs font-medium text-gray-600 mb-1">Decision</label>
                <select id="a-decision" value={draft.decision} onChange={set('decision')} className={inputClass}>
                  <option value="">All</option>
                  <option value="Approved">Approved</option>
                  <option value="Denied">Denied</option>
                </select>
              </div>
              <div>
                <label htmlFor="a-control" className="block text-xs font-medium text-gray-600 mb-1">Requirement</label>
                <select id="a-control" value={draft.controlId} onChange={set('controlId')} className={inputClass}>
                  <option value="">All</option>
                  {controls.map((c) => (
                    <option key={c.id} value={c.id}>{c.id} {c.requirement}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="a-result" className="block text-xs font-medium text-gray-600 mb-1">Result</label>
                <select id="a-result" value={draft.result} onChange={set('result')} className={inputClass}>
                  <option value="">All</option>
                  <option value="pass">Passed</option>
                  <option value="fail">Failed</option>
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
                    <th className="px-4 py-3 font-medium">Checked</th>
                    <th className="px-4 py-3 font-medium">Applicant</th>
                    <th className="px-4 py-3 font-medium">Decision</th>
                    <th className="px-4 py-3 font-medium">Requirement</th>
                    <th className="px-4 py-3 font-medium">Result</th>
                    <th className="px-4 py-3 font-medium">Evidence</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {loading ? (
                    <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-500">Loading...</td></tr>
                  ) : result.checks.length === 0 ? (
                    <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-500">No compliance checks match these filters.</td></tr>
                  ) : (
                    result.checks.map((c) => (
                      <tr key={c.id} className="align-top">
                        <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{new Date(c.checkedAt).toLocaleString()}</td>
                        <td className="px-4 py-3">
                          <Link to={`/cases/${c.caseId}`} className="font-medium text-blue-600 hover:underline">{c.applicantName}</Link>
                          <p className="text-xs text-gray-500">{c.applicantEmail} · {c.exemptionType}</p>
                        </td>
                        <td className="px-4 py-3">
                          <p className="text-gray-900">{c.decision}</p>
                          <p className="text-xs text-gray-500">by {c.decidedBy}</p>
                        </td>
                        <td className="px-4 py-3">
                          <p className="font-mono text-xs text-gray-500">{c.controlId}</p>
                          <p className="text-gray-900">{c.control}</p>
                          <p className="text-xs text-gray-500">{c.reference}</p>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${c.passed ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                            {c.passed ? 'Passed' : 'Failed'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-gray-700 max-w-sm">{c.evidence}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
              <div className="flex justify-between items-center px-4 py-3 border-t border-gray-100 text-sm text-gray-600">
                <span>{result.total} check{result.total === 1 ? '' : 's'}</span>
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
