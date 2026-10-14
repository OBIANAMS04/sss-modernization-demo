import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { getUser } from '../../utils/tokenManager';
import { getApiErrorMessage } from '../../utils/apiError';
import { isAdminUser } from '../../utils/roles';
import { dashboardService } from '../../services/dashboardService';
import useInbox from '../../hooks/useInbox';
import AppNav from '../Common/AppNav';
import DemoEnvironmentBanner from '../DemoEnvironmentBanner';
import Chart from './Chart';
import DashboardSection from './DashboardSection';
import NotificationsCard from './NotificationsCard';
import ReleaseProgress from './ReleaseProgress';
import StatTile from './StatTile';

const linkClass = 'text-blue-600 font-medium hover:underline';
const ROLE_LABELS = { case_manager: 'Case manager', admin: 'Administrator' };

function formatMs(ms) {
  if (ms === null || ms === undefined) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const seconds = ms / 1000;
  return `${Number.isInteger(seconds) ? seconds : seconds.toFixed(1)} s`;
}

const percentOrDash = (value) => (value === null ? '—' : `${value}%`);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// How a check reads. The words differ as well as the colour, so the result is never told by colour alone.
const GOOD = 'text-green-700';
const BAD = 'text-red-700';
const NEUTRAL = 'text-gray-700';
const FRESHNESS = { ok: ['Within target', GOOD], over: ['Over target', BAD], none: ['No updates yet', NEUTRAL] };
const COMPLIANCE = { ok: ['On target', GOOD], below: ['Below target', BAD], none: ['No decisions yet', NEUTRAL] };

function healthChecks(health) {
  const { freshness: f, compliance: c, staffByRole: staff, migrations } = health;
  const people = staff.case_manager + staff.leadership + staff.admin;
  return [
    {
      name: 'Database',
      result: health.database === 'ok' ? ['OK', GOOD] : ['Unreachable', BAD],
      detail: migrations ? `${plural(migrations.applied, 'migration')} applied, the latest ${migrations.latest}.` : 'The migrations could not be read.',
    },
    { name: 'Release', result: [`Commit ${health.commit}`, NEUTRAL], detail: 'The commit this deployment runs, as the health check reports it.' },
    {
      name: 'Data freshness',
      result: FRESHNESS[f.status],
      detail: `p95 is ${formatMs(f.p95Ms)} against the ${formatMs(f.targetMs)} target, over the last ${f.windowHours} hours (${plural(f.updates, 'update')} measured).`,
      link: ['/freshness', 'Data Freshness'],
    },
    {
      name: 'Compliance',
      result: COMPLIANCE[c.status],
      detail:
        `${c.rate === null ? 'No decisions' : `${c.rate}% of ${plural(c.decisions, 'decision')} passed every control`} in the last ${c.windowDays} days, ` +
        `against a ${c.target}% target. ${plural(c.openReviews, 'review')} open.`,
      link: ['/compliance', 'Compliance'],
    },
    {
      name: 'Access refusals',
      result: [`${health.auditRefusalsLast24h} in the last 24 hours`, NEUTRAL],
      detail: 'Requests turned away for no sign-in or no permission. Each is recorded in the audit log.',
      link: ['/audit', 'Security Audit Log'],
    },
    {
      name: 'Staff',
      result: [`${people} ${people === 1 ? 'person' : 'people'}`, NEUTRAL],
      detail: `${plural(staff.case_manager, 'case manager')}, ${staff.leadership} leadership, ${plural(staff.admin, 'administrator')}.`,
      link: ['/staff', 'Staff Access'],
    },
  ];
}

// STORY-014: every case, how each case manager is doing, and whether the system is healthy.
export default function AdminDashboard() {
  const user = getUser();
  const admin = isAdminUser(user);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(admin);
  const [error, setError] = useState('');
  const { inbox, markAllRead, notice, error: inboxError } = useInbox(admin);

  useEffect(() => {
    if (!admin) return;
    dashboardService
      .admin()
      .then(setData)
      .catch((err) => setError(getApiErrorMessage(err, 'Could not load the admin dashboard.')))
      .finally(() => setLoading(false));
  }, [admin]);

  return (
    <div className="min-h-screen bg-gray-50">
      <AppNav title="Admin Dashboard" subtitle="All cases, team performance and system health" />

      <main id="main" tabIndex={-1} className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8 focus:outline-none">
        <DemoEnvironmentBanner />

        {!admin ? (
          <div className="bg-white rounded-lg shadow-md p-6 text-gray-700">
            The admin dashboard is available to administrators only. If you were just given access, log out and log back in.
          </div>
        ) : (
          <>
            {(error || inboxError) && <div role="alert" className="mb-4 p-4 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm wrap-anywhere">{error || inboxError}</div>}
            {notice && <div role="status" className="mb-4 p-4 bg-green-50 border border-green-200 text-green-800 rounded-lg text-sm">{notice}</div>}

            {loading ? (
              <div role="status" className="text-center py-12">
                <div className="inline-block animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600" aria-hidden="true"></div>
                <p className="mt-4 text-gray-600">Loading the admin dashboard...</p>
              </div>
            ) : (
              data && (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                    <StatTile label="All cases" value={data.cases.total} />
                    <StatTile label="Open cases" value={data.cases.open} note="Not yet approved or denied" />
                    <StatTile label="Decided in the last 30 days" value={data.cases.decidedLast30Days} note="Approvals and denials" />
                    <StatTile
                      label="Open compliance reviews"
                      value={data.health.compliance.openReviews}
                      tone={data.health.compliance.openReviews ? 'text-red-700' : 'text-gray-900'}
                      note="Waiting for a second case manager"
                    />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-start">
                    <div className="md:col-span-2 space-y-6">
                      <DashboardSection title="All cases">
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                          <Chart
                            label="Cases by status"
                            categoryHeader="Status"
                            categories={data.cases.byStatus.map((s) => s.status)}
                            series={[{ name: 'Cases', values: data.cases.byStatus.map((s) => s.count) }]}
                          />
                          <Chart
                            label="Cases by exemption type"
                            categoryHeader="Exemption type"
                            categories={data.cases.byExemptionType.map((t) => t.exemptionType)}
                            series={[{ name: 'Cases', values: data.cases.byExemptionType.map((t) => t.count) }]}
                          />
                        </div>
                      </DashboardSection>

                      <DashboardSection title="Team performance" hint="Case managers and administrators. Decisions and the figures drawn from them cover the last 30 days.">
                        {data.team.length === 0 ? (
                          <p className="text-sm text-gray-600">No one has case-manager access yet.</p>
                        ) : (
                          <div className="overflow-x-auto">
                            <table className="min-w-full text-sm">
                              <caption className="sr-only">Team performance by case manager</caption>
                              <thead className="bg-gray-50 text-left text-gray-600">
                                <tr>
                                  <th scope="col" className="px-2 sm:px-3 py-2 font-medium">Case manager</th>
                                  <th scope="col" className="hidden sm:table-cell px-3 py-2 font-medium">Role</th>
                                  <th scope="col" className="px-2 sm:px-3 py-2 font-medium text-right">Open cases</th>
                                  <th scope="col" className="px-2 sm:px-3 py-2 font-medium text-right">Decided</th>
                                  <th scope="col" className="px-2 sm:px-3 py-2 font-medium text-right">Median days to decide</th>
                                  <th scope="col" className="px-2 sm:px-3 py-2 font-medium text-right">Compliance pass rate</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-100">
                                {data.team.map((member) => (
                                  <tr key={member.email} className="align-top">
                                    <th scope="row" className="px-2 sm:px-3 py-2 text-left font-medium text-gray-900 break-words">
                                      {member.name}
                                      <span className="block text-xs font-normal text-gray-600 sm:hidden">{ROLE_LABELS[member.role] || member.role}</span>
                                      <span className="block text-xs font-normal text-gray-600 wrap-anywhere">{member.email}</span>
                                    </th>
                                    <td className="hidden sm:table-cell px-3 py-2 text-gray-700">{ROLE_LABELS[member.role] || member.role}</td>
                                    <td className="px-2 sm:px-3 py-2 text-right tabular-nums text-gray-900">{member.openAssigned}</td>
                                    <td className="px-2 sm:px-3 py-2 text-right tabular-nums text-gray-900">{member.decidedLast30Days}</td>
                                    <td className="px-2 sm:px-3 py-2 text-right tabular-nums text-gray-900">{member.medianDaysToDecision ?? '—'}</td>
                                    <td className="px-2 sm:px-3 py-2 text-right tabular-nums text-gray-900">{percentOrDash(member.compliancePassRate)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </DashboardSection>

                      <DashboardSection title="System health" hint="Read when this page loaded.">
                        <dl className="divide-y divide-gray-100">
                          {healthChecks(data.health).map((check) => (
                            <div key={check.name} className="py-3 grid grid-cols-1 sm:grid-cols-[10rem_1fr] gap-1 sm:gap-4">
                              <dt className="font-medium text-gray-900">{check.name}</dt>
                              <dd className="wrap-anywhere">
                                <span className={`font-semibold ${check.result[1]}`}>{check.result[0]}</span>
                                <span className="block text-sm text-gray-700">{check.detail}</span>
                                {check.link && <Link to={check.link[0]} className={`${linkClass} inline-block mt-1 text-sm`}>{check.link[1]}</Link>}
                              </dd>
                            </div>
                          ))}
                        </dl>
                      </DashboardSection>
                    </div>

                    <NotificationsCard inbox={inbox} onMarkAllRead={markAllRead} />
                  </div>

                  <ReleaseProgress className="mt-6" />
                </>
              )
            )}
          </>
        )}
      </main>
    </div>
  );
}
