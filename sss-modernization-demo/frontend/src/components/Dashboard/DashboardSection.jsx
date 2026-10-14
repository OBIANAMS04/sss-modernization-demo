import { useId } from 'react';

// A titled card on a dashboard. The title is the section's h2, which names the region for screen readers.
export default function DashboardSection({ title, hint, children }) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="bg-white rounded-lg shadow-md p-4 sm:p-6">
      <h2 id={headingId} className="text-xl font-bold text-gray-900">{title}</h2>
      {hint && <p className="text-sm text-gray-600 mt-1">{hint}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}
