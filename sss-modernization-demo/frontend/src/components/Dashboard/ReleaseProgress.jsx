const RELEASE_PROGRESS = [
  { done: true, text: 'R0: Secure registration and sign-in (hashed passwords and SSNs)' },
  { done: true, text: 'R0: Compliance guards (demo-data banner, masked SSN entry)' },
  { done: true, text: 'R0: Demo deployment online, with a managed database' },
  { done: true, text: 'R1: Profile update with compliance check, and exemption eligibility with reasons' },
  { done: true, text: 'R1: Case management: applications, review workflow, timeline, notifications, CSV export' },
  { done: true, text: 'R1: Compliance validation: every decision checked against 8 controls, with reviews and an audit log' },
  { done: true, text: 'R1: Data freshness: every update timed until it is readable, against a 30-second target' },
  { done: true, text: 'R1: Security audit log: every sign-in, refusal, data access and change, write-once' },
  { done: true, text: 'R1: Accessibility (Section 508): every page checked against WCAG 2.1 AA, by keyboard and screen reader' },
  { done: true, text: 'R1: Citizen dashboard: applications, eligibility, case history and notifications in one place' },
  { done: true, text: 'R1: Case manager dashboard: my cases, cases waiting on me, overdue, search' },
  { done: true, text: 'R1: Admin dashboard: all cases, team performance, system health' },
  { done: true, text: 'R1: Leadership dashboard: KPIs, trends, bottlenecks, team performance' },
  { done: false, text: 'R1 (next): API access policies' },
];

// Shared by the citizen and admin dashboards. `className` sets the spacing around the card.
export default function ReleaseProgress({ className = '' }) {
  return (
    <section className={`bg-white rounded-lg shadow-md p-6 ${className}`}>
      <h2 className="text-xl font-bold text-gray-900 mb-4">Release Progress</h2>
      <ul className="space-y-2 text-gray-700">
        {RELEASE_PROGRESS.map((item) => (
          <li key={item.text} className="flex items-center">
            {item.done ? (
              <span className="flex-shrink-0 h-5 w-5 text-green-700 mr-2" role="img" aria-label="Done">✓</span>
            ) : (
              <span className="flex-shrink-0 h-5 w-5 text-blue-600 mr-2" aria-hidden="true">→</span>
            )}
            {item.text}
          </li>
        ))}
      </ul>
    </section>
  );
}
