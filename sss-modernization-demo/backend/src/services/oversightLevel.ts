import { GroundingResult } from './groundingCheck';

// STORY-023: how much human oversight an answer needs. The assistant never decides a person's eligibility or case, and never
// shows an answer it could not ground, so those go to a case manager. This file only decides the level; the review queue and the
// page come later.
//   0  a grounded answer, shown
//   1  a grounded answer on thinner ground (one source, or much of it uncited), shown with "check with a case manager"
//   2  withheld for a case manager: not grounded, or a question about the person's own eligibility or case
export type OversightLevel = 0 | 1 | 2;

export type LevelReason = 'ungrounded' | 'personal-question' | 'few-sources' | 'low-coverage' | 'ok';

/** Level 1 when fewer distinct passages than this are cited. */
export const MIN_SOURCES = 2;
/** Level 1 when less of the answer than this sits under a citation. */
export const MIN_COVERAGE = 0.9;

// Simple patterns for a question about the asker's own eligibility or case. A question about the rules in general ("How do I
// appeal a denial?", "Can I open a second case for the same exemption?") is not one: it is answered from the policy.
const PERSONAL_QUESTION: RegExp[] = [
  /\bam i\b/, // "am I eligible", "am I exempt"
  // "will I be approved", "do I qualify", "would my application be accepted"; but not "what proof do I need to be approved"
  /\b(?:will|would|could|can|do|does|did|should|might) (?:i|my (?:case|application|appeal|exemption)) (?:qualify|be eligible|be exempt|be approved|be denied|be accepted|be granted|get approved|get denied|get the exemption)\b/,
  /\bmy (?:own )?(?:case|application|appeal|exemption|eligibility|status|denial|decision|result)\b/,
  /\bwhy (?:was|am|were|did) i\b/,
  /\bi(?:'m| am) \d|\bi (?:make|earn|made|earned) /, // saying one's own age or income is asking for a ruling on it
];

export function isPersonalQuestion(question: string): boolean {
  const text = question.toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, ' ');
  return PERSONAL_QUESTION.some((pattern) => pattern.test(text));
}

export interface LevelDecision {
  level: OversightLevel;
  /** Every reason that applies, for the review queue: both "ungrounded" and "personal-question" can. */
  reasons: LevelReason[];
}

/** The oversight level for an answer to a question, given the result of its grounding check. */
export function levelFor(question: string, grounding: Pick<GroundingResult, 'grounded' | 'coverage' | 'citedPassages'>): LevelDecision {
  const withheld: LevelReason[] = [];
  if (!grounding.grounded) withheld.push('ungrounded');
  if (isPersonalQuestion(question)) withheld.push('personal-question');
  if (withheld.length > 0) return { level: 2, reasons: withheld };

  const thin: LevelReason[] = [];
  if (grounding.citedPassages.length < MIN_SOURCES) thin.push('few-sources');
  if (grounding.coverage < MIN_COVERAGE) thin.push('low-coverage');
  return thin.length > 0 ? { level: 1, reasons: thin } : { level: 0, reasons: ['ok'] };
}
