import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { getUser } from '../../utils/tokenManager';
import { getApiErrorMessage } from '../../utils/apiError';
import { dashboardService } from '../../services/dashboardService';
import { notificationService } from '../../services/notificationService';
import NotificationsCard from './NotificationsCard';
import DataFreshnessCard from './DataFreshnessCard';
import ReleaseProgress from './ReleaseProgress';
import AppNav from '../Common/AppNav';
import StatusBadge from '../Common/StatusBadge';
import DemoEnvironmentBanner from '../DemoEnvironmentBanner';

// Dates read as on the case page
const formatDate = (value) => (value ? new Date(value).toLocaleString() : '—');

const linkClass = 'text-blue-600 font-medium hover:underline';
// A link inside a sentence is underlined, so it does not rely on colour alone to stand out (WCAG 1.4.1)
const inlineLinkClass = 'text-blue-600 font-medium underline hover:text-blue-700';

const caseLinkText = (exemptionType) => `View your ${exemptionType || 'exemption'} case`;

// STORY-012: a registrant's applications, eligibility, case history and notifications in one place.
export default function CitizenDashboard() {
  const user = getUser();
  const [data, setData] = useState(null);
  const [inbox, setInbox] = useState({ notifications: [], unread: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    dashboardService
      .citizen()
      .then((dashboard) => {
        setData(dashboard);
        setInbox({ notifications: dashboard.notifications.recent, unread: dashboard.notifications.unread });
      })
      .catch((err) => setError(getApiErrorMessage(err, 'Could not load your dashboard.')))
      .finally(() => setLoading(false));
  }, []);

  const handleMarkAllRead = async () => {
    setError('');
    try {
      await notificationService.markAllRead();
      setInbox(await notificationService.list(5));
      setNotice('All notifications marked as read.'); // the button is gone once they are, so say so
    } catch (err) {
      setError(getApiErrorMessage(err, 'Could not mark your notifications as read.'));
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <AppNav title="SSS Modernization" subtitle="Platform Dashboard" pageTitle="Dashboard" />

      <main id="main" tabIndex={-1} className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8 focus:outline-none">
        <DemoEnvironmentBanner />

        {error && <div role="alert" className="mb-4 p-4 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">{error}</div>}
        {notice && <div role="status" className="mb-4 p-4 bg-green-50 border border-green-200 text-green-800 rounded-lg text-sm">{notice}</div>}

        {loading ? (
          <div role="status" className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600" aria-hidden="true"></div>
            <p className="mt-4 text-gray-600">Loading your dashboard...</p>
          </div>
        ) : (
          data && (
            <>
              <p className="mb-6 text-gray-700 wrap-anywhere">
                Welcome{user?.fullName ? `, ${user.fullName}` : ''}. Your applications, eligibility, case history and notifications are all here.
              </p>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-start">
                <div className="md:col-span-2 space-y-6">
                  <section className="bg-white rounded-lg shadow-md p-6">
                    <h2 className="text-xl font-bold text-gray-900 mb-4">Your applications</h2>
                    {data.applications.length === 0 ? (
                      <p className="text-gray-600">
                        No applications yet. Check your eligibility and apply from{' '}
                        <Link to="/profile" className={inlineLinkClass}>Profile &amp; Exemptions</Link>.
                      </p>
                    ) : (
                      <ul className="space-y-4">
                        {data.applications.map((a) => (
                          <li key={a.id} className="border border-gray-200 rounded-lg p-4">
                            <div className="flex flex-wrap justify-between items-start gap-2">
                              <h3 className="font-semibold text-gray-900 wrap-anywhere">{a.label}</h3>
                              <StatusBadge status={a.status} />
                            </div>
                            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3 text-sm wrap-anywhere">
                              <div>
                                <dt className="text-gray-600">Submitted</dt>
                                <dd className="text-gray-900">{formatDate(a.submittedAt)}</dd>
                              </div>
                              <div>
                                <dt className="text-gray-600">Last update</dt>
                                <dd className="text-gray-900">{formatDate(a.updatedAt)}</dd>
                              </div>
                              <div>
                                <dt className="text-gray-600">Case manager</dt>
                                <dd className="text-gray-900">{a.caseManagerAssigned ? 'Assigned' : 'Not assigned yet'}</dd>
                              </div>
                            </dl>
                            {a.decisionReason && (
                              <p className="mt-3 text-sm text-gray-900 wrap-anywhere">
                                <span className="font-semibold">Reason for the denial:</span> {a.decisionReason}
                              </p>
                            )}
                            <p className="mt-3 text-sm text-gray-900 wrap-anywhere">
                              <span className="font-semibold">Next step:</span> {a.nextStep}
                            </p>
                            <p className="mt-3 text-sm">
                              <Link to={`/cases/${a.id}`} className={linkClass}>{caseLinkText(a.exemptionType)}</Link>
                            </p>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>

                  <section className="bg-white rounded-lg shadow-md p-6">
                    <h2 className="text-xl font-bold text-gray-900 mb-4">Your eligibility</h2>
                    {data.eligibility.length === 0 ? (
                      <p className="text-gray-600">Your eligibility has not been checked yet. Saving your profile checks it.</p>
                    ) : (
                      <ul className="space-y-3">
                        {data.eligibility.map((e) => (
                          <li key={e.exemptionType} className="border border-gray-200 rounded-lg p-4">
                            <div className="flex flex-wrap justify-between items-start gap-2">
                              <h3 className="font-medium text-gray-900 text-sm wrap-anywhere">{e.label}</h3>
                              <StatusBadge status={e.status} />
                            </div>
                            <p className="text-sm text-gray-600 mt-1 wrap-anywhere">{e.reason}</p>
                            <p className="text-xs text-gray-600 mt-1">Checked {formatDate(e.determinedAt)}</p>
                          </li>
                        ))}
                      </ul>
                    )}
                    {data.profile.passesComplianceCheck ? (
                      <p className="mt-4 text-sm text-gray-600">
                        Your profile passes the compliance check: age 18 or older, with a phone number and an address.
                      </p>
                    ) : (
                      <div className="mt-4 p-3 bg-yellow-50 border border-yellow-300 text-yellow-800 rounded-lg text-sm wrap-anywhere">
                        <p className="font-medium">Your profile does not pass the compliance check yet.</p>
                        {data.profile.missing.length > 0 && <p>Still needed: {data.profile.missing.join(', ')}.</p>}
                      </div>
                    )}
                    <p className="mt-4 text-sm">
                      <Link to="/profile" className={linkClass}>Update your profile</Link>
                    </p>
                  </section>

                  <section className="bg-white rounded-lg shadow-md p-6">
                    <h2 className="text-xl font-bold text-gray-900 mb-4">Recent activity</h2>
                    {data.history.length === 0 ? (
                      <p className="text-gray-600">No activity yet. Changes to your applications appear here.</p>
                    ) : (
                      <ol className="space-y-4">
                        {data.history.map((event) => (
                          <li key={event.id} className="border-l-4 border-blue-200 pl-4">
                            <p className="font-medium text-gray-900 text-sm wrap-anywhere">{event.description}</p>
                            <p className="text-xs text-gray-600 mt-1">
                              <time dateTime={event.createdAt}>{formatDate(event.createdAt)}</time>
                            </p>
                            <p className="text-sm mt-1">
                              <Link to={`/cases/${event.caseId}`} className={linkClass}>{caseLinkText(event.exemptionType)}</Link>
                            </p>
                          </li>
                        ))}
                      </ol>
                    )}
                  </section>
                </div>

                <div className="space-y-6">
                  <NotificationsCard inbox={inbox} onMarkAllRead={handleMarkAllRead} />
                  <DataFreshnessCard />
                </div>
              </div>

              <ReleaseProgress className="mt-6" />
            </>
          )
        )}
      </main>
    </div>
  );
}
