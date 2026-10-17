import Chart from './Chart';
import DashboardSection from './DashboardSection';
import StatTile from './StatTile';

const percent = (value) => `${value}%`;
const percentOrDash = (value) => (value === null ? '—' : percent(value));
// A week is named by its Monday, in the same calendar the server counted it in
const weekLabel = (weekStart) => new Date(`${weekStart}T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });

/**
 * STORY-024: how often staff went against the system (a corrected or declined assistant answer, an accepted compliance exception, a
 * decision against the automatic eligibility result), over the last 30 days against a target below 20%, with its weekly trend and where
 * it comes from. `report` is the overrideRate of the admin and leadership dashboards. It holds counts and rates only.
 */
export default function OverrideRateSection({ report }) {
  const { target, windowDays, rate, reviewed, overrides, alert, alertMessage, bySource, weeks } = report;
  return (
    <DashboardSection
      title="Override rate"
      hint={`How often staff went against what the system said, in the last ${windowDays} days: the items they overrode divided by the items they reviewed. The target is below ${target}%.`}
    >
      {alert ? (
        <div role="alert" className="mb-4 rounded-lg border border-red-300 bg-red-50 p-4 text-red-800">
          <p className="font-semibold">At or above the target</p>
          <p className="text-sm wrap-anywhere">{alertMessage}</p>
        </div>
      ) : rate === null ? (
        <p className="mb-4 text-sm text-gray-700">Nothing has been reviewed in the last {windowDays} days yet, so there is no override rate.</p>
      ) : (
        <div role="status" className="mb-4 rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-800">
          On target: {rate}% of the items reviewed in the last {windowDays} days were overridden, below the {target}% target.
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatTile
          label={`Override rate, last ${windowDays} days`}
          value={percentOrDash(rate)}
          tone={alert ? 'text-red-700' : rate === null ? 'text-gray-900' : 'text-green-700'}
          note={`Target below ${target}%`}
        />
        <StatTile label="Items reviewed" value={reviewed} note={`In the last ${windowDays} days`} />
        <StatTile label="Overrides" value={overrides} note="Items where staff went against the system" />
      </div>

      <div className="mt-6">
        <h3 className="text-lg font-semibold text-gray-900">Weekly trend</h3>
        <p className="mb-3 text-sm text-gray-600">The last 12 weeks, each starting on a Monday. A week in which nothing was reviewed has no point.</p>
        <Chart
          type="line"
          label="Override rate per week, last 12 weeks"
          categoryHeader="Week starting"
          categoryTitle="Week starting (Monday)"
          categories={weeks.map((w) => weekLabel(w.weekStart))}
          series={[{ name: 'Override rate', values: weeks.map((w) => w.rate), format: percent }]}
          extraColumns={[
            { name: 'Items reviewed', values: weeks.map((w) => w.reviewed) },
            { name: 'Overrides', values: weeks.map((w) => w.overrides) },
          ]}
          referenceLine={{ value: target, label: `Target: below ${target}%` }}
        />
      </div>

      <div className="mt-8">
        <h3 className="text-lg font-semibold text-gray-900">By source</h3>
        <p className="mb-3 text-sm text-gray-600">The last {windowDays} days, split by what was reviewed.</p>
        <Chart
          label={`Override rate by source, last ${windowDays} days`}
          categoryHeader="Source"
          categories={bySource.map((s) => s.label)}
          series={[{ name: 'Override rate', values: bySource.map((s) => s.rate), format: percent }]}
          extraColumns={[
            { name: 'Items reviewed', values: bySource.map((s) => s.reviewed) },
            { name: 'Overrides', values: bySource.map((s) => s.overrides) },
          ]}
          maxValue={100}
        />
        <dl className="mt-4 space-y-2 text-sm">
          {bySource.map((s) => (
            <div key={s.source}>
              <dt className="font-medium text-gray-900">{s.label}</dt>
              <dd className="text-gray-700">{s.description}</dd>
            </div>
          ))}
        </dl>
      </div>
    </DashboardSection>
  );
}
