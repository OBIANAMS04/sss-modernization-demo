import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { getUser } from '../../utils/tokenManager';
import { getApiErrorMessage } from '../../utils/apiError';
import { isStaffUser } from '../../utils/roles';
import { assistantService } from '../../services/assistantService';
import AppNav from '../Common/AppNav';
import DashboardSection from '../Dashboard/DashboardSection';
import StatTile from '../Dashboard/StatTile';
import DemoEnvironmentBanner from '../DemoEnvironmentBanner';
import AnswerQuality from './AnswerQuality';
import ReviewCard from './ReviewCard';
import { formatTime, waitedSince } from './format';
import usePassages from './usePassages';

const OUTCOME_WORDS = { approved: 'Approved', corrected: 'Corrected', declined: 'Declined' };

// STORY-023: the review queue for case managers and admins. Answers the assistant withheld (not grounded, or a question about the
// person's own case) and answers a person reported wait here, oldest first. A review approves the draft, corrects it or declines;
// the person is notified and sees the result in their history, marked as reviewed. STORY-022's answer quality figures sit above it.
export default function ReviewQueue() {
  const staff = isStaffUser(getUser());
  const [data, setData] = useState(null);
  const [quality, setQuality] = useState(null);
  const [loading, setLoading] = useState(staff);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const { passages, load: loadPassage } = usePassages();
  const noticeRef = useRef(null);
  const waitingId = useId();

  const load = useCallback(
    () =>
      Promise.all([assistantService.reviews(), assistantService.quality()])
        .then(([queue, figures]) => {
          setData(queue);
          setQuality(figures);
          setError('');
        })
        .catch((err) => setError(getApiErrorMessage(err, 'Could not load the review queue.')))
        .finally(() => setLoading(false)),
    []
  );

  useEffect(() => {
    if (staff) load();
  }, [staff, load]);

  const reviewed = (item, result) => {
    setNotice(`${OUTCOME_WORDS[result.outcome]}. ${result.notified && item.askedBy ? `${item.askedBy.name} has been notified.` : ''}`.trim());
    // The question leaves the list at once; the lists are read again for the latest reviews and the count
    setData((prev) => prev && { ...prev, waiting: Math.max(prev.waiting - 1, 0), items: prev.items.filter((i) => i.traceId !== item.traceId) });
    load();
    requestAnimationFrame(() => noticeRef.current?.focus());
  };

  const items = data?.items ?? [];
  const oldest = items[0];

  return (
    <div className="min-h-screen bg-gray-50">
      <AppNav title="Assistant Reviews" subtitle="Answers the assistant withheld, and answers people reported" />

      <main id="main" tabIndex={-1} className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8 focus:outline-none">
        <DemoEnvironmentBanner />

        {!staff ? (
          <div className="bg-white rounded-lg shadow-md p-6 text-gray-700">The assistant review queue is available to case managers only.</div>
        ) : (
          <>
            {error && <div role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 wrap-anywhere">{error}</div>}
            <div
              role="status"
              ref={noticeRef}
              tabIndex={-1}
              className={notice ? 'mb-4 rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-800 wrap-anywhere focus:outline-none' : 'sr-only'}
            >
              {notice}
            </div>

            {loading ? (
              <div role="status" className="text-center py-12">
                <div className="inline-block animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600" aria-hidden="true"></div>
                <p className="mt-4 text-gray-600">Loading the review queue...</p>
              </div>
            ) : (
              data && (
                <>
                  <p className="mb-6 max-w-3xl text-gray-700">
                    A case manager reviews each of these before the person sees an answer: the assistant never decides eligibility or a case on its own. You can approve the
                    draft, correct it or decline. The person is notified, sees the result in their history marked as reviewed, and the review is recorded in the audit log.
                    You cannot review a question you asked yourself.
                  </p>

                  <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <StatTile
                      label="Waiting for review"
                      value={data.waiting}
                      tone={data.waiting ? 'text-red-700' : 'text-gray-900'}
                      note="Withheld answers and reported problems"
                    />
                    <StatTile
                      label="Longest wait"
                      value={oldest ? waitedSince(oldest.queuedAt) : '—'}
                      note={oldest ? 'The one waiting longest is listed first' : 'Nothing is waiting'}
                    />
                    <StatTile label="You can review" value={items.filter((i) => !i.own).length} note="Not counting questions you asked yourself" />
                  </div>

                  <div className="space-y-6">
                    {quality && <AnswerQuality quality={quality} />}

                    <section aria-labelledby={waitingId}>
                      <h2 id={waitingId} className="text-xl font-bold text-gray-900">Waiting for review</h2>
                      <p className="mt-1 text-sm text-gray-600">
                        Oldest first, by when each entered the queue (an answer that was reported counts from the report).
                        {data.waiting > items.length ? ` The ${items.length} longest-waiting of ${data.waiting} are listed.` : ''}
                      </p>
                      {items.length === 0 ? (
                        <p className="mt-4 rounded-lg bg-white p-4 text-gray-700 shadow">Nothing is waiting for review.</p>
                      ) : (
                        <ol className="mt-4 space-y-4">
                          {items.map((item) => (
                            <ReviewCard key={item.traceId} item={item} passages={passages} loadPassage={loadPassage} onReviewed={reviewed} onStale={load} />
                          ))}
                        </ol>
                      )}
                    </section>

                    <DashboardSection title="Recently reviewed" hint="The latest ten reviews, newest first.">
                      {data.recentlyReviewed.length === 0 ? (
                        <p className="text-sm text-gray-700">No question has been reviewed yet.</p>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="min-w-full text-sm">
                            <caption className="sr-only">The latest reviews of assistant answers</caption>
                            <thead className="bg-gray-50 text-left text-gray-600">
                              <tr>
                                <th scope="col" className="px-2 py-2 font-medium sm:px-3">Reviewed</th>
                                <th scope="col" className="px-2 py-2 font-medium sm:px-3">Outcome</th>
                                <th scope="col" className="px-2 py-2 font-medium sm:px-3">Reviewed by</th>
                                <th scope="col" className="px-2 py-2 font-medium sm:px-3">Question</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                              {data.recentlyReviewed.map((r) => (
                                <tr key={r.traceId} className="align-top">
                                  <td className="px-2 py-2 text-gray-900 sm:px-3">{formatTime(r.reviewedAt)}</td>
                                  <td className="px-2 py-2 text-gray-900 sm:px-3">
                                    {OUTCOME_WORDS[r.outcome]}
                                    {r.reported ? <span className="block text-gray-600">Reported by the person</span> : null}
                                  </td>
                                  <td className="px-2 py-2 text-gray-900 wrap-anywhere sm:px-3">{r.reviewedBy ?? '—'}</td>
                                  <td className="px-2 py-2 text-gray-900 wrap-anywhere sm:px-3">{r.question}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </DashboardSection>
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
