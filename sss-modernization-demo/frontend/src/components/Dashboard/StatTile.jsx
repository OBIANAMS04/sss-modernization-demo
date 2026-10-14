// One headline figure on a dashboard. `tone` is a text colour class: always one that reads at 4.5:1 on white, and never the
// only signal, since the label and the note say the same in words.
export default function StatTile({ label, value, note, tone = 'text-gray-900' }) {
  return (
    <div className="bg-white rounded-lg shadow p-4">
      <p className="text-sm text-gray-600">{label}</p>
      <p className={`text-2xl font-bold tabular-nums wrap-anywhere ${tone}`}>{value}</p>
      {note && <p className="text-sm text-gray-600 mt-1 wrap-anywhere">{note}</p>}
    </div>
  );
}
