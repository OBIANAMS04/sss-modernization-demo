import { useState, useEffect, useId } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { getUser } from '../../utils/tokenManager';
import { getApiErrorMessage } from '../../utils/apiError';
import { isStaffUser } from '../../utils/roles';
import { dashboardService } from '../../services/dashboardService';
import useInbox from '../../hooks/useInbox';
import AppNav from '../Common/AppNav';
import StatusBadge from '../Common/StatusBadge';
import DemoEnvironmentBanner from '../DemoEnvironmentBanner';
import DashboardSection from './DashboardSection';
import NotificationsCard from './NotificationsCard';
import StatTile from './StatTile';

const formatDate = (value) => (value ? new Date(value).toLocaleString() : '—');
const linkClass = 'text-blue-600 font-medium hover:underline';
const inputClass =
  'w-full px-3 py-2 border border-gray-500 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none text-sm bg-white';

// The same lists the case list offers; Approved and Denied are the decided ones, which it hides unless asked
const STATUSES = ['Submitted', 'In Review', 'Appealed', 'Approved', 'Denied', 'Draft'];
const DECIDED = ['Approved', 'Denied'];
const EXEMPTION_TYPES = ['Type A', 'Type B', 'Type C'];

const daysAgo = (days) => (days === 0 ? 'Today' : days === 1 ? '1 day ago' : `${days} days ago`);

/**
 * Cases as a table. An overdue case says so in words as well as in red. The wrapper is positioned so the screen-reader-only text
 * in the cells stays inside it when the table scrolls: out in the page it would widen the page itself on a phone.
 */
function CaseTable({ cases, label }) {
  return (
    <div className="overflow-x-auto relative">
      <table className="min-w-full text-sm">
        <caption className="sr-only">{label}</caption>
        <thead className="bg-gray-50 text-left text-gray-600">
          <tr>
            <th scope="col" className="px-2 sm:px-3 py-2 font-medium">Applicant</th>
            <th scope="col" className="hidden sm:table-cell px-3 py-2 font-medium">Exemption</th>
            <th scope="col" className="px-2 sm:px-3 py-2 font-medium">Status</th>
            <th scope="col" className="px-2 sm:px-3 py-2 font-medium">Last update</th>
            <th scope="col" className="px-2 sm:px-3 py-2 font-medium"><span className="sr-only">Case</span></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {cases.map((c) => (
            <tr key={c.id} className="align-top">
              <th scope="row" className="px-2 sm:px-3 py-2 font-medium text-left text-gray-900 break-words">
                {c.applicantName}
                <span className="block text-xs font-normal text-gray-600 sm:hidden">{c.exemptionType || 'No exemption type'}</span>
              </th>
              <td className="hidden sm:table-cell px-3 py-2 text-gray-700">{c.exemptionType || '—'}</td>
              <td className="px-2 sm:px-3 py-2"><StatusBadge status={c.status} /></td>
              <td className="px-2 sm:px-3 py-2 text-gray-700">
                {daysAgo(c.daysSinceUpdate)}
                {c.overdue && <span className="block font-semibold text-red-700">Overdue</span>}
              </td>
              <td className="px-2 sm:px-3 py-2 text-right">
                <Link to={`/cases/${c.id}`} className={linkClass}>
                  Open<span className="sr-only"> case for {c.applicantName}</span>
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A list that may be cut short: says how many are shown of how many, and where to see them all. */
function Shown({ shown, total, to, children }) {
  if (total <= shown) return null;
  return (
    <p className="mt-2 text-sm text-gray-600">
      Showing {shown} of {total}.{' '}
      <Link to={to} className="text-blue-600 font-medium underline hover:text-blue-700">{children}</Link>
    </p>
  );
}

function Group({ title, count, empty, children }) {
  return (
    <div className="mt-5 first:mt-0">
      <h3 className="font-semibold text-gray-900 mb-2">
        {title} <span className="text-gray-600 font-normal">({count})</span>
      </h3>
      {count === 0 ? <p className="text-sm text-gray-600">{empty}</p> : children}
    </div>
  );
}

/** The case search: a small form that opens the case list with the filters in its address, so the result can be bookmarked. */
function FindCase({ email }) {
  const navigate = useNavigate();
  const baseId = useId();
  const [form, setForm] = useState({ applicant: '', status: '', exemptionType: '', assignedTo: '', includeDecided: false });
  const update = (name) => (e) => setForm((prev) => ({ ...prev, [name]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  const handleSubmit = (e) => {
    e.preventDefault();
    const query = new URLSearchParams();
    if (form.applicant.trim()) query.set('applicant', form.applicant.trim());
    if (form.status) query.set('status', form.status);
    if (form.exemptionType) query.set('exemptionType', form.exemptionType);
    if (form.assignedTo) query.set('assignedTo', form.assignedTo === 'me' ? email : form.assignedTo);
    // The case list shows open cases unless told otherwise, and approved and denied cases are not open
    if (form.includeDecided || DECIDED.includes(form.status)) query.set('openOnly', 'false');
    const search = query.toString();
    navigate(search ? `/cases?${search}` : '/cases');
  };

  return (
    <DashboardSection title="Find a case">
      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label htmlFor={`${baseId}-applicant`} className="block text-sm font-medium text-gray-700 mb-1">Applicant name or email</label>
          <input id={`${baseId}-applicant`} value={form.applicant} onChange={update('applicant')} autoComplete="off" className={inputClass} />
        </div>
        <div>
          <label htmlFor={`${baseId}-status`} className="block text-sm font-medium text-gray-700 mb-1">Status</label>
          <select id={`${baseId}-status`} value={form.status} onChange={update('status')} className={inputClass}>
            <option value="">All statuses</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor={`${baseId}-type`} className="block text-sm font-medium text-gray-700 mb-1">Exemption type</label>
          <select id={`${baseId}-type`} value={form.exemptionType} onChange={update('exemptionType')} className={inputClass}>
            <option value="">All types</option>
            {EXEMPTION_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor={`${baseId}-assigned`} className="block text-sm font-medium text-gray-700 mb-1">Assigned to</label>
          <select id={`${baseId}-assigned`} value={form.assignedTo} onChange={update('assignedTo')} className={inputClass}>
            <option value="">Anyone</option>
            <option value="me">Me</option>
            <option value="unassigned">Unassigned</option>
          </select>
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={form.includeDecided} onChange={update('includeDecided')} className="h-4 w-4" />
          Include approved and denied cases
        </label>
        <button type="submit" className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2">
          Search cases
        </button>
      </form>
    </DashboardSection>
  );
}

// STORY-013: a case manager's own work: their open cases, what is waiting on them, the unassigned queue and what is overdue.
export default function CaseManagerDashboard() {
  const user = getUser();
  const staff = isStaffUser(user);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(staff);
  const [error, setError] = useState('');
  const { inbox, markAllRead, notice, error: inboxError } = useInbox(staff);

  useEffect(() => {
    if (!staff) return;
    dashboardService
      .caseManager()
      .then(setData)
      .catch((err) => setError(getApiErrorMessage(err, 'Could not load your work.')))
      .finally(() => setLoading(false));
  }, [staff]);

  const mine = `/cases?assignedTo=${encodeURIComponent(user?.email || '')}`;

  return (
    <div className="min-h-screen bg-gray-50">
      <AppNav title="My Work" subtitle="Your cases, what is waiting on you and what is overdue" />

      <main id="main" tabIndex={-1} className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8 focus:outline-none">
        <DemoEnvironmentBanner />

        {!staff ? (
          <div className="bg-white rounded-lg shadow-md p-6 text-gray-700">
            My Work is available to case managers only. If you were just given access, log out and log back in.
          </div>
        ) : (
          <>
            {(error || inboxError) && <div role="alert" className="mb-4 p-4 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm wrap-anywhere">{error || inboxError}</div>}
            {notice && <div role="status" className="mb-4 p-4 bg-green-50 border border-green-200 text-green-800 rounded-lg text-sm">{notice}</div>}

            {loading ? (
              <div role="status" className="text-center py-12">
                <div className="inline-block animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600" aria-hidden="true"></div>
                <p className="mt-4 text-gray-600">Loading your work...</p>
              </div>
            ) : (
              data && (
                <>
                  <p className="mb-6 text-gray-700 wrap-anywhere">
                    Welcome{user?.fullName ? `, ${user.fullName}` : ''}. Here is the work assigned to you, and what the team has yet to pick up.
                  </p>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                    <StatTile label="My open cases" value={data.myOpenCases.total} />
                    <StatTile
                      label="Waiting on me"
                      value={data.waitingOnMe.toStart.total + data.waitingOnMe.toDecide.total + data.waitingOnMe.reviews.total}
                      note={`${data.waitingOnMe.toStart.total} to start, ${data.waitingOnMe.toDecide.total} to decide, ${data.waitingOnMe.reviews.total} to resolve`}
                    />
                    <StatTile
                      label={`Overdue: no update for more than ${data.overdueDays} days`}
                      value={data.overdue.total}
                      tone={data.overdue.total ? 'text-red-700' : 'text-gray-900'}
                      note="Mine and unassigned"
                    />
                    <StatTile label="Unassigned queue" value={data.unassigned.total} />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-start">
                    <div className="md:col-span-2 space-y-6">
                      <DashboardSection title="Waiting on me" hint="Cases assigned to you that need your next step, and decisions of other case managers that you may review.">
                        <Group title="Submitted cases to start" count={data.waitingOnMe.toStart.total} empty="No submitted case is waiting for you to start.">
                          <CaseTable cases={data.waitingOnMe.toStart.cases} label="Submitted cases assigned to you, to start reviewing" />
                          <Shown shown={data.waitingOnMe.toStart.cases.length} total={data.waitingOnMe.toStart.total} to={`${mine}&status=Submitted`}>See them all in Case Management</Shown>
                        </Group>
                        <Group title="Cases to decide" count={data.waitingOnMe.toDecide.total} empty="No case is waiting for your decision.">
                          <CaseTable cases={data.waitingOnMe.toDecide.cases} label="In Review and Appealed cases assigned to you, to decide" />
                        </Group>
                        <Group title="Compliance reviews to resolve" count={data.waitingOnMe.reviews.total} empty="No compliance review is waiting for you.">
                          <ul className="divide-y divide-gray-100">
                            {data.waitingOnMe.reviews.reviews.map((r) => (
                              <li key={r.id} className="py-3 flex flex-wrap justify-between gap-3">
                                <div className="min-w-0 wrap-anywhere">
                                  <p className="font-medium text-gray-900 text-sm">
                                    {r.applicantName} · {r.exemptionType || 'Exemption'} · {r.decision || 'Decision'} by {r.decidedBy || 'unknown'}
                                  </p>
                                  <p className="text-sm text-red-700">Failed: {r.failedControls.join(', ')}</p>
                                  <p className="text-xs text-gray-600">Opened {formatDate(r.openedAt)}</p>
                                </div>
                                <Link to={`/cases/${r.caseId}`} className={`${linkClass} text-sm self-center`}>
                                  Review on case<span className="sr-only"> for {r.applicantName}</span>
                                </Link>
                              </li>
                            ))}
                          </ul>
                          <Shown shown={data.waitingOnMe.reviews.reviews.length} total={data.waitingOnMe.reviews.total} to="/compliance">Open Compliance</Shown>
                        </Group>
                      </DashboardSection>

                      <DashboardSection title="Overdue" hint={`Open cases, yours or unassigned, with no update for more than ${data.overdueDays} days. The longest waiting first.`}>
                        {data.overdue.cases.length === 0 ? (
                          <p className="text-sm text-gray-600">Nothing is overdue.</p>
                        ) : (
                          <>
                            <CaseTable cases={data.overdue.cases} label="Overdue open cases, yours or unassigned" />
                            <Shown shown={data.overdue.cases.length} total={data.overdue.total} to={mine}>See your cases in Case Management</Shown>
                          </>
                        )}
                      </DashboardSection>

                      <DashboardSection title="My open cases" hint="Assigned to you and not yet decided. The longest without an update first.">
                        {data.myOpenCases.cases.length === 0 ? (
                          <p className="text-sm text-gray-600">No open case is assigned to you. Pick one up from the unassigned queue.</p>
                        ) : (
                          <>
                            <CaseTable cases={data.myOpenCases.cases} label="Your open cases" />
                            <Shown shown={data.myOpenCases.cases.length} total={data.myOpenCases.total} to={mine}>See them all in Case Management</Shown>
                          </>
                        )}
                      </DashboardSection>

                      <DashboardSection title="Unassigned queue" hint={`${data.unassigned.total} open case${data.unassigned.total === 1 ? ' has' : 's have'} no case manager yet.${data.unassigned.oldest.length > 1 ? ' The oldest first.' : ''}`}>
                        {data.unassigned.oldest.length === 0 ? (
                          <p className="text-sm text-gray-600">The queue is empty.</p>
                        ) : (
                          <>
                            <CaseTable cases={data.unassigned.oldest} label="The oldest unassigned open cases" />
                            <Shown shown={data.unassigned.oldest.length} total={data.unassigned.total} to="/cases?assignedTo=unassigned">See the whole queue in Case Management</Shown>
                          </>
                        )}
                      </DashboardSection>

                      <DashboardSection title="My recent decisions">
                        {data.recentDecisions.length === 0 ? (
                          <p className="text-sm text-gray-600">You have not approved or denied a case yet.</p>
                        ) : (
                          <ul className="divide-y divide-gray-100">
                            {data.recentDecisions.map((d) => (
                              <li key={`${d.caseId}-${d.decidedAt}`} className="py-3 flex flex-wrap justify-between gap-2">
                                <div className="min-w-0 wrap-anywhere">
                                  <p className="text-sm font-medium text-gray-900">
                                    <StatusBadge status={d.decision} /> {d.applicantName} · {d.exemptionType || 'Exemption'}
                                  </p>
                                  <p className="text-xs text-gray-600 mt-1">
                                    <time dateTime={d.decidedAt}>{formatDate(d.decidedAt)}</time>
                                  </p>
                                </div>
                                <Link to={`/cases/${d.caseId}`} className={`${linkClass} text-sm self-center`}>
                                  Open<span className="sr-only"> case for {d.applicantName}</span>
                                </Link>
                              </li>
                            ))}
                          </ul>
                        )}
                      </DashboardSection>
                    </div>

                    <div className="space-y-6">
                      <FindCase email={user?.email} />
                      <NotificationsCard inbox={inbox} onMarkAllRead={markAllRead} />
                    </div>
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
