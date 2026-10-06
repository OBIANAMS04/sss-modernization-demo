import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { getUser } from '../../utils/tokenManager';
import { getApiErrorMessage } from '../../utils/apiError';
import { isStaffUser } from '../../utils/roles';
import { complianceService } from '../../services/complianceService';
import AppNav from '../Common/AppNav';
import DemoEnvironmentBanner from '../DemoEnvironmentBanner';

const WINDOWS = [7, 30, 90];

function Stat({ label, value, note, tone = 'text-gray-900' }) {
  return (
    <div className="bg-white rounded-lg shadow p-4">
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`text-2xl font-bold ${tone}`}>{value}</p>
      {note && <p className="text-xs text-gray-500 mt-1">{note}</p>}
    </div>
  );
}

export default function ComplianceDashboard() {
  const staff = isStaffUser(getUser());
  const [days, setDays] = useState(30);
  const [data, setData] = useState(null);
  const [reviews, setReviews] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!staff) return;
    Promise.all([complianceService.dashboard(days), complianceService.reviews('Open')])
      .then(([dashboard, open]) => {
        setData(dashboard);
        setReviews(open);
        setError('');
      })
      .catch((err) => setError(getApiErrorMessage(err, 'Could not load the compliance dashboard.')));
  }, [days, staff]);

  const controlName = (id) => data?.controls.find((c) => c.id === id)?.requirement || id;
  const onTarget = data && data.complianceRate !== null && !data.alert;

  return (
    <div className="min-h-screen bg-gray-50">
      <AppNav title="Compliance" subtitle="Every exemption decision checked against the decision controls" />

      <main className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
        <DemoEnvironmentBanner />

        {!staff ? (
          <div className="bg-white rounded-lg shadow-md p-6 text-gray-700">
            The compliance dashboard is available to case managers only.
          </div>
        ) : (
          <>
            {error && <div className="mb-4 p-4 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">{error}</div>}

            <div className="flex flex-wrap justify-between items-center gap-3 mb-4">
              <div className="flex gap-2" role="group" aria-label="Time window">
                {WINDOWS.map((w) => (
                  <button
                    key={w}
                    onClick={() => setDays(w)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium border ${
                      days === w ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    Last {w} days
                  </button>
                ))}
              </div>
              <Link to="/compliance/audit" className="text-blue-600 font-medium hover:underline text-sm">
                Open the compliance audit log →
              </Link>
            </div>

            {data && (
              <>
                {data.alert ? (
                  <div className="mb-6 p-4 bg-red-50 border border-red-300 text-red-800 rounded-lg" role="alert">
                    <p className="font-semibold">Below target</p>
                    <p className="text-sm">
                      {data.alert}{' '}
                      {data.openReviews
                        ? 'Decisions still waiting for a second case manager are listed under Open reviews.'
                        : 'Every failed decision has been reviewed. They still count here, so the record stays complete.'}
                    </p>
                  </div>
                ) : onTarget ? (
                  <div className="mb-6 p-4 bg-green-50 border border-green-200 text-green-800 rounded-lg text-sm">
                    On target: every decision in the last {data.windowDays} days met the {data.target}% compliance target.
                  </div>
                ) : (
                  <div className="mb-6 p-4 bg-gray-50 border border-gray-200 text-gray-700 rounded-lg text-sm">
                    No exemption decisions in the last {data.windowDays} days yet.
                  </div>
                )}

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                  <Stat label={`Decisions (last ${data.windowDays} days)`} value={data.totalDecisions} />
                  <Stat label="Passed every control" value={data.compliantDecisions} />
                  <Stat
                    label="Compliance rate"
                    value={data.complianceRate === null ? '—' : `${data.complianceRate}%`}
                    note={`Target ${data.target}%`}
                    tone={data.alert ? 'text-red-700' : onTarget ? 'text-green-700' : 'text-gray-900'}
                  />
                  <Stat label="Open reviews" value={data.openReviews} tone={data.openReviews ? 'text-red-700' : 'text-gray-900'} />
                </div>

                <section className="bg-white rounded-lg shadow-md p-6 mb-6">
                  <h2 className="text-lg font-bold text-gray-900 mb-1">Open reviews</h2>
                  <p className="text-sm text-gray-500 mb-4">
                    Decisions that failed a control. A different case manager resolves each one from the case page.
                  </p>
                  {reviews.length === 0 ? (
                    <p className="text-sm text-gray-600">No open reviews.</p>
                  ) : (
                    <ul className="divide-y divide-gray-100">
                      {reviews.map((r) => (
                        <li key={r.id} className="py-3 flex flex-wrap justify-between gap-3">
                          <div className="min-w-0">
                            <p className="font-medium text-gray-900 text-sm">
                              {r.applicantName} · {r.exemptionType || 'Exemption'} · {r.decision || 'Decision'} by {r.decidedBy || 'unknown'}
                            </p>
                            <p className="text-sm text-red-700">
                              Failed: {r.failedControls.map((id) => `${id} ${controlName(id)}`).join('; ')}
                            </p>
                            <p className="text-xs text-gray-500">Opened {new Date(r.openedAt).toLocaleString()}</p>
                          </div>
                          <Link to={`/cases/${r.caseId}`} className="text-blue-600 text-sm font-medium hover:underline self-center">
                            Review on case →
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                <section className="bg-white rounded-lg shadow-md overflow-x-auto mb-6">
                  <div className="p-6 pb-2">
                    <h2 className="text-lg font-bold text-gray-900">Decision controls</h2>
                    <p className="text-sm text-gray-500">Checked automatically whenever a case manager approves or denies a case.</p>
                  </div>
                  <table className="min-w-full text-sm">
                    <thead className="bg-gray-50 text-left text-gray-600">
                      <tr>
                        <th className="px-4 py-3 font-medium">Control</th>
                        <th className="px-4 py-3 font-medium">Requirement and reference</th>
                        <th className="px-4 py-3 font-medium">Applies to</th>
                        <th className="px-4 py-3 font-medium text-right">Checked</th>
                        <th className="px-4 py-3 font-medium text-right">Failed</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {data.controls.map((c) => (
                        <tr key={c.id}>
                          <td className="px-4 py-3 align-top">
                            <p className="font-mono text-xs text-gray-500">{c.id}</p>
                            <p className="text-gray-900">{c.control}</p>
                          </td>
                          <td className="px-4 py-3 align-top">
                            <p className="text-gray-900">{c.requirement}</p>
                            <p className="text-xs text-gray-500">{c.reference}</p>
                          </td>
                          <td className="px-4 py-3 align-top text-gray-700">{c.appliesTo.join(', ')}</td>
                          <td className="px-4 py-3 align-top text-right tabular-nums">{c.checks}</td>
                          <td className="px-4 py-3 align-top text-right">
                            <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium tabular-nums ${c.failures ? 'bg-red-100 text-red-800' : 'bg-gray-100 text-gray-600'}`}>
                              {c.failures}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>

                <section className="bg-white rounded-lg shadow-md p-6">
                  <h2 className="text-lg font-bold text-gray-900 mb-4">Decisions by day</h2>
                  {data.daily.length === 0 ? (
                    <p className="text-sm text-gray-600">No decisions in this window.</p>
                  ) : (
                    <ul className="space-y-2">
                      {data.daily.map((d) => {
                        const pct = d.decisions ? Math.round((d.compliant / d.decisions) * 100) : 0;
                        return (
                          <li key={d.day} className="grid grid-cols-[96px_1fr_auto] items-center gap-3 text-sm">
                            <span className="font-mono text-gray-600">{d.day}</span>
                            <span className="h-3 rounded-full bg-red-100 overflow-hidden" aria-hidden="true">
                              <span className="block h-full bg-green-500" style={{ width: `${pct}%` }} />
                            </span>
                            <span className="tabular-nums text-gray-700">
                              {d.compliant}/{d.decisions} compliant
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </section>
              </>
            )}
          </>
        )}
      </main>
    </div>
  );
}
