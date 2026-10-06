import { useState } from 'react';

const DECISION_NOUNS = { Approved: 'approval', Denied: 'denial' };
const decisionNoun = (decision) => DECISION_NOUNS[decision] || 'decision';

function ControlList({ controls }) {
  return (
    <ul className="grid gap-x-8 gap-y-3 md:grid-cols-2">
      {controls.map((c) => (
        <li key={c.controlId} className="text-sm">
          <p className="flex items-start gap-2">
            <span className={`mt-0.5 shrink-0 font-bold ${c.passed ? 'text-green-600' : 'text-red-600'}`} aria-label={c.passed ? 'Passed' : 'Failed'}>
              {c.passed ? '✓' : '✗'}
            </span>
            <span className={c.passed ? 'text-gray-800' : 'text-red-800 font-medium'}>
              <span className="font-mono text-xs text-gray-500">{c.controlId}</span> {c.control}
            </span>
          </p>
          <p className="ml-5 text-xs text-gray-500">{c.evidence}</p>
        </li>
      ))}
    </ul>
  );
}

/** Staff view of a case's decision compliance: control results per decision and any open review. */
export default function CompliancePanel({ compliance, currentEmail, busy, onResolve }) {
  const [note, setNote] = useState('');
  const [latest, ...earlier] = compliance.decisions;
  const openReview = compliance.reviews.find((r) => r.status === 'Open');
  const resolvedReviews = compliance.reviews.filter((r) => r.status === 'Resolved');
  const ownDecision = openReview && openReview.decidedBy?.toLowerCase() === currentEmail?.toLowerCase();

  const resolve = async (action) => {
    await onResolve(openReview.id, action, note.trim());
    setNote('');
  };

  return (
    <section className="bg-white rounded-lg shadow-md p-6">
      <h3 className="text-lg font-bold text-gray-900">Compliance</h3>
      <p className="text-xs text-gray-500 mb-3">Decision controls, checked automatically. Visible to case managers only.</p>

      {openReview && (
        <div className="mb-4 p-3 rounded-lg border border-red-300 bg-red-50">
          <p className="text-sm font-semibold text-red-800">Compliance review open</p>
          <p className="text-xs text-red-700 mb-2">
            The {decisionNoun(openReview.decision)} by {openReview.decidedBy || 'unknown'} failed {openReview.failedControls.join(', ')}.
          </p>
          {ownDecision ? (
            <p className="text-xs text-red-700">A different case manager must resolve a review of your own decision.</p>
          ) : (
            <>
              <label htmlFor="review-note" className="block text-xs font-medium text-gray-700 mb-1">
                Justification (required, kept in the audit trail)
              </label>
              <textarea
                id="review-note"
                rows={3}
                maxLength={2000}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm bg-white"
              />
              <div className="flex flex-wrap gap-2 mt-2">
                <button
                  onClick={() => resolve('accept')}
                  disabled={busy || !note.trim()}
                  className="bg-gray-800 text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-gray-900 disabled:opacity-50"
                >
                  Accept exception
                </button>
                <button
                  onClick={() => resolve('reopen')}
                  disabled={busy || !note.trim()}
                  className="bg-red-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-50"
                >
                  Reopen case
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {!latest ? (
        <p className="text-sm text-gray-600">No decision yet. Controls are checked when the case is approved or denied.</p>
      ) : (
        <>
          <p className="text-sm text-gray-700 mb-2">
            Latest decision: <strong>{latest.decision}</strong> by {latest.decidedBy}{' '}
            <span className={`ml-1 inline-block px-2 py-0.5 rounded-full text-xs font-medium ${latest.compliant ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
              {latest.compliant ? 'All controls passed' : 'Controls failed'}
            </span>
          </p>
          <ControlList controls={latest.controls} />
          {earlier.length > 0 && (
            <details className="mt-3">
              <summary className="text-sm text-blue-600 cursor-pointer">
                {earlier.length} earlier decision{earlier.length === 1 ? '' : 's'}
              </summary>
              <div className="mt-2 space-y-3">
                {earlier.map((d) => (
                  <div key={d.eventId}>
                    <p className="text-xs text-gray-600 mb-1">
                      {d.decision} by {d.decidedBy} · {new Date(d.checkedAt).toLocaleString()} · {d.compliant ? 'compliant' : 'not compliant'}
                    </p>
                    <ControlList controls={d.controls} />
                  </div>
                ))}
              </div>
            </details>
          )}
        </>
      )}

      {resolvedReviews.length > 0 && (
        <div className="mt-4 border-t border-gray-100 pt-3 space-y-2">
          {resolvedReviews.map((r) => (
            <p key={r.id} className="text-xs text-gray-600">
              Review of the {decisionNoun(r.decision)} by {r.decidedBy} (failed {r.failedControls.join(', ')}): {r.resolution?.toLowerCase()} by{' '}
              {r.resolvedBy} on {new Date(r.resolvedAt).toLocaleDateString()}. “{r.resolutionNote}”
            </p>
          ))}
        </div>
      )}
    </section>
  );
}
