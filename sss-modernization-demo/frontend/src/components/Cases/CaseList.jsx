import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { getUser } from '../../utils/tokenManager';
import { getApiErrorMessage } from '../../utils/apiError';
import { caseService } from '../../services/caseService';
import { isStaffUser } from '../../utils/roles';
import AppNav from '../Common/AppNav';
import StatusBadge from '../Common/StatusBadge';
import DemoEnvironmentBanner from '../DemoEnvironmentBanner';

const STATUSES = ['Submitted', 'In Review', 'Appealed', 'Approved', 'Denied', 'Draft'];
const EXEMPTION_TYPES = ['Type A', 'Type B', 'Type C'];
const PAGE_SIZE = 25;

const EMPTY_FILTERS = { status: '', exemptionType: '', assignedTo: '', applicant: '', openOnly: true };

const inputClass =
  'w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition text-sm bg-white';

export default function CaseList() {
  const user = getUser();
  const staff = isStaffUser(user);

  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [applicantInput, setApplicantInput] = useState('');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState({ cases: [], total: 0 });
  const [stats, setStats] = useState(null);
  const [managers, setManagers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!staff) return;
    Promise.all([caseService.stats(), caseService.managers()])
      .then(([s, m]) => {
        setStats(s);
        setManagers(m);
      })
      .catch((err) => setError(getApiErrorMessage(err, 'Could not load case statistics.')));
  }, [staff]);

  useEffect(() => {
    if (!staff) return;
    setLoading(true);
    caseService
      .listAll(filters, page)
      .then(setResult)
      .catch((err) => setError(getApiErrorMessage(err, 'Could not load cases.')))
      .finally(() => setLoading(false));
  }, [filters, page, staff]);

  const updateFilter = (name, value) => {
    setPage(1);
    setFilters((prev) => ({ ...prev, [name]: value }));
  };

  const handleSearch = (e) => {
    e.preventDefault();
    updateFilter('applicant', applicantInput.trim());
  };

  const handleExport = async () => {
    setExporting(true);
    setError('');
    try {
      await caseService.exportCsv(filters);
    } catch (err) {
      setError(getApiErrorMessage(err, 'Export failed.'));
    } finally {
      setExporting(false);
    }
  };

  const pages = Math.max(1, Math.ceil(result.total / PAGE_SIZE));
  const statCards = [
    { label: 'Open cases', value: stats?.open ?? '—' },
    ...['Submitted', 'In Review', 'Appealed', 'Approved', 'Denied'].map((s) => ({ label: s, value: stats?.byStatus?.[s] ?? 0 })),
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <AppNav title="Case Management" subtitle="Review and decide exemption applications" />

      <main className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
        <DemoEnvironmentBanner />

        {!staff ? (
          <div className="bg-white rounded-lg shadow-md p-6 text-gray-700">
            Case management is available to case managers only. If you were just given access, log out and log back in.
          </div>
        ) : (
          <>
            {error && <div className="mb-4 p-4 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">{error}</div>}

            <div className="grid grid-cols-2 md:grid-cols-6 gap-4 mb-6">
              {statCards.map((card) => (
                <div key={card.label} className="bg-white rounded-lg shadow p-4">
                  <p className="text-xs text-gray-500">{card.label}</p>
                  <p className="text-2xl font-bold text-gray-900">{card.value}</p>
                </div>
              ))}
            </div>

            <section className="bg-white rounded-lg shadow-md p-6 mb-6">
              <div className="grid grid-cols-1 md:grid-cols-5 gap-4 items-end">
                <div>
                  <label htmlFor="f-status" className="block text-xs font-medium text-gray-600 mb-1">Status</label>
                  <select id="f-status" value={filters.status} onChange={(e) => updateFilter('status', e.target.value)} className={inputClass}>
                    <option value="">All statuses</option>
                    {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor="f-type" className="block text-xs font-medium text-gray-600 mb-1">Exemption type</label>
                  <select id="f-type" value={filters.exemptionType} onChange={(e) => updateFilter('exemptionType', e.target.value)} className={inputClass}>
                    <option value="">All types</option>
                    {EXEMPTION_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor="f-assigned" className="block text-xs font-medium text-gray-600 mb-1">Assigned case manager</label>
                  <select id="f-assigned" value={filters.assignedTo} onChange={(e) => updateFilter('assignedTo', e.target.value)} className={inputClass}>
                    <option value="">Anyone</option>
                    <option value="unassigned">Unassigned</option>
                    {managers.map((m) => <option key={m.email} value={m.email}>{m.email === user?.email ? `Me (${m.email})` : m.fullName}</option>)}
                  </select>
                </div>
                <form onSubmit={handleSearch}>
                  <label htmlFor="f-applicant" className="block text-xs font-medium text-gray-600 mb-1">Applicant name or email</label>
                  <div className="flex gap-2">
                    <input id="f-applicant" value={applicantInput} onChange={(e) => setApplicantInput(e.target.value)} className={inputClass} placeholder="Search" />
                    <button type="submit" className="bg-blue-600 text-white px-3 rounded-lg text-sm font-medium hover:bg-blue-700">Go</button>
                  </div>
                </form>
                <div className="flex flex-col gap-2">
                  <label className="flex items-center gap-2 text-sm text-gray-700">
                    <input type="checkbox" checked={filters.openOnly} onChange={(e) => updateFilter('openOnly', e.target.checked)} className="h-4 w-4" />
                    Open cases only
                  </label>
                  <button onClick={handleExport} disabled={exporting} className="bg-gray-800 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-900 disabled:opacity-50">
                    {exporting ? 'Exporting...' : 'Export CSV'}
                  </button>
                </div>
              </div>
              {(filters.status || filters.exemptionType || filters.assignedTo || filters.applicant || !filters.openOnly) && (
                <button
                  onClick={() => {
                    setApplicantInput('');
                    setPage(1);
                    setFilters(EMPTY_FILTERS);
                  }}
                  className="mt-3 text-sm text-blue-600 hover:underline"
                >
                  Reset filters
                </button>
              )}
            </section>

            <section className="bg-white rounded-lg shadow-md overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 text-left text-gray-600">
                  <tr>
                    <th className="px-4 py-3 font-medium">Applicant</th>
                    <th className="px-4 py-3 font-medium">Exemption</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Assigned to</th>
                    <th className="px-4 py-3 font-medium">Submitted</th>
                    <th className="px-4 py-3 font-medium">Updated</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {loading ? (
                    <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-500">Loading cases...</td></tr>
                  ) : result.cases.length === 0 ? (
                    <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-500">No cases match these filters.</td></tr>
                  ) : (
                    result.cases.map((c) => (
                      <tr key={c.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3">
                          <p className="font-medium text-gray-900">{c.applicantName}</p>
                          <p className="text-xs text-gray-500">{c.applicantEmail}</p>
                        </td>
                        <td className="px-4 py-3 text-gray-700">{c.exemptionType || '—'}</td>
                        <td className="px-4 py-3"><StatusBadge status={c.status} /></td>
                        <td className="px-4 py-3 text-gray-700">{c.assignedTo || <span className="text-gray-400">Unassigned</span>}</td>
                        <td className="px-4 py-3 text-gray-700">{c.submittedAt ? new Date(c.submittedAt).toLocaleDateString() : '—'}</td>
                        <td className="px-4 py-3 text-gray-700">{new Date(c.updatedAt).toLocaleDateString()}</td>
                        <td className="px-4 py-3 text-right">
                          <Link to={`/cases/${c.id}`} className="text-blue-600 font-medium hover:underline">Open</Link>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
              <div className="flex justify-between items-center px-4 py-3 border-t border-gray-100 text-sm text-gray-600">
                <span>{result.total} case{result.total === 1 ? '' : 's'}</span>
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
