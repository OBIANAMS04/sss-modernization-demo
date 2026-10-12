import { useState, useEffect, useCallback } from 'react';
import { getUser } from '../../utils/tokenManager';
import { getApiErrorMessage } from '../../utils/apiError';
import { isStaffUser } from '../../utils/roles';
import { freshnessService } from '../../services/freshnessService';
import AppNav from '../Common/AppNav';
import DemoEnvironmentBanner from '../DemoEnvironmentBanner';

const WINDOWS = [
  { hours: 24, label: 'Last 24 hours' },
  { hours: 168, label: 'Last 7 days' },
  { hours: 720, label: 'Last 30 days' },
];

const OPERATIONS = {
  update: 'Profile saved',
  profile_update: 'Re-check after profile change',
  check: 'Eligibility check',
  create: 'New application',
  status_change: 'Status change',
  assign: 'Assignment',
  write_then_read: 'Write, then read back',
};

const STATUS = {
  none: { text: 'No updates yet', style: 'bg-gray-100 text-gray-600' },
  ok: { text: 'Within target', style: 'bg-green-100 text-green-800' },
  over: { text: 'Over target', style: 'bg-red-100 text-red-800' },
};

function formatMs(ms) {
  if (ms === null || ms === undefined) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const seconds = ms / 1000;
  return `${Number.isInteger(seconds) ? seconds : seconds.toFixed(1)} s`;
}

function ago(at) {
  if (!at) return 'No updates yet';
  const s = Math.max(0, Math.round((Date.now() - new Date(at).getTime()) / 1000));
  if (s < 60) return `${s} s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
}

function Stat({ label, value, note, tone = 'text-gray-900' }) {
  return (
    <div className="bg-white rounded-lg shadow p-4">
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`text-2xl font-bold tabular-nums ${tone}`}>{value}</p>
      {note && <p className="text-xs text-gray-500 mt-1">{note}</p>}
    </div>
  );
}

export default function FreshnessDashboard() {
  const staff = isStaffUser(getUser());
  const [hours, setHours] = useState(24);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [probe, setProbe] = useState(null);
  const [probing, setProbing] = useState(false);

  const load = useCallback(
    () =>
      freshnessService
        .dashboard(hours)
        .then((d) => {
          setData(d);
          setError('');
        })
        .catch((err) => setError(getApiErrorMessage(err, 'Could not load data freshness.'))),
    [hours]
  );

  useEffect(() => {
    if (staff) load();
  }, [load, staff]);

  const checkNow = async () => {
    setProbing(true);
    try {
      const started = performance.now();
      const result = await freshnessService.probe();
      setProbe({ ...result, roundTripMs: Math.round(performance.now() - started) });
      await load();
    } catch (err) {
      setError(getApiErrorMessage(err, 'The end-to-end check failed.'));
    } finally {
      setProbing(false);
    }
  };

  const overall = data?.overall;
  const onTarget = data && overall.count > 0 && !data.alert;

  return (
    <div className="min-h-screen bg-gray-50">
      <AppNav title="Data Freshness" subtitle="How long until each change is readable by the next request" />

      <main id="main" tabIndex={-1} className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8 focus:outline-none">
        <DemoEnvironmentBanner />

        {!staff ? (
          <div className="bg-white rounded-lg shadow-md p-6 text-gray-700">Data freshness is available to case managers only.</div>
        ) : (
          <>
            {error && <div role="alert" className="mb-4 p-4 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">{error}</div>}

            <div className="flex flex-wrap justify-between items-center gap-3 mb-4">
              <div className="flex gap-2" role="group" aria-label="Time window">
                {WINDOWS.map((w) => (
                  <button
                    key={w.hours}
                    onClick={() => setHours(w.hours)}
                    aria-pressed={hours === w.hours}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium border ${
                      hours === w.hours ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    {w.label}
                  </button>
                ))}
              </div>
              <button
                onClick={checkNow}
                disabled={probing}
                className="bg-gray-800 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-900 disabled:opacity-50"
              >
                {probing ? 'Checking...' : 'Check now'}
              </button>
            </div>

            {probe && (
              <div className="mb-4 p-4 bg-blue-50 border border-blue-200 text-blue-900 rounded-lg text-sm" role="status">
                <p className="font-semibold">End-to-end check</p>
                <p>
                  A new record was readable {formatMs(probe.totalMs)} after the write started on the server ({formatMs(probe.writeMs)} to
                  write, {formatMs(probe.visibleMs)} until a separate read saw it). Round trip from this browser:{' '}
                  {formatMs(probe.roundTripMs)}, so about {formatMs(Math.max(0, probe.roundTripMs - probe.totalMs))} was network and request
                  handling.
                </p>
              </div>
            )}

            {data && (
              <>
                {data.alert ? (
                  <div className="mb-6 p-4 bg-red-50 border border-red-300 text-red-800 rounded-lg" role="alert">
                    <p className="font-semibold">Over the freshness target</p>
                    <p className="text-sm">{data.alert}</p>
                  </div>
                ) : onTarget ? (
                  <div role="status" className="mb-6 p-4 bg-green-50 border border-green-200 text-green-800 rounded-lg text-sm">
                    Within target: {overall.withinRate}% of {overall.count} updates were readable within {formatMs(data.targetMs)} (target{' '}
                    {data.sloPercent}%). p95 {formatMs(overall.p95Ms)}.
                  </div>
                ) : (
                  <div className="mb-6 p-4 bg-gray-50 border border-gray-200 text-gray-700 rounded-lg text-sm">
                    No updates measured in this window yet.
                  </div>
                )}

                <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
                  <Stat label="Updates measured" value={overall.count} />
                  <Stat label="p50" value={formatMs(overall.p50Ms)} />
                  <Stat
                    label="p95"
                    value={formatMs(overall.p95Ms)}
                    note={`Target ${formatMs(data.targetMs)}`}
                    tone={overall.p95Ms > data.targetMs ? 'text-red-700' : 'text-gray-900'}
                  />
                  <Stat label="p99" value={formatMs(overall.p99Ms)} />
                  <Stat
                    label={`Readable within ${formatMs(data.targetMs)}`}
                    value={overall.withinRate === null ? '—' : `${overall.withinRate}%`}
                    note={`Target ${data.sloPercent}%`}
                    tone={
                      overall.withinRate === null ? 'text-gray-900' : overall.withinRate < data.sloPercent ? 'text-red-700' : 'text-green-700'
                    }
                  />
                </div>

                <section className="bg-white rounded-lg shadow-md overflow-x-auto mb-6">
                  <div className="p-6 pb-2">
                    <h2 className="text-lg font-bold text-gray-900">By data type</h2>
                    <p className="text-sm text-gray-500">Each change is timed from the start of the write until a separate read sees it.</p>
                  </div>
                  <table className="min-w-full text-sm">
                    <thead className="bg-gray-50 text-left text-gray-600">
                      <tr>
                        <th className="px-4 py-3 font-medium">Data type</th>
                        <th className="px-4 py-3 font-medium">Last update</th>
                        <th className="px-4 py-3 font-medium text-right">Updates</th>
                        <th className="px-4 py-3 font-medium text-right">p50</th>
                        <th className="px-4 py-3 font-medium text-right">p95</th>
                        <th className="px-4 py-3 font-medium text-right">p99</th>
                        <th className="px-4 py-3 font-medium text-right">Within {formatMs(data.targetMs)}</th>
                        <th className="px-4 py-3 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {data.types.map((t) => (
                        <tr key={t.type}>
                          <td className="px-4 py-3 font-medium text-gray-900">{t.label}</td>
                          <td className="px-4 py-3 text-gray-700">
                            {ago(t.lastAt)}
                            {t.lastMs !== null && <span className="block text-xs text-gray-500">took {formatMs(t.lastMs)}</span>}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums">{t.count}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{formatMs(t.p50Ms)}</td>
                          <td className={`px-4 py-3 text-right tabular-nums ${t.status === 'over' ? 'text-red-700 font-semibold' : ''}`}>{formatMs(t.p95Ms)}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{formatMs(t.p99Ms)}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{t.withinRate === null ? '—' : `${t.withinRate}%`}</td>
                          <td className="px-4 py-3">
                            <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${STATUS[t.status].style}`}>{STATUS[t.status].text}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>

                <section className="bg-white rounded-lg shadow-md overflow-x-auto mb-6">
                  <div className="p-6 pb-2">
                    <h2 className="text-lg font-bold text-gray-900">Slowest updates</h2>
                    <p className="text-sm text-gray-500">Where the time went: the write itself, or the wait until the change was readable.</p>
                  </div>
                  <table className="min-w-full text-sm">
                    <thead className="bg-gray-50 text-left text-gray-600">
                      <tr>
                        <th className="px-4 py-3 font-medium">When</th>
                        <th className="px-4 py-3 font-medium">Data type</th>
                        <th className="px-4 py-3 font-medium">Change</th>
                        <th className="px-4 py-3 font-medium text-right">Write</th>
                        <th className="px-4 py-3 font-medium text-right">Until readable</th>
                        <th className="px-4 py-3 font-medium text-right">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {data.slowest.length === 0 ? (
                        <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-500">No updates in this window.</td></tr>
                      ) : (
                        data.slowest.map((s, i) => (
                          <tr key={`${s.at}-${i}`}>
                            <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{new Date(s.at).toLocaleString()}</td>
                            <td className="px-4 py-3 text-gray-900">{s.label}</td>
                            <td className="px-4 py-3 text-gray-700">{OPERATIONS[s.operation] || s.operation}</td>
                            <td className="px-4 py-3 text-right tabular-nums">{formatMs(s.writeMs)}</td>
                            <td className="px-4 py-3 text-right tabular-nums">{s.visible ? formatMs(s.visibleMs) : 'Never seen'}</td>
                            <td className={`px-4 py-3 text-right tabular-nums ${s.totalMs > data.targetMs || !s.visible ? 'text-red-700 font-semibold' : ''}`}>
                              {formatMs(s.totalMs)}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </section>

                <p className="text-xs text-gray-500 max-w-3xl">
                  Measured on the demo deployment. It reads straight from its database, with no cache or read replica yet, so a change is
                  readable as soon as it is written; the same check will measure cache and replica lag once they exist. CloudWatch metrics
                  come with the AWS environment (STORY-004).
                </p>
              </>
            )}
          </>
        )}
      </main>
    </div>
  );
}
