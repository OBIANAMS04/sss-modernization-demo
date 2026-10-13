import { Link } from 'react-router-dom';

// Shared by the citizen and staff dashboards: the unread count, the latest messages and "Mark all read".
// `inbox` is { notifications, unread }, as notificationService.list returns it.
export default function NotificationsCard({ inbox, onMarkAllRead }) {
  return (
    <section className="bg-white rounded-lg shadow-md p-6">
      <div className="flex justify-between items-center mb-3">
        <h2 className="text-lg font-bold text-gray-900">
          Notifications{' '}
          {inbox.unread > 0 && (
            <span className="ml-1 inline-block bg-red-600 text-white text-xs font-semibold px-2 py-0.5 rounded-full align-middle">
              {inbox.unread} new
            </span>
          )}
        </h2>
        {inbox.unread > 0 && (
          <button onClick={onMarkAllRead} className="text-xs text-blue-600 hover:underline">
            Mark all read
          </button>
        )}
      </div>
      {inbox.notifications.length === 0 ? (
        <p className="text-sm text-gray-600">No notifications yet.</p>
      ) : (
        <ul className="space-y-3">
          {inbox.notifications.map((n) => (
            <li key={n.id} className={`text-sm rounded-lg p-3 wrap-anywhere ${n.read ? 'bg-gray-50 text-gray-600' : 'bg-blue-50 text-gray-900'}`}>
              {n.caseId ? (
                <Link to={`/cases/${n.caseId}`} className="hover:underline">{n.message}</Link>
              ) : (
                n.message
              )}
              <span className="block text-xs text-gray-600 mt-1">{new Date(n.createdAt).toLocaleString()}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
