import DashboardSection from '../Dashboard/DashboardSection';

// How a window reads against the target. The words differ as well as the colour, so the result is never told by colour alone.
const verdict = (rate, target) => (rate === null ? ['No answers yet', 'text-gray-700'] : rate >= target ? ['At or over the target', 'text-red-700'] : ['Under the target', 'text-green-700']);

/**
 * STORY-022: the share of assistant answers that failed the grounding check over 7 and 30 days, against the target below 2%, with the
 * alert when a window reaches it. `quality` is what GET /api/assistant/quality returns (case managers and admins).
 */
export default function AnswerQuality({ quality }) {
  const { target, windows, alert, alertMessage, usage, corpus } = quality;
  const anyAnswers = windows.some((w) => w.rate !== null);
  return (
    <DashboardSection
      title="Answer quality"
      hint={`Every answer is checked: each statement needs a citation, and each number, date or amount must appear in a cited passage. An answer that fails is withheld and waits below. The target is a failure rate below ${target}%.`}
    >
      {alert ? (
        <div role="alert" className="mb-4 rounded-lg border border-red-300 bg-red-50 p-4 text-red-800">
          <p className="font-semibold">Over the target</p>
          <p className="text-sm wrap-anywhere">{alertMessage}</p>
        </div>
      ) : anyAnswers ? (
        <div role="status" className="mb-4 rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-800">
          On target: fewer than {target} in 100 answers failed the check.
        </div>
      ) : (
        <p className="mb-4 text-sm text-gray-700">No answers have been checked yet.</p>
      )}
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <caption className="sr-only">Answers checked and answers that failed the grounding check</caption>
          <thead className="bg-gray-50 text-left text-gray-600">
            <tr>
              <th scope="col" className="px-2 py-2 font-medium sm:px-3">Period</th>
              <th scope="col" className="px-2 py-2 text-right font-medium sm:px-3">Answers checked</th>
              <th scope="col" className="px-2 py-2 text-right font-medium sm:px-3">Failed the check</th>
              <th scope="col" className="px-2 py-2 text-right font-medium sm:px-3">Failure rate</th>
              <th scope="col" className="px-2 py-2 font-medium sm:px-3">Against the {target}% target</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {windows.map((w) => {
              const [words, tone] = verdict(w.rate, target);
              return (
                <tr key={w.days}>
                  <th scope="row" className="px-2 py-2 text-left font-normal text-gray-900 sm:px-3">Last {w.days} days</th>
                  <td className="px-2 py-2 text-right tabular-nums text-gray-900 sm:px-3">{w.answers}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-gray-900 sm:px-3">{w.ungrounded}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-gray-900 sm:px-3">{w.rate === null ? '—' : `${w.rate}%`}</td>
                  <td className={`px-2 py-2 font-medium sm:px-3 ${tone}`}>{words}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-sm text-gray-600 wrap-anywhere">
        AI answers generated today: {usage.generatedToday} of {usage.dailyLimit}. Policy documents: {corpus.documents} documents, {corpus.passages} passages
        {corpus.version ? `, version ${corpus.version}` : ''}.
      </p>
    </DashboardSection>
  );
}
