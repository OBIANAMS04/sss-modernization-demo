const STATUS_STYLES = {
  // Eligibility / compliance
  Eligible: 'bg-green-100 text-green-800',
  'Pending Review': 'bg-yellow-100 text-yellow-800',
  'Not Eligible': 'bg-gray-100 text-gray-700',
  Ineligible: 'bg-red-100 text-red-800',
  // Case workflow
  Draft: 'bg-gray-100 text-gray-700',
  Submitted: 'bg-blue-100 text-blue-800',
  'In Review': 'bg-yellow-100 text-yellow-800',
  Approved: 'bg-green-100 text-green-800',
  Denied: 'bg-red-100 text-red-800',
  Appealed: 'bg-purple-100 text-purple-800',
};

export default function StatusBadge({ status }) {
  return (
    <span className={`inline-block text-xs font-medium px-2 py-1 rounded-full whitespace-nowrap ${STATUS_STYLES[status] || 'bg-gray-100 text-gray-700'}`}>
      {status}
    </span>
  );
}
