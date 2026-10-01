import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { getUser } from '../../utils/tokenManager';
import { notificationService } from '../../services/notificationService';
import UserProfile from './UserProfile';
import AppNav from '../Common/AppNav';
import DemoEnvironmentBanner from '../DemoEnvironmentBanner';

export default function Dashboard() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [inbox, setInbox] = useState({ notifications: [], unread: 0 });

  useEffect(() => {
    const userData = getUser();
    setUser(userData);
    setLoading(false);
    notificationService.list(5).then(setInbox).catch(() => {});
  }, []);

  const handleMarkAllRead = async () => {
    await notificationService.markAllRead();
    setInbox(await notificationService.list(5));
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center h-screen bg-gray-50">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
          <p className="mt-4 text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <AppNav title="SSS Modernization" subtitle="Platform Dashboard" />

      <main className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
        <DemoEnvironmentBanner />

        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center">
              <div className="p-3 rounded-full bg-blue-100">
                <svg className="w-8 h-8 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 19H9a6 6 0 016-6h0a6 6 0 016 6v1a1 1 0 01-1 1h-11a1 1 0 01-1-1v-1a6 6 0 016-6z" />
                </svg>
              </div>
              <div className="ml-4">
                <p className="text-gray-600 text-sm">Welcome</p>
                <p className="text-lg font-semibold text-gray-900">{user?.fullName}</p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center">
              <div className="p-3 rounded-full bg-green-100">
                <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div className="ml-4">
                <p className="text-gray-600 text-sm">Status</p>
                <p className="text-lg font-semibold text-green-600">Active</p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center">
              <div className="p-3 rounded-full bg-yellow-100">
                <svg className="w-8 h-8 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div className="ml-4">
                <p className="text-gray-600 text-sm">Member Since</p>
                <p className="text-lg font-semibold text-gray-900">
                  {user?.createdAt ? new Date(user.createdAt).toLocaleDateString() : 'N/A'}
                </p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center">
              <div className="p-3 rounded-full bg-purple-100">
                <svg className="w-8 h-8 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <div className="ml-4">
                <p className="text-gray-600 text-sm">Platform</p>
                <p className="text-lg font-semibold text-purple-600">R0</p>
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="md:col-span-1 space-y-6">
            {user && <UserProfile user={user} />}

            <section className="bg-white rounded-lg shadow-md p-6">
              <div className="flex justify-between items-center mb-3">
                <h2 className="text-lg font-bold text-gray-900">
                  Notifications
                  {inbox.unread > 0 && (
                    <span className="ml-2 inline-block bg-red-600 text-white text-xs font-semibold px-2 py-0.5 rounded-full align-middle">
                      {inbox.unread} new
                    </span>
                  )}
                </h2>
                {inbox.unread > 0 && (
                  <button onClick={handleMarkAllRead} className="text-xs text-blue-600 hover:underline">
                    Mark all read
                  </button>
                )}
              </div>
              {inbox.notifications.length === 0 ? (
                <p className="text-sm text-gray-600">No notifications yet.</p>
              ) : (
                <ul className="space-y-3">
                  {inbox.notifications.map((n) => (
                    <li key={n.id} className={`text-sm rounded-lg p-3 ${n.read ? 'bg-gray-50 text-gray-600' : 'bg-blue-50 text-gray-900'}`}>
                      {n.caseId ? (
                        <Link to={`/cases/${n.caseId}`} className="hover:underline">{n.message}</Link>
                      ) : (
                        n.message
                      )}
                      <span className="block text-xs text-gray-500 mt-1">{new Date(n.createdAt).toLocaleString()}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          <div className="md:col-span-2">
            <div className="space-y-6">
              <div className="bg-white rounded-lg shadow-md p-6">
                <h2 className="text-xl font-bold text-gray-900 mb-4">Dashboard Overview</h2>
                <p className="text-gray-700 mb-4">
                  Welcome to the SSS Modernization Platform! You have successfully logged in to Release Zero (R0) - Walking Skeleton.
                </p>
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <p className="text-sm text-blue-800">
                    <span className="font-semibold">ℹ️ Release Zero Status:</span> The backend API and database have been successfully deployed. This frontend interface provides user authentication and dashboard functionality.
                  </p>
                </div>
              </div>

              <div className="bg-white rounded-lg shadow-md p-6">
                <h2 className="text-xl font-bold text-gray-900 mb-4">Quick Stats</h2>
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-lg p-4 border border-blue-200">
                    <p className="text-gray-600 text-sm">Release Zero</p>
                    <p className="text-3xl font-bold text-blue-600">Complete</p>
                  </div>
                  <div className="bg-gradient-to-br from-green-50 to-green-100 rounded-lg p-4 border border-green-200">
                    <p className="text-gray-600 text-sm">API Status</p>
                    <p className="text-3xl font-bold text-green-600">✓</p>
                  </div>
                  <div className="bg-gradient-to-br from-purple-50 to-purple-100 rounded-lg p-4 border border-purple-200">
                    <p className="text-gray-600 text-sm">Database</p>
                    <p className="text-3xl font-bold text-purple-600">✓</p>
                  </div>
                  <div className="bg-gradient-to-br from-yellow-50 to-yellow-100 rounded-lg p-4 border border-yellow-200">
                    <p className="text-gray-600 text-sm">Frontend</p>
                    <p className="text-3xl font-bold text-yellow-600">✓</p>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-lg shadow-md p-6">
                <h2 className="text-xl font-bold text-gray-900 mb-4">Release Progress</h2>
                <ul className="space-y-2 text-gray-700">
                  <li className="flex items-center">
                    <span className="flex-shrink-0 h-5 w-5 text-green-600 mr-2">✓</span>
                    R0: Secure registration and sign-in (hashed passwords and SSNs)
                  </li>
                  <li className="flex items-center">
                    <span className="flex-shrink-0 h-5 w-5 text-green-600 mr-2">✓</span>
                    R0: Compliance guards (demo-data banner, masked SSN entry)
                  </li>
                  <li className="flex items-center">
                    <span className="flex-shrink-0 h-5 w-5 text-green-600 mr-2">✓</span>
                    R0: Live deployment with managed database
                  </li>
                  <li className="flex items-center">
                    <span className="flex-shrink-0 h-5 w-5 text-green-600 mr-2">✓</span>
                    R1: Profile update with compliance check, and exemption eligibility with reasons
                  </li>
                  <li className="flex items-center">
                    <span className="flex-shrink-0 h-5 w-5 text-green-600 mr-2">✓</span>
                    R1: Case management: applications, review workflow, timeline, notifications, CSV export
                  </li>
                  <li className="flex items-center">
                    <span className="flex-shrink-0 h-5 w-5 text-blue-600 mr-2">→</span>
                    R1 (next): Compliance validation, audit logging, role-based dashboards
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
