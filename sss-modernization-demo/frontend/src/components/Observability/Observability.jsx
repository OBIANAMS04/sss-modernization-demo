import { useCallback, useEffect, useState } from 'react';
import { getUser } from '../../utils/tokenManager';
import { getApiErrorMessage } from '../../utils/apiError';
import { isAdminUser } from '../../utils/roles';
import { observabilityService } from '../../services/observabilityService';
import AppNav from '../Common/AppNav';
import Chart from '../Dashboard/Chart';
import DashboardSection from '../Dashboard/DashboardSection';
import StatTile from '../Dashboard/StatTile';
import DemoEnvironmentBanner from '../DemoEnvironmentBanner';
import { formatTime } from '../Assistant/format';

// STORY-028 and 029: Observability, for administrators. Whether the service is healthy, how much it is asked and how often it fails, how fast it
// answers against the 2-second p95 target, what the AI costs against the daily budget, and the objectives with the alerts they opened.
// Every chart is also a table. Everything here is demonstrated on a synthetic deployment.

const REFRESH_MS = 60_000;
const th = 'px-2 py-2 font-medium sm:px-3';
const td = 'px-2 py-2 text-right tabular-nums text-gray-900 sm:px-3';
const tdText = 'px-2 py-2 text-gray-900 sm:px-3 wrap-anywhere';
const button = 'bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50';
const buttonQuiet = 'bg-white border border-gray-300 hover:bg-gray-50 text-gray-800 px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50';

const ms = (value) => (value === null || value === undefined ? '—' : value >= 1000 ? `${(value / 1000).toFixed(2)} s` : `${Math.round(value)} ms`);
const percent = (value, digits = 2) => (value === null || value === undefined ? '—' : `${(value * 100).toFixed(digits).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '')}%`);
const count = (value) => (value === null || value === undefined ? '—' : Number(value).toLocaleString());
const usd = (value) => (value === null || value === undefined ? '—' : `$${value < 0.1 && value > 0 ? value.toFixed(4) : value.toFixed(2)}`);
const hourLabel = (iso) => new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
const dayLabel = (iso) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
const shortRoute = (route) => route.replace('/api/', '/');

const STATUS = {
  ok: ['Within target', 'text-green-700'],
  breach: ['Breached', 'text-red-700 font-semibold'],
  'no-data': ['Not enough requests', 'text-gray-700'],
};

function Notice({ tone, children }) {
  const style = tone === 'bad' ? 'border-red-300 bg-red-50 text-red-800' : 'border-green-200 bg-green-50 text-green-800';
  return (
    <div role={tone === 'bad' ? 'alert' : 'status'} className={`mb-4 rounded-lg border p-4 text-sm wrap-anywhere ${style}`}>
      {children}
    </div>
  );
}

function Table({ caption, head, children }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <caption className="text-left text-sm font-medium text-gray-700 pb-2">{caption}</caption>
        <thead className="bg-gray-50 text-left text-gray-600">
          <tr>
            {head.map(([name, right]) => (
              <th key={name} scope="col" className={`${th} ${right ? 'text-right' : ''}`}>{name}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">{children}</tbody>
      </table>
    </div>
  );
}

function Alerts({ alerts, runbook }) {
  const title = (id) => runbook.find((e) => e.id === id)?.title ?? id;
  return (
    <DashboardSection
      title="Alerts"
      hint="An alert opens once when an objective is breached, is recorded in the audit log and sent to every administrator, and closes by itself when the objective recovers. Each links to what it means and what to check first."
    >
      {alerts.open.length === 0 ? (
        <Notice tone="good">No alert is open: every objective is within its target.</Notice>
      ) : (
        <ul className="mb-4 space-y-2">
          {alerts.open.map((a) => (
            <li key={a.id} role="alert" className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-800 wrap-anywhere">
              <p className="font-semibold">{title(a.runbook)}{a.kind === 'slo' ? ` (${a.key.split(':')[1] === '1h' ? 'last hour' : 'last 24 hours'})` : ''}</p>
              <p>{a.message}</p>
              <p className="mt-1">Opened {formatTime(a.openedAt)}. <a className="underline font-medium" href={`#runbook-${a.runbook}`}>Runbook: what to check first</a></p>
            </li>
          ))}
        </ul>
      )}
      {alerts.history.length > 0 && (
        <Table caption="Alert history: alerts that have closed in the last 30 days" head={[['What'], ['Opened'], ['Closed'], ['Runbook']]}>
          {alerts.history.map((a) => (
            <tr key={a.id}>
              <td className={tdText}>{a.message}</td>
              <td className={`${tdText} whitespace-nowrap`}>{formatTime(a.openedAt)}</td>
              <td className={`${tdText} whitespace-nowrap`}>{formatTime(a.clearedAt)}</td>
              <td className={tdText}><a className="text-blue-700 underline" href={`#runbook-${a.runbook}`}>{title(a.runbook)}</a></td>
            </tr>
          ))}
        </Table>
      )}
    </DashboardSection>
  );
}

function Health({ health }) {
  const up = health.uptimeSeconds;
  const uptime = up < 3600 ? `${Math.floor(up / 60)} min` : up < 172800 ? `${Math.floor(up / 3600)} h ${Math.floor((up % 3600) / 60)} min` : `${Math.floor(up / 86400)} days`;
  return (
    <DashboardSection title="Service health" hint="Read when this page was opened.">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatTile label="Status" value={health.status === 'ok' ? 'Healthy' : 'Degraded'} tone={health.status === 'ok' ? 'text-green-700' : 'text-red-700'} note={health.database.ok ? 'The service answers' : 'The database does not answer'} />
        <StatTile label="Database" value={health.database.ok ? 'Reachable' : 'Unreachable'} tone={health.database.ok ? 'text-green-700' : 'text-red-700'} note={health.database.latencyMs === null ? '' : `Answered in ${health.database.latencyMs} ms`} />
        <StatTile label="Migrations" value={`${health.migrations?.applied ?? '—'} applied`} note={health.migrations?.latest ?? ''} />
        <StatTile label="Release (commit)" value={health.commit} note={`Up since ${formatTime(health.startedAt)}`} />
        <StatTile label="Uptime since the last start" value={uptime} />
        <StatTile label="Memory (resident)" value={`${health.memoryRssMb} MB`} note="Limit on the free plan: 512 MB" />
        <StatTile label="Connection pool" value={`${health.pool.size - health.pool.idle} of ${health.pool.size} in use`} note={`${health.pool.waiting} waiting`} />
        <StatTile label="Traces and metrics leave the server" value={health.tracing.exportsTo === 'nowhere' ? 'No' : 'Yes'} note={health.tracing.exportsTo === 'nowhere' ? 'No OTLP endpoint is set' : 'To the OTLP endpoint that is set'} />
      </div>
    </DashboardSection>
  );
}

function Objectives({ objectives }) {
  const byId = (id, window) => objectives.traffic.find((r) => r.id === id && r.window === window);
  const cell = (id, window) => {
    const r = byId(id, window);
    if (!r) return <td className={tdText}>—</td>;
    const [words, tone] = STATUS[r.status];
    return (
      <td className={tdText}>
        <span className={tone}>{words}</span>
        <span className="block text-gray-700">{r.value}</span>
      </td>
    );
  };
  return (
    <DashboardSection title="Objectives" hint="Each is checked every minute over the last hour and the last 24 hours. With fewer than 20 requests in a window there is not enough to judge.">
      <Table caption="Service level objectives and where they stand now" head={[['Objective'], ['Target'], ['Last hour'], ['Last 24 hours']]}>
        {objectives.definitions.map((d) => {
          const quality = objectives.aiQuality.find((q) => q.id === d.id);
          return (
            <tr key={d.id}>
              <th scope="row" className="px-2 py-2 sm:px-3 text-left font-medium text-gray-900 align-top">{d.title}</th>
              <td className={`${tdText} align-top`}>{d.objective}</td>
              {quality ? (
                <td className={tdText} colSpan={2}>
                  <span className={quality.open ? 'text-red-700 font-semibold' : 'text-green-700'}>{quality.open ? `${quality.open} open alert${quality.open === 1 ? '' : 's'}` : 'No open alert'}</span>
                  <span className="block text-gray-700">Checked by the AI quality checks, every five minutes</span>
                </td>
              ) : (
                <>
                  {cell(d.id, '1h')}
                  {cell(d.id, '24h')}
                </>
              )}
            </tr>
          );
        })}
      </Table>
    </DashboardSection>
  );
}

function Rates({ traffic }) {
  const tile = (w, name) => (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
      <StatTile label={`Requests, ${name}`} value={count(w.requests)} note={`${count(w.errors4xx)} client errors (4xx)`} />
      <StatTile label={`Server errors, ${name}`} value={count(w.errors5xx)} note={`${percent(w.errorRate)} of requests`} tone={w.errors5xx > 0 ? 'text-red-700' : 'text-gray-900'} />
      <StatTile label={`Availability, ${name}`} value={percent(w.availability)} note="Target 99.5% or better" />
      <StatTile label={`Latency p95, ${name}`} value={ms(w.p95Ms)} note={`p50 ${ms(w.p50Ms)}, p99 ${ms(w.p99Ms)}`} />
    </div>
  );
  return (
    <DashboardSection title="Request and error rates" hint="Server errors are responses of 500 or more; client errors (400 to 499, such as a wrong password) are not failures of the service.">
      <div className="space-y-4">
        {tile(traffic.last24h, '24 hours')}
        {tile(traffic.last7d, '7 days')}
      </div>
      <div className="mt-6 grid grid-cols-1 xl:grid-cols-2 gap-8">
        <Chart
          type="line"
          label="Requests and server errors per hour, last 24 hours (UTC hours shown in your time zone)"
          categoryHeader="Hour"
          categoryTitle="Hour of the day"
          categories={traffic.hourly.map((p) => hourLabel(p.at))}
          series={[
            { name: 'Requests', values: traffic.hourly.map((p) => p.requests) },
            { name: 'Server errors', values: traffic.hourly.map((p) => p.errors5xx) },
          ]}
          extraColumns={[{ name: 'Client errors (4xx)', values: traffic.hourly.map((p) => p.errors4xx) }]}
          format={count}
        />
        <Chart
          type="line"
          label="Requests and server errors per day, last 7 days"
          categoryHeader="Day (UTC)"
          categoryTitle="Day"
          categories={traffic.daily.map((p) => dayLabel(p.at))}
          series={[
            { name: 'Requests', values: traffic.daily.map((p) => p.requests) },
            { name: 'Server errors', values: traffic.daily.map((p) => p.errors5xx) },
          ]}
          extraColumns={[{ name: 'Client errors (4xx)', values: traffic.daily.map((p) => p.errors4xx) }, { name: 'Latency p95', values: traffic.daily.map((p) => p.p95Ms), format: ms }]}
          format={count}
        />
      </div>
    </DashboardSection>
  );
}

function Latency({ latency }) {
  const routes = latency.routes.filter((r) => r.requests > 0);
  const top = routes.slice(0, 8);
  const over = routes.filter((r) => r.p95Ms !== null && r.p95Ms >= latency.targetMs).length;
  return (
    <DashboardSection title="Latency by route" hint={`The 95th percentile of request duration for each route over the last 24 hours, against the target of ${latency.targetMs / 1000} seconds. Routes are templates: a record's id is never part of a name.`}>
      {routes.length === 0 ? (
        <p className="text-sm text-gray-700">No requests in the last 24 hours.</p>
      ) : (
        <>
          <Notice tone={over ? 'bad' : 'good'}>
            {over ? `${over} route${over === 1 ? ' is' : 's are'} at or over the ${latency.targetMs / 1000}-second target.` : `Every route is under the ${latency.targetMs / 1000}-second target.`}
          </Notice>
          <Chart
            type="bar"
            label={`The ${top.length} slowest routes by p95 duration, in milliseconds, last 24 hours`}
            categoryHeader="Route"
            categories={top.map((r) => shortRoute(r.route))}
            series={[{ name: 'p95 (ms)', values: top.map((r) => Math.round(r.p95Ms ?? 0)), format: (v) => `${v} ms` }]}
            referenceLine={{ value: latency.targetMs, label: `${latency.targetMs / 1000}-second p95 target` }}
            format={(v) => `${v}`}
          />
          <div className="mt-6">
            <Table
              caption="Every route: requests, errors and duration percentiles, last 24 hours"
              head={[['Route'], ['Requests', true], ['4xx', true], ['5xx', true], ['p50', true], ['p95', true], ['p99', true], ['Against the target']]}
            >
              {routes.map((r) => (
                <tr key={r.route}>
                  <th scope="row" className="px-2 py-2 sm:px-3 text-left font-normal text-gray-900 wrap-anywhere">{r.route}</th>
                  <td className={td}>{count(r.requests)}</td>
                  <td className={td}>{count(r.errors4xx)}</td>
                  <td className={td}>{count(r.errors5xx)}</td>
                  <td className={td}>{ms(r.p50Ms)}</td>
                  <td className={td}>{ms(r.p95Ms)}</td>
                  <td className={td}>{ms(r.p99Ms)}</td>
                  <td className={`${tdText} ${r.p95Ms !== null && r.p95Ms >= latency.targetMs ? 'text-red-700 font-semibold' : 'text-green-700'}`}>
                    {r.p95Ms !== null && r.p95Ms >= latency.targetMs ? 'Over the target' : 'Under the target'}
                  </td>
                </tr>
              ))}
            </Table>
          </div>
        </>
      )}
    </DashboardSection>
  );
}

function Slowest({ latency }) {
  return (
    <DashboardSection title="Slowest routes" hint="The five routes with the highest p95 in the last 24 hours, with their average and longest request.">
      {latency.slowest.length === 0 ? (
        <p className="text-sm text-gray-700">No requests in the last 24 hours.</p>
      ) : (
        <Table caption="Slowest routes, last 24 hours" head={[['Route'], ['Requests', true], ['Average', true], ['p95', true], ['Longest', true]]}>
          {latency.slowest.map((r) => (
            <tr key={r.route}>
              <th scope="row" className="px-2 py-2 sm:px-3 text-left font-normal text-gray-900 wrap-anywhere">{r.route}</th>
              <td className={td}>{count(r.requests)}</td>
              <td className={td}>{ms(r.avgMs)}</td>
              <td className={td}>{ms(r.p95Ms)}</td>
              <td className={td}>{ms(r.maxMs)}</td>
            </tr>
          ))}
        </Table>
      )}
    </DashboardSection>
  );
}

function Database({ database }) {
  const d = database.last24h;
  return (
    <DashboardSection title="Database" hint="Query time and connection pool use over the last 24 hours. Queries made inside a transaction are traced but not timed here.">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
        <StatTile label="Queries" value={count(d.queries)} note={`${count(d.failed)} failed`} />
        <StatTile label="Average time" value={ms(d.avgMs)} />
        <StatTile label="p95 time" value={ms(d.p95Ms)} />
        <StatTile label="Longest" value={ms(d.maxMs)} />
        <StatTile label="Most connections in use" value={`${d.poolInUseMax} of ${d.poolSize}`} />
        <StatTile label="Most requests waiting" value={String(d.poolWaitingMax)} note="For a free connection" />
      </div>
    </DashboardSection>
  );
}

function RecentErrors({ errors }) {
  return (
    <DashboardSection title="Recent server errors" hint="Responses of 500 or more, newest first. The trace id finds the request's log lines (every line carries trace_id) and its trace. The record holds the class and code of the error, never its message.">
      {errors.length === 0 ? (
        <Notice tone="good">No server error has been recorded.</Notice>
      ) : (
        <Table caption="The 20 most recent server errors" head={[['When'], ['Route'], ['Status', true], ['Error'], ['Trace id']]}>
          {errors.map((e, i) => (
            <tr key={`${e.traceId}-${i}`}>
              <td className={`${tdText} whitespace-nowrap`}>{formatTime(e.at)}</td>
              <td className={tdText}>{e.route}</td>
              <td className={td}>{e.status}</td>
              <td className={tdText}>{[e.errorName, e.errorCode].filter(Boolean).join(' ') || '—'}</td>
              <td className={`${tdText} font-mono text-xs`}>{e.traceId ?? '—'}</td>
            </tr>
          ))}
        </Table>
      )}
    </DashboardSection>
  );
}

function AiUsage({ ai }) {
  const overBudget = ai.today.costUsd > ai.budgetUsd;
  return (
    <DashboardSection title="AI calls, tokens and cost per day" hint="Estimated from the list prices of the model (the provider's invoice is the source of truth). It covers questions to the assistant and evaluation and fairness runs. Days are UTC days.">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        <StatTile label="Calls today" value={count(ai.today.calls)} />
        <StatTile label="Tokens today" value={count(ai.today.inputTokens + ai.today.outputTokens)} note={`${count(ai.today.cacheReadTokens)} read from the cache`} />
        <StatTile label="Estimated cost today" value={usd(ai.today.costUsd)} tone={overBudget ? 'text-red-700' : 'text-gray-900'} />
        <StatTile label="Daily budget" value={usd(ai.budgetUsd)} note={overBudget ? 'Over the budget today' : 'Under the budget today'} />
      </div>
      <Chart
        type="line"
        label="Estimated AI cost per day, last 7 days, against the daily budget"
        categoryHeader="Day (UTC)"
        categoryTitle="Day"
        categories={ai.days.map((d) => dayLabel(`${d.day}T00:00:00Z`))}
        series={[{ name: 'Estimated cost', values: ai.days.map((d) => d.costUsd), format: usd }]}
        extraColumns={[
          { name: 'Calls', values: ai.days.map((d) => d.calls), format: count },
          { name: 'Input tokens', values: ai.days.map((d) => d.inputTokens), format: count },
          { name: 'Output tokens', values: ai.days.map((d) => d.outputTokens), format: count },
          { name: 'Cache read tokens', values: ai.days.map((d) => d.cacheReadTokens), format: count },
          { name: 'Cache write tokens', values: ai.days.map((d) => d.cacheCreationTokens), format: count },
          { name: 'Against the budget', values: ai.days.map((d) => (ai.budgetUsd > 0 ? d.costUsd / ai.budgetUsd : null)), format: (v) => percent(v, 0) },
        ]}
        referenceLine={{ value: ai.budgetUsd, label: `Daily budget ${usd(ai.budgetUsd)}` }}
        axisMinStep={0.01}
        format={usd}
      />
    </DashboardSection>
  );
}

function Runbook({ runbook }) {
  return (
    <DashboardSection title="Runbook" hint="One entry per alert: what it means, what to check first, and how to close it. The same entries are in docs/RUNBOOK-ALERTS.md in the repository.">
      <div className="space-y-4">
        {runbook.map((e) => (
          <article key={e.id} id={`runbook-${e.id}`} tabIndex={-1} className="rounded-lg border border-gray-200 p-4 focus:outline-none target:ring-2 target:ring-blue-600">
            <h3 className="text-base font-bold text-gray-900">{e.title}</h3>
            <p className="mt-1 text-sm text-gray-800"><span className="font-semibold">What it means.</span> {e.meaning}</p>
            <p className="mt-2 text-sm font-semibold text-gray-800">First checks</p>
            <ol className="list-decimal ml-6 text-sm text-gray-800 space-y-1">
              {e.firstChecks.map((c) => <li key={c}>{c}</li>)}
            </ol>
            <p className="mt-2 text-sm text-gray-800"><span className="font-semibold">How to close it.</span> {e.close}</p>
          </article>
        ))}
      </div>
    </DashboardSection>
  );
}

export default function Observability() {
  const admin = isAdminUser(getUser());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(admin);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    () =>
      observabilityService
        .overview()
        .then((view) => {
          setData(view);
          setError('');
        })
        .catch((err) => setError(getApiErrorMessage(err, 'Could not load the observability data.')))
        .finally(() => setLoading(false)),
    []
  );

  useEffect(() => {
    if (!admin) return undefined;
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => clearInterval(timer);
  }, [admin, load]);

  const checkNow = async () => {
    setBusy(true);
    setNotice('');
    setError('');
    try {
      const result = await observabilityService.evaluate();
      const parts = [];
      if (result.opened.length) parts.push(`${result.opened.length} alert${result.opened.length === 1 ? '' : 's'} opened`);
      if (result.cleared.length) parts.push(`${result.cleared.length} closed`);
      setNotice(parts.length ? `Objectives checked: ${parts.join(', ')}.` : 'Objectives checked: nothing changed.');
      await load();
    } catch (err) {
      setError(getApiErrorMessage(err, 'The objectives could not be checked.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <AppNav title="Observability" subtitle="Health, traffic, latency, AI cost, objectives and alerts" />
      <main id="main" tabIndex={-1} className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8 focus:outline-none">
        <DemoEnvironmentBanner />
        {!admin ? (
          <div className="bg-white rounded-lg shadow-md p-6 text-gray-700">Observability is available to administrators only.</div>
        ) : (
          <>
            {error && <Notice tone="bad">{error}</Notice>}
            {notice && <Notice tone="good">{notice}</Notice>}
            {loading ? (
              <div role="status" className="text-center py-12">
                <div className="inline-block animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600" aria-hidden="true"></div>
                <p className="mt-4 text-gray-600">Loading observability...</p>
              </div>
            ) : (
              data && (
                <div className="space-y-6">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="max-w-3xl text-gray-700">
                      How the service is doing, measured by the service itself and kept in its own database for 30 days. The page refreshes every minute; it was read at {formatTime(data.generatedAt)}.
                    </p>
                    <div className="flex gap-2">
                      <button type="button" onClick={() => load()} className={buttonQuiet}>Refresh</button>
                      <button type="button" onClick={checkNow} disabled={busy} className={button}>{busy ? 'Checking...' : 'Check objectives now'}</button>
                    </div>
                  </div>
                  <Alerts alerts={data.alerts} runbook={data.runbook} />
                  <Health health={data.health} />
                  <Objectives objectives={data.objectives} />
                  <Rates traffic={data.traffic} />
                  <Latency latency={data.latency} />
                  <Slowest latency={data.latency} />
                  <Database database={data.database} />
                  <RecentErrors errors={data.recentErrors} />
                  <AiUsage ai={data.ai} />
                  <Runbook runbook={data.runbook} />
                </div>
              )
            )}
          </>
        )}
      </main>
    </div>
  );
}
