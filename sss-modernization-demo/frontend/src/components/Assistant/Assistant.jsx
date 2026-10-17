import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { getApiErrorMessage } from '../../utils/apiError';
import { assistantService } from '../../services/assistantService';
import AppNav from '../Common/AppNav';
import DemoEnvironmentBanner from '../DemoEnvironmentBanner';
import Exchange from './Exchange';
import { formatTime } from './format';
import { fromAsk, withheld } from './oversight';
import usePassages from './usePassages';

const QUESTION_MIN = 3;
const QUESTION_MAX = 500;
const EXAMPLES = ['What is the income limit for the Type B exemption?', 'How do I appeal a denial?', 'Is my Social Security number stored in the system?'];

// STORY-019: the policy assistant for citizens and staff. A question, an answer from the synthetic demo policy documents with numbered
// citations that open the passage, how much human oversight it got, feedback, and the person's recent questions.
export default function Assistant() {
  const [question, setQuestion] = useState('');
  const [fieldError, setFieldError] = useState('');
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [history, setHistory] = useState(null); // null until it has been read
  const [historyError, setHistoryError] = useState('');
  const { passages, load, seed } = usePassages();
  const field = useRef(null);
  const answerHeading = useRef(null);
  const focusAnswer = useRef(false);
  const ids = { question: useId(), hint: useId(), count: useId(), error: useId(), answer: useId(), history: useId() };

  const refreshHistory = useCallback(
    () =>
      assistantService
        .history()
        .then((list) => {
          setHistory(list);
          setHistoryError('');
        })
        .catch((err) => setHistoryError(getApiErrorMessage(err, 'Could not load your recent questions.'))),
    []
  );

  useEffect(() => {
    refreshHistory();
  }, [refreshHistory]);

  // The answer takes focus when it arrives, so a screen reader starts reading it and a keyboard user starts at it
  useEffect(() => {
    if (result && focusAnswer.current) {
      focusAnswer.current = false;
      answerHeading.current?.focus();
    }
  }, [result]);

  const ask = async (event) => {
    event.preventDefault();
    if (asking) return;
    const text = question.replace(/\s+/g, ' ').trim();
    if (text.length < QUESTION_MIN) {
      setFieldError(`Please enter a question of at least ${QUESTION_MIN} characters.`);
      field.current?.focus();
      return;
    }
    setFieldError('');
    setError('');
    setAsking(true);
    try {
      const response = await assistantService.ask(text);
      if (response.passages) seed(response.passages);
      focusAnswer.current = true;
      setResult(fromAsk(response, text));
      setQuestion('');
      refreshHistory();
    } catch (err) {
      setError(getApiErrorMessage(err, 'Your question could not be answered. Please try again.'));
    } finally {
      setAsking(false);
    }
  };

  const fillExample = (text) => {
    setQuestion(text);
    setFieldError('');
    field.current?.focus();
  };

  // Feedback changes the exchange where it is shown; a report withholds its answer again, as the server has
  const applyFeedback = (traceId, sent) => {
    const patch = (item) => (item.traceId !== traceId ? item : { ...(sent.queued ? withheld(item) : item), feedback: sent.feedback });
    setResult((prev) => prev && patch(prev));
    setHistory((prev) => prev && prev.map(patch));
    if (sent.queued) refreshHistory();
  };

  const earlier = (history ?? []).filter((item) => item.traceId !== result?.traceId);
  const describedBy = [ids.hint, ids.count, fieldError && ids.error].filter(Boolean).join(' ');

  return (
    <div className="min-h-screen bg-gray-50">
      <AppNav title="Ask about policy" subtitle="Questions about the demo policy documents, answered from those documents" />

      <main id="main" tabIndex={-1} className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8 focus:outline-none">
        <DemoEnvironmentBanner />

        <div className="max-w-3xl">
          <p className="mb-4 text-gray-700">
            Ask about exemptions, documents, appeals or privacy. Answers come only from the demo policy documents, and each is checked against them before you see it.
            The assistant never decides whether you are eligible or what happens to your case: a question about your own case goes to a case manager, who replies here.
            The documents are synthetic and written for this demonstration. They are not Selective Service System policy.
          </p>

          <form onSubmit={ask} noValidate className="bg-white rounded-lg shadow-md p-4 sm:p-6">
            <label htmlFor={ids.question} className="block text-lg font-bold text-gray-900">Your question</label>
            <p id={ids.hint} className="mt-1 text-sm text-gray-600">
              Do not type your Social Security number. If something shaped like one is in your question, it is removed before anything is searched or stored.
            </p>
            <textarea
              id={ids.question}
              ref={field}
              rows={3}
              maxLength={QUESTION_MAX}
              value={question}
              onChange={(event) => {
                setQuestion(event.target.value);
                if (event.target.value.trim().length >= QUESTION_MIN) setFieldError('');
              }}
              aria-invalid={fieldError ? 'true' : undefined}
              aria-describedby={describedBy}
              className="mt-2 w-full rounded-lg border border-gray-500 bg-white px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500 aria-invalid:border-red-700"
            />
            <p id={ids.count} className="mt-1 text-sm text-gray-600">
              {question.length} of {QUESTION_MAX} characters
            </p>
            {fieldError && <p id={ids.error} role="alert" className="mt-1 text-sm text-red-700">{fieldError}</p>}

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                type="submit"
                aria-disabled={asking}
                className="rounded-lg bg-blue-700 px-6 py-2 font-medium text-white hover:bg-blue-800 aria-disabled:opacity-60"
              >
                {asking ? 'Asking...' : 'Ask'}
              </button>
              {asking && (
                <span className="flex items-center gap-2 text-sm text-gray-700" aria-hidden="true">
                  <span className="inline-block h-5 w-5 animate-spin rounded-full border-b-2 border-blue-600" />
                  Looking through the policy documents...
                </span>
              )}
            </div>
            <p role="status" className="sr-only">{asking ? 'Looking through the policy documents...' : ''}</p>

            <div className="mt-4">
              <p className="text-sm font-medium text-gray-900">Or try an example</p>
              <ul className="mt-2 flex flex-wrap gap-2">
                {EXAMPLES.map((text) => (
                  <li key={text}>
                    <button
                      type="button"
                      onClick={() => fillExample(text)}
                      className="rounded-lg border border-gray-500 bg-white px-3 py-1.5 text-left text-sm text-gray-800 hover:bg-gray-50 wrap-anywhere"
                    >
                      {text}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </form>

          {error && <div role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 wrap-anywhere">{error}</div>}

          {result && (
            <section aria-labelledby={ids.answer} className="mt-6 bg-white rounded-lg shadow-md p-4 sm:p-6">
              <h2 id={ids.answer} ref={answerHeading} tabIndex={-1} className="text-xl font-bold text-gray-900 focus:outline-none">Answer</h2>
              <p className="mt-1 text-sm text-gray-700 wrap-anywhere">
                Your question: <span className="font-medium text-gray-900">{result.question}</span>
              </p>
              {result.questionRedacted && (
                <p className="mt-1 text-sm text-gray-700">Something that looked like a Social Security number was removed from your question before it was searched.</p>
              )}
              <div className="mt-3">
                <Exchange key={result.traceId} item={result} passages={passages} loadPassage={load} onFeedback={applyFeedback} />
              </div>
            </section>
          )}

          <section aria-labelledby={ids.history} className="mt-8">
            <h2 id={ids.history} className="text-xl font-bold text-gray-900">Your recent questions</h2>
            <p className="mt-1 text-sm text-gray-600">Your last 20 questions, newest first. Only you can see them, and the case managers who review a question you ask.</p>
            {historyError && <div role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 wrap-anywhere">{historyError}</div>}
            {history === null && !historyError ? (
              <p className="mt-4 text-gray-600">Loading your recent questions...</p>
            ) : earlier.length === 0 && !historyError ? (
              <p className="mt-4 text-gray-700">{result ? 'Nothing else yet.' : 'You have not asked anything yet.'}</p>
            ) : (
              <ol className="mt-4 space-y-4">
                {earlier.map((item) => (
                  <li key={item.traceId} className="rounded-lg bg-white p-4 shadow sm:p-5">
                    <h3 className="font-semibold text-gray-900 wrap-anywhere">{item.question}</h3>
                    <p className="mb-3 text-sm text-gray-600">Asked {formatTime(item.createdAt)}</p>
                    <Exchange item={item} passages={passages} loadPassage={load} onFeedback={applyFeedback} citationsAs="h4" inHistory />
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
