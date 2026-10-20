import { useId, useRef, useState } from 'react';
import Citations from './Citations';
import Feedback from './Feedback';
import { formatTime, sourceButtonId, sourceName } from './format';
import { REVIEW_NOTES, TONES, canRate, oversightOf } from './oversight';

const ICONS = {
  check: (
    <>
      <circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M6 10.5l2.5 2.5L14 7.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  warning: (
    <>
      <path d="M10 3l8 14H2L10 3z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <path d="M10 8v4M10 14.5v.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </>
  ),
  person: (
    <>
      <circle cx="10" cy="6.5" r="3" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M3.5 17c.5-3.5 3-5 6.5-5s6 1.5 6.5 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </>
  ),
  document: (
    <>
      <path d="M5 2.5h7l3.5 3.5V17.5H5z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <path d="M8 10h5M8 13.5h5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </>
  ),
};

/** How much human oversight the exchange got, in words, with a shape that repeats them (never colour alone). */
export function OversightStatus({ item }) {
  const { label, tone, icon } = oversightOf(item);
  return (
    <p className={`inline-flex items-start gap-2 rounded-lg border px-3 py-2 text-sm font-medium ${TONES[tone]}`}>
      <svg viewBox="0 0 20 20" className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true">{ICONS[icon]}</svg>
      <span className="wrap-anywhere">{label}</span>
    </p>
  );
}

// The same words with or without the full stop at the end: the status says it, so the message need not say it again
const sameWords = (a, b) => a.replace(/[.\s]+$/, '') === b.replace(/[.\s]+$/, '');

const toggled = (set, index) => {
  const next = new Set(set);
  if (next.has(index)) next.delete(index);
  else next.add(index);
  return next;
};

/**
 * STORY-019 and 023: everything about one exchange but its question: the oversight status in words, the answer with numbered
 * citations that open the policy passage, the sections it matched when AI is off, and the feedback controls. The numbers in the answer
 * open the passage and move focus to its button. `passages` and `loadPassage` come from usePassages(); `onFeedback(traceId, result)` is told when feedback was sent.
 * `inHistory` is for an exchange listed under the person's recent questions, not shown as the answer to the question just asked.
 */
export default function Exchange({ item, passages, loadPassage, onFeedback, citationsAs = 'h3', inHistory = false }) {
  const base = useId();
  const citationBase = `${base}-c`;
  const [openCitations, setOpenCitations] = useState(() => new Set());
  const [openSections, setOpenSections] = useState(() => new Set());
  const [notice, setNotice] = useState('');
  const noticeRef = useRef(null);
  const citations = item.citations ?? [];
  const sections = item.sections ?? [];

  const toggleCitation = (i) => {
    if (!openCitations.has(i)) loadPassage(citations[i].passageId);
    setOpenCitations((prev) => toggled(prev, i));
  };
  const toggleSection = (i) => {
    if (!openSections.has(i)) loadPassage(sections[i].passageId);
    setOpenSections((prev) => toggled(prev, i));
  };
  // A number in the answer opens its passage and puts focus on the button that closes it again
  const reveal = (i) => {
    loadPassage(citations[i].passageId);
    setOpenCitations((prev) => new Set(prev).add(i));
    requestAnimationFrame(() => document.getElementById(sourceButtonId(citationBase, i))?.focus());
  };

  const sent = (result) => {
    setNotice(result.message);
    onFeedback(item.traceId, result);
    // A report withholds the answer again and takes the feedback controls away, so focus goes to the confirmation instead of being lost
    if (result.queued) requestAnimationFrame(() => noticeRef.current?.focus());
  };
  const feedback = canRate(item) && <Feedback item={item} onSent={sent} />;

  return (
    <div>
      <OversightStatus item={item} />
      {item.reviewed && (
        <p className="mt-2 text-sm text-gray-700 wrap-anywhere">
          {REVIEW_NOTES[item.reviewed.outcome]} Reviewed {formatTime(item.reviewed.at)}.
        </p>
      )}
      {item.message && !sameWords(item.message, oversightOf(item).label) && (
        <p className="mt-3 text-gray-800 wrap-anywhere">{item.message}</p>
      )}
      {item.status === 'with-staff' && (
        <p className="mt-3 text-gray-800">
          {inHistory ? 'You will see their reply here, and in your notifications.' : 'You will see their reply in your recent questions below, and in your notifications.'}
        </p>
      )}
      {item.answer && (
        <p className="mt-3 whitespace-pre-line text-gray-900 wrap-anywhere">
          {item.answer}
          {citations.map((c, i) => (
            <button
              key={`${c.passageId}-${i}`}
              type="button"
              onClick={() => reveal(i)}
              className="ml-1 rounded px-0.5 align-baseline font-semibold text-blue-700 underline hover:text-blue-900"
            >
              [{i + 1}]
              <span className="sr-only"> source {i + 1}: {sourceName(c)}. Opens the policy passage</span>
            </button>
          ))}
        </p>
      )}
      <Citations base={citationBase} label="Sources" items={citations} open={openCitations} onToggle={toggleCitation} passages={passages} as={citationsAs} />
      <Citations base={`${base}-s`} label="Matching policy sections" items={sections} open={openSections} onToggle={toggleSection} passages={passages} as={citationsAs} />
      {item.feedback === 'problem' && <p className="mt-3 text-sm text-gray-700">You reported a problem with this answer.</p>}
      {feedback}
      <p role="status" ref={noticeRef} tabIndex={-1} className={notice ? 'mt-2 text-sm text-green-800 wrap-anywhere' : 'sr-only'}>{notice}</p>
    </div>
  );
}
