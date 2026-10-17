import { useState, useEffect } from 'react';
import { getUser } from '../../utils/tokenManager';
import { getApiErrorMessage } from '../../utils/apiError';
import { isLeadershipUser } from '../../utils/roles';
import { dashboardService } from '../../services/dashboardService';
import useInbox from '../../hooks/useInbox';
import AppNav from '../Common/AppNav';
import DemoEnvironmentBanner from '../DemoEnvironmentBanner';
import Chart from './Chart';
import DashboardSection from './DashboardSection';
import NotificationsCard from './NotificationsCard';
import OverrideRateSection from './OverrideRateSection';
import StatTile from './StatTile';

const percentOrDash = (value) => (value === null ? '—' : `${value}%`);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// A week is named by its Monday, in the same calendar the server counted it in
const weekLabel = (weekStart) => new Date(`${weekStart}T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });

// STORY-015: directors see how the program is doing, and never an individual. The page only ever receives aggregates.
export default function LeadershipDashboard() {
  const allowed = isLeadershipUser(getUser());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(allowed);
  const [error, setError] = useState('');
  const { inbox, markAllRead, notice, error: inboxError } = useInbox(allowed);

  useEffect(() => {
    if (!allowed) return;
    dashboardService
      .leadership()
      .then(setData)
      .catch((err) => setError(getApiErrorMessage(err, 'Could not load the leadership dashboard.')))
      .finally(() => setLoading(false));
  }, [allowed]);

  return (
    <div className="min-h-screen bg-gray-50">
      <AppNav title="Leadership Dashboard" subtitle="How the program is doing: totals, trends and bottlenecks" />

      <main id="main" tabIndex={-1} className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8 focus:outline-none">
        <DemoEnvironmentBanner />

        {!allowed ? (
          <div className="bg-white rounded-lg shadow-md p-6 text-gray-700">
            The leadership dashboard is available to leadership and administrators only. If you were just given access, log out and log back in.
          </div>
        ) : (
          <>
            {(error || inboxError) && <div role="alert" className="mb-4 p-4 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm wrap-anywhere">{error || inboxError}</div>}
            {notice && <div role="status" className="mb-4 p-4 bg-green-50 border border-green-200 text-green-800 rounded-lg text-sm">{notice}</div>}

            {loading ? (
              <div role="status" className="text-center py-12">
                <div className="inline-block animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600" aria-hidden="true"></div>
                <p className="mt-4 text-gray-600">Loading the leadership dashboard...</p>
              </div>
            ) : (
              data && (
                <>
                  <p className="mb-6 text-gray-700">
                    Counts, rates and averages across all applications. This page never shows an applicant&apos;s name, email or any other personal data.
                  </p>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
                    <StatTile label="Total applications" value={data.kpis.totalApplications} />
                    <StatTile
                      label="Approval rate"
                      value={percentOrDash(data.kpis.approvalRate)}
                      note={data.kpis.decided ? `${data.kpis.approved} approved of ${data.kpis.decided} decided` : 'No case is decided yet'}
                    />
                    <StatTile
                      label="Average processing time"
                      value={data.kpis.averageProcessingDays === null ? '—' : plural(data.kpis.averageProcessingDays, 'day')}
                      note={data.kpis.averageProcessingDays === null ? 'No case is decided yet' : 'From submission to decision'}
                    />
                    <StatTile label="Open cases" value={data.kpis.openCases} note="Not yet approved or denied" />
                    <StatTile
                      label="Appeal rate"
                      value={percentOrDash(data.kpis.appealRate)}
                      note={data.kpis.denied ? `${data.kpis.appealed} appealed of ${data.kpis.denied} denied` : 'No case was denied yet'}
                    />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-start">
                    <div className="md:col-span-2 space-y-6">
                      <DashboardSection title="Applications and decisions per week" hint="The last 12 weeks, each starting on a Monday. A decision is an approval or a denial.">
                        <Chart
                          type="line"
                          label="Applications and decisions per week, last 12 weeks"
                          categoryHeader="Week starting"
                          categoryTitle="Week starting (Monday)"
                          categories={data.trends.weeks.map((w) => weekLabel(w.weekStart))}
                          series={[
                            { name: 'Applications', values: data.trends.weeks.map((w) => w.applications) },
                            { name: 'Decisions', values: data.trends.weeks.map((w) => w.decisions) },
                          ]}
                        />
                      </DashboardSection>

                      <DashboardSection
                        title="Bottlenecks"
                        hint={`How long cases spend in each stage, from the case timelines, and how many are in a stage right now for more than ${data.bottlenecks.stuckDays} days.`}
                      >
                        <Chart
                          label="Average days spent in each stage"
                          categoryHeader="Stage"
                          categories={data.bottlenecks.stages.map((s) => s.label)}
                          series={[{ name: 'Average days', values: data.bottlenecks.stages.map((s) => s.averageDays) }]}
                          extraColumns={[
                            { name: 'Times measured', values: data.bottlenecks.stages.map((s) => s.measured) },
                            { name: `Stuck now (over ${data.bottlenecks.stuckDays} days)`, values: data.bottlenecks.stages.map((s) => s.stuck) },
                          ]}
                        />
                      </DashboardSection>

                      <DashboardSection title="Team performance" hint="Decisions by each case manager to date.">
                        {data.team.length === 0 ? (
                          <p className="text-sm text-gray-600">No decisions have been made yet.</p>
                        ) : (
                          <div className="overflow-x-auto">
                            <table className="min-w-full text-sm">
                              <caption className="sr-only">Decisions by case manager</caption>
                              <thead className="bg-gray-50 text-left text-gray-600">
                                <tr>
                                  <th scope="col" className="px-2 sm:px-3 py-2 font-medium">Case manager</th>
                                  <th scope="col" className="px-2 sm:px-3 py-2 font-medium text-right">Decisions</th>
                                  <th scope="col" className="px-2 sm:px-3 py-2 font-medium text-right">Average days to decide</th>
                                  <th scope="col" className="px-2 sm:px-3 py-2 font-medium text-right">Approval rate</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-100">
                                {data.team.map((member, i) => (
                                  <tr key={`${member.name}-${i}`}>
                                    <th scope="row" className="px-2 sm:px-3 py-2 text-left font-medium text-gray-900 break-words">{member.name}</th>
                                    <td className="px-2 sm:px-3 py-2 text-right tabular-nums text-gray-900">{member.decisions}</td>
                                    <td className="px-2 sm:px-3 py-2 text-right tabular-nums text-gray-900">{member.averageDays ?? '—'}</td>
                                    <td className="px-2 sm:px-3 py-2 text-right tabular-nums text-gray-900">{percentOrDash(member.approvalRate)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </DashboardSection>

                      <OverrideRateSection report={data.overrideRate} />
                    </div>

                    <NotificationsCard inbox={inbox} onMarkAllRead={markAllRead} />
                  </div>
                </>
              )
            )}
          </>
        )}
      </main>
    </div>
  );
}
