import { useEffect, useId, useRef, useState } from 'react';
import { assistantService } from '../../services/assistantService';
import { getApiErrorMessage } from '../../utils/apiError';

const COMMENT_MAX = 500;
const button = 'rounded-lg border px-3 py-2 text-sm font-medium aria-disabled:opacity-60';
const plain = `${button} border-gray-500 bg-white text-gray-800 hover:bg-gray-50`;
// The rating the person gave, shown pressed. Pressed is also said to assistive technology (aria-pressed), so it is not colour alone.
const pressed = `${button} border-blue-800 bg-blue-800 text-white hover:bg-blue-900`;

/**
 * STORY-019: Helpful, Not helpful and Report a problem, on an answer the person can see. Helpful is sent at once. The other two open
 * a form for an optional comment (the field takes focus; Cancel gives it back to the button). A reported problem sends the exchange to
 * a case manager and withholds the answer again. `onSent(result)` gets the server's answer: { feedback, status, queued, message }.
 */
export default function Feedback({ item, onSent }) {
  const labelId = useId();
  const commentId = useId();
  const hintId = useId();
  const [form, setForm] = useState(null); // 'not-helpful' or 'problem' while the comment form is open
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const field = useRef(null);
  const opener = useRef(null);

  // Focus moves into the form when it opens
  useEffect(() => {
    if (form) field.current?.focus();
  }, [form]);

  // A busy button stays focusable (aria-disabled, not disabled), so keyboard focus is not lost while the feedback is sent
  const send = async (rating, text) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await assistantService.feedback(item.traceId, rating, text.trim() || undefined);
      setForm(null);
      setComment('');
      onSent(result);
    } catch (err) {
      setError(getApiErrorMessage(err, 'Your feedback could not be sent. Please try again.'));
    } finally {
      setBusy(false);
    }
  };

  const openForm = (rating) => (event) => {
    if (busy) return;
    opener.current = event.currentTarget;
    setError('');
    setForm(rating);
  };

  const cancel = () => {
    if (busy) return;
    setForm(null);
    setComment('');
    setError('');
    opener.current?.focus();
  };

  const problem = form === 'problem';
  return (
    <div role="group" aria-labelledby={labelId} className="mt-4 border-t border-gray-200 pt-3">
      <p id={labelId} className="text-sm font-medium text-gray-900">
        {item.answer ? 'Was this answer useful?' : item.sections?.length ? 'Were these policy sections useful?' : 'Was this useful?'}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" aria-pressed={item.feedback === 'helpful'} aria-disabled={busy} onClick={() => send('helpful', '')} className={item.feedback === 'helpful' ? pressed : plain}>
          Helpful
        </button>
        <button type="button" aria-pressed={item.feedback === 'not-helpful'} aria-expanded={form === 'not-helpful'} aria-disabled={busy} onClick={openForm('not-helpful')} className={item.feedback === 'not-helpful' ? pressed : plain}>
          Not helpful
        </button>
        <button type="button" aria-expanded={problem} aria-disabled={busy} onClick={openForm('problem')} className={plain}>
          Report a problem
        </button>
      </div>

      {form && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            send(form, comment);
          }}
          className="mt-3 space-y-2"
        >
          <label htmlFor={commentId} className="block text-sm font-medium text-gray-900">
            {problem ? 'What is wrong with this answer? (optional)' : 'What was missing or unclear? (optional)'}
          </label>
          <textarea
            id={commentId}
            ref={field}
            rows={3}
            maxLength={COMMENT_MAX}
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            aria-describedby={hintId}
            className="w-full rounded-lg border border-gray-500 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
          />
          <p id={hintId} className="text-sm text-gray-600">
            {comment.length} of {COMMENT_MAX} characters.{' '}
            {problem ? 'A case manager will review this answer and reply. ' : ''}
            Do not type your Social Security number; it is removed if you do.
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="submit" aria-disabled={busy} className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 aria-disabled:opacity-60">
              {busy ? 'Sending...' : problem ? 'Send report' : 'Send feedback'}
            </button>
            <button type="button" onClick={cancel} aria-disabled={busy} className={plain}>Cancel</button>
          </div>
        </form>
      )}
      {error && <p role="alert" className="mt-2 text-sm text-red-700 wrap-anywhere">{error}</p>}
    </div>
  );
}
