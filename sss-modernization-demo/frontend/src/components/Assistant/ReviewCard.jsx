import { useId, useRef, useState } from 'react';
import { assistantService } from '../../services/assistantService';
import { getApiErrorMessage } from '../../utils/apiError';
import Citations from './Citations';
import { formatTime, waitedSince } from './format';

const ANSWER_MAX = 2000;
const NOTE_MAX = 1000;
const DECLINE_REASON = 'Please contact a case manager directly about this question.';

const OUTCOMES = [
  { value: 'approved', label: 'Approve the draft', needsDraft: true },
  { value: 'corrected', label: 'Correct the answer' },
  { value: 'declined', label: 'Decline to answer' },
];

// Where a draft came from, for the reviewer
const draftSource = ({ mode, model }) =>
  mode === 'ai' ? `Drafted by ${model ?? 'the AI model'}.` : mode === 'stub' ? 'Drafted by the test stand-in. No AI model was called.' : 'No AI draft: only the policy passages were returned.';

// What the grounding check found wrong, in plain words
const PROBLEMS = {
  'uncited-sentence': 'A sentence with no citation',
  'unsupported-number': 'A number or date that no cited passage contains',
  'invalid-citation': 'A citation that does not hold up',
  'empty-answer': 'An empty answer',
};

function Grounding({ grounding }) {
  if (!grounding) return <p className="mt-2 text-sm text-gray-700">There is no grounding check result: no answer was made.</p>;
  return (
    <div className="mt-2 text-sm">
      <p className={`font-medium ${grounding.grounded ? 'text-green-800' : 'text-red-800'}`}>
        Grounding check: {grounding.grounded ? 'passed' : 'failed'}.{' '}
        <span className="font-normal text-gray-700">{Math.round(grounding.coverage * 100)}% of the answer sits under a citation.</span>
      </p>
      {grounding.unsupported.length > 0 && (
        <ul className="mt-1 list-disc space-y-1 pl-5 text-gray-800">
          {grounding.unsupported.map((u, i) => (
            <li key={`${u.type}-${i}`} className="wrap-anywhere">
              {PROBLEMS[u.type] ?? u.type}
              {u.text ? `: ${u.text}` : ''}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * STORY-023: one exchange waiting for a case manager, with what is needed to decide it (the question, the draft and its citations, the
 * grounding result, why it is here) and the review form: approve, correct or decline, with a note for the record. Not for the reviewer's own
 * question: another case manager reviews that.
 */
export default function ReviewCard({ item, passages, loadPassage, onReviewed, onStale }) {
  const titleId = useId();
  const ids = { outcome: useId(), answer: useId(), note: useId() };
  const [outcome, setOutcome] = useState('');
  const [answer, setAnswer] = useState('');
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState({});
  const [failure, setFailure] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(() => new Set());
  const outcomeField = useRef(null);
  const answerField = useRef(null);
  const noteField = useRef(null);
  const reported = item.reasons.some((r) => r.code === 'reported');
  const hasDraft = Boolean(item.draft.answer);
  const asker = item.askedBy ? `${item.askedBy.name} (${item.askedBy.email})` : 'a person whose account no longer exists';

  const toggle = (i) => {
    if (!open.has(i)) loadPassage(item.draft.citations[i].passageId);
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  const submit = async (event) => {
    event.preventDefault();
    if (busy) return;
    const found = {};
    if (!outcome) found.outcome = 'Choose what you are doing with this answer.';
    if (outcome === 'approved' && !hasDraft) found.outcome = 'There is no draft to approve. Correct the answer or decline.';
    if (outcome === 'corrected' && !answer.trim()) found.answer = 'Write the answer the person will see.';
    if (!note.trim()) found.note = 'Write a note for the record: why you made this choice.';
    setErrors(found);
    setFailure('');
    const first = ['outcome', 'answer', 'note'].find((name) => found[name]);
    if (first) {
      ({ outcome: outcomeField, answer: answerField, note: noteField })[first].current?.focus();
      return;
    }
    setBusy(true);
    try {
      const result = await assistantService.review(item.traceId, {
        outcome,
        answer: outcome === 'approved' ? undefined : answer.trim() || undefined,
        note: note.trim(),
      });
      onReviewed(item, result);
    } catch (err) {
      setFailure(getApiErrorMessage(err, 'The review could not be sent. Please try again.'));
      if (err.response?.status === 409) onStale();
    } finally {
      setBusy(false);
    }
  };

  // Like the sign-in and registration forms, a field's error goes away as soon as the field is changed
  const change = (name, set) => (e) => {
    set(e.target.value);
    if (errors[name]) setErrors((prev) => ({ ...prev, [name]: '' }));
  };

  const describe = (name) => [errors[name] && `${ids[name]}-error`].filter(Boolean).join(' ') || undefined;

  return (
    <li className="rounded-lg bg-white p-4 shadow-md sm:p-6">
      <article aria-labelledby={titleId}>
        <h3 id={titleId} className="text-lg font-semibold text-gray-900 wrap-anywhere">{item.question}</h3>
        <p className="mt-1 text-sm text-gray-600 wrap-anywhere">
          Asked by {asker}. In the queue since {formatTime(item.queuedAt)} (waiting {waitedSince(item.queuedAt)}).
        </p>

        <h4 className="mt-4 text-sm font-semibold text-gray-900">Why it is here</h4>
        <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-gray-800">
          {item.reasons.map((r) => (
            <li key={r.code} className="wrap-anywhere">{r.text}</li>
          ))}
        </ul>
        {item.reportComment && (
          <p className="mt-2 text-sm text-gray-800 wrap-anywhere">
            They wrote: <q>{item.reportComment}</q>
          </p>
        )}

        <h4 className="mt-4 text-sm font-semibold text-gray-900">{reported ? 'The answer they were shown' : 'Draft answer (the person has not seen it)'}</h4>
        {hasDraft ? (
          <p className="mt-1 whitespace-pre-line rounded-lg border border-gray-400 bg-gray-50 p-3 text-gray-900 wrap-anywhere">{item.draft.answer}</p>
        ) : (
          <p className="mt-1 text-sm text-gray-800">{item.draft.note}</p>
        )}
        <p className="mt-1 text-sm text-gray-600">
          {draftSource(item.draft)}
        </p>
        <Grounding grounding={item.grounding} />
        <Citations base={`${titleId}-c`} label="Citations in the draft" items={item.draft.citations} open={open} onToggle={toggle} passages={passages} as="h4" />

        {item.own ? (
          <p className="mt-4 rounded-lg border border-blue-300 bg-blue-50 p-3 text-sm text-blue-900">
            You asked this question yourself, so another case manager has to review it.
          </p>
        ) : (
          <form onSubmit={submit} noValidate className="mt-4 border-t border-gray-200 pt-4">
            <div>
              <label htmlFor={ids.outcome} className="block text-sm font-semibold text-gray-900">Your review</label>
              <select
                id={ids.outcome}
                ref={outcomeField}
                value={outcome}
                onChange={change('outcome', setOutcome)}
                aria-invalid={errors.outcome ? 'true' : undefined}
                aria-describedby={[`${ids.outcome}-hint`, describe('outcome')].filter(Boolean).join(' ')}
                className="mt-1 w-full rounded-lg border border-gray-500 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 aria-invalid:border-red-700 sm:w-auto"
              >
                <option value="">Choose what to do with this answer</option>
                {OUTCOMES.map((o) => (
                  <option key={o.value} value={o.value} disabled={o.needsDraft && !hasDraft}>
                    {o.label}
                    {o.needsDraft && !hasDraft ? ' (there is no draft)' : ''}
                  </option>
                ))}
              </select>
              <p id={`${ids.outcome}-hint`} className="mt-1 text-sm text-gray-600">
                Approve sends the person the draft as it is. Correct sends them your answer instead. Decline tells them a case manager reviewed the question and could not answer it here.
              </p>
              {errors.outcome && <p id={`${ids.outcome}-error`} role="alert" className="mt-1 text-sm text-red-700">{errors.outcome}</p>}
            </div>

            {(outcome === 'corrected' || outcome === 'declined') && (
              <div className="mt-3">
                <label htmlFor={ids.answer} className="block text-sm font-medium text-gray-900">
                  {outcome === 'corrected' ? 'The answer the person will see' : 'Message to the person (optional)'}
                </label>
                <textarea
                  id={ids.answer}
                  ref={answerField}
                  rows={4}
                  maxLength={ANSWER_MAX}
                  value={answer}
                  onChange={change('answer', setAnswer)}
                  aria-invalid={errors.answer ? 'true' : undefined}
                  aria-describedby={[`${ids.answer}-hint`, describe('answer')].filter(Boolean).join(' ')}
                  className="mt-1 w-full rounded-lg border border-gray-500 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 aria-invalid:border-red-700"
                />
                <p id={`${ids.answer}-hint`} className="text-sm text-gray-600">
                  {answer.length} of {ANSWER_MAX} characters.{' '}
                  {outcome === 'declined' ? `If you leave this empty they are told: ${DECLINE_REASON}` : 'It replaces the draft, and they are notified.'} Social Security numbers are removed.
                </p>
                {errors.answer && <p id={`${ids.answer}-error`} role="alert" className="mt-1 text-sm text-red-700">{errors.answer}</p>}
              </div>
            )}

            <div className="mt-3">
              <label htmlFor={ids.note} className="block text-sm font-medium text-gray-900">Note for the record (required)</label>
              <textarea
                id={ids.note}
                ref={noteField}
                rows={2}
                maxLength={NOTE_MAX}
                value={note}
                onChange={change('note', setNote)}
                aria-invalid={errors.note ? 'true' : undefined}
                aria-describedby={[`${ids.note}-hint`, describe('note')].filter(Boolean).join(' ')}
                className="mt-1 w-full rounded-lg border border-gray-500 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 aria-invalid:border-red-700"
              />
              <p id={`${ids.note}-hint`} className="text-sm text-gray-600">
                Why you made this choice. It goes in the audit log; the person does not see it.
              </p>
              {errors.note && <p id={`${ids.note}-error`} role="alert" className="mt-1 text-sm text-red-700">{errors.note}</p>}
            </div>

            {failure && <p role="alert" className="mt-3 text-sm text-red-700 wrap-anywhere">{failure}</p>}
            <button
              type="submit"
              aria-disabled={busy}
              className="mt-4 rounded-lg bg-blue-700 px-5 py-2 text-sm font-medium text-white hover:bg-blue-800 aria-disabled:opacity-60"
            >
              {busy ? 'Sending...' : 'Send review'}
            </button>
          </form>
        )}
      </article>
    </li>
  );
}
