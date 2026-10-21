import { useEffect, useState } from 'react';
import { dataService } from '../../services/dataService';

// STORY-005: how current the data on this page is. Every page reads straight from the database, so this says when the person's own
// records last changed and how quickly changes have been becoming visible across the service in the last hour, in words as well as
// colour (green under 10 s, yellow 10 to 20 s, red over 20 s). It refreshes itself every 30 seconds.
const REFRESH_MS = 30_000;

const LEVELS = {
  green: { label: 'Current', tone: 'border-green-300 bg-green-50 text-green-900', dot: 'bg-green-700' },
  yellow: { label: 'Slightly delayed', tone: 'border-amber-400 bg-amber-50 text-amber-900', dot: 'bg-amber-600' },
  red: { label: 'Delayed', tone: 'border-red-300 bg-red-50 text-red-900', dot: 'bg-red-700' },
  unknown: { label: 'Not measured yet', tone: 'border-gray-300 bg-gray-50 text-gray-800', dot: 'bg-gray-500' },
};

const seconds = (ms) => (ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`);

function ago(ms) {
  if (ms === null) return null;
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return 'less than a minute ago';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  return `${Math.round(hours / 24)} days ago`;
}

export default function DataFreshnessCard({ className = '' }) {
  const [status, setStatus] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const next = await dataService.pipelineStatus();
        if (alive) {
          setStatus(next);
          setFailed(false);
        }
      } catch {
        if (alive) setFailed(true);
      }
    };
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  const level = LEVELS[status?.freshness?.level] ?? LEVELS.unknown;
  const f = status?.freshness;
  return (
    <section className={`bg-white rounded-lg shadow-md p-6 ${className}`} aria-labelledby="data-freshness-h">
      <h2 id="data-freshness-h" className="text-lg font-bold text-gray-900 mb-3">How current this page is</h2>
      {failed && !status ? (
        <p className="text-sm text-gray-700">The data status could not be read just now; it will try again shortly.</p>
      ) : !status ? (
        <p className="text-sm text-gray-700">Checking…</p>
      ) : (
        <div className="space-y-2 text-sm">
          <p className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 font-semibold ${level.tone}`}>
            <span aria-hidden="true" className={`inline-block h-2.5 w-2.5 rounded-full ${level.dot}`} />
            {level.label}
          </p>
          <p className="text-gray-800">
            This page reads your records directly, with no copy in between.
            {status.lastChange ? ` Your records last changed ${ago(status.dataAgeMs)}.` : ''}
          </p>
          <p className="text-gray-700">
            {f.p95Ms === null
              ? `No changes were measured across the service in the last ${f.windowMinutes} minutes.`
              : `Across the service in the last ${f.windowMinutes} minutes, 95% of changes could be read within ${seconds(f.p95Ms)} (${f.measured} measured; the target is ${seconds(f.targetMs)}).`}
          </p>
        </div>
      )}
    </section>
  );
}
