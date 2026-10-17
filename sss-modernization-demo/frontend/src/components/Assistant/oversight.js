// STORY-019 and 023: how much human oversight an exchange got, in plain words. The words are always shown, so the colour is never the
// only signal; every tone reads at 4.5:1 or better.
export const TONES = {
  green: 'bg-green-50 border-green-300 text-green-900',
  amber: 'bg-amber-50 border-amber-400 text-amber-900',
  blue: 'bg-blue-50 border-blue-300 text-blue-900',
  gray: 'bg-gray-50 border-gray-400 text-gray-800',
};

/** The status of an exchange (a response to a question, or an item of the history): what to tell the person, and in what tone. */
export function oversightOf(item) {
  if (item.status === 'reviewed') return { label: 'Reviewed by a case manager', tone: 'blue', icon: 'person' };
  if (item.status === 'with-staff') return { label: 'A case manager will review this question and reply', tone: 'blue', icon: 'person' };
  if (item.mode === 'passages-only' && item.status === 'shown') {
    return { label: 'AI answers are off in this demo; here are the matching policy sections', tone: 'gray', icon: 'document' };
  }
  if (item.level === 1) return { label: 'Please confirm with a case manager', tone: 'amber', icon: 'warning' };
  return { label: 'Checked against the policy', tone: 'green', icon: 'check' };
}

/** What a case manager did with a reviewed exchange, for the person. */
export const REVIEW_NOTES = {
  approved: 'A case manager checked the draft answer and approved it as it was.',
  corrected: 'A case manager wrote this answer in place of the draft.',
  declined: 'A case manager looked at this question and could not answer it here.',
};

/** Whether a person can still rate the exchange: it has an answer or a note they can see, and no case manager has it. */
export const canRate = (item) => item.status === 'shown' || item.status === 'no-answer';

/** The exchange as the page keeps it, from the response to a question. */
export function fromAsk(response, question) {
  return {
    traceId: response.traceId,
    question,
    mode: response.mode,
    status: response.status,
    level: response.level,
    answer: response.answer,
    citations: response.citations,
    message: response.message,
    sections: response.passages?.map(({ passageId, docTitle, heading }) => ({ passageId, docTitle, heading })),
    feedback: null,
    createdAt: new Date().toISOString(),
    questionRedacted: response.questionRedacted,
  };
}

/** The exchange after a person reported a problem: the answer is withheld again, as when it was asked. */
export function withheld(item) {
  return {
    ...item,
    status: 'with-staff',
    level: 2,
    answer: null,
    citations: [],
    sections: undefined,
    message: 'A case manager will review this question and reply.',
  };
}
