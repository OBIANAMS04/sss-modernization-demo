import pool from '../database/connection';
import { AppError, ValidationError } from '../utils/errors';
import { Role } from './roleService';

/**
 * STORY-035: the staff training portal. One module per kind of work (case work, administration, leadership), each with short
 * sections, screens of the real pages and a knowledge check of four questions. The answers stay on the server: the page gets the
 * questions and options, the server grades an attempt and records it, so a pass cannot be claimed from the browser. Three of four
 * right is a pass. A module's version goes up when its content changes, and a pass of an older version no longer counts.
 *
 * Who takes what: case managers take case work; administrators take case work and administration (they do case work too);
 * leadership takes leadership. Citizens have no training.
 */

interface Question {
  id: string;
  prompt: string;
  options: string[];
  correct: number;
  /** Shown after an attempt, whatever the answer, so the person learns the rule. */
  explanation: string;
}

interface Section {
  heading: string;
  body: string;
  image?: { src: string; alt: string };
}

interface Module {
  id: string;
  version: number;
  title: string;
  summary: string;
  minutes: number;
  sections: Section[];
  questions: Question[];
}

export const PASS_MARK = 3;

const MODULES: Module[] = [
  {
    id: 'case-work',
    version: 1,
    title: 'Case work',
    summary: 'Your queue, deciding a case, compliance reviews and the policy assistant reviews.',
    minutes: 10,
    sections: [
      {
        heading: 'Start from My Work',
        body: 'My Work lists your open cases, the cases waiting on you (to start, to decide, and other managers\' decisions to review), the unassigned queue and overdue cases: any case with no update for more than 5 days. The search opens Case Management already filtered.',
        image: { src: '/training/my-work.png', alt: 'My Work: open cases, waiting on me, overdue, unassigned queue and search' },
      },
      {
        heading: 'Deciding a case',
        body: 'A case moves from Submitted to In Review to Approved or Denied. A denial needs a reason, and the applicant sees it on their timeline with a way to appeal. Every decision is checked at once against eight compliance controls.',
        image: { src: '/training/case-queue.png', alt: 'Case Management queue with status counts and filters' },
      },
      {
        heading: 'When a decision fails a control',
        body: 'A failed control opens a review. A different case manager resolves it, never the one who decided: they accept the exception with a justification (recorded as an override) or reopen the case.',
        image: { src: '/training/second-review.png', alt: 'An open compliance review waiting for a second case manager' },
      },
      {
        heading: 'Assistant Reviews',
        body: 'The policy assistant never decides eligibility. Questions about a person\'s own case, answers that fail the grounding check and answers people report come to Assistant Reviews. You approve, correct or decline with a note, and the person is notified. You cannot review a question you asked yourself.',
        image: { src: '/training/review-queue.png', alt: 'Assistant Reviews queue with a reported answer and a withheld personal question' },
      },
    ],
    questions: [
      {
        id: 'cw1',
        prompt: 'You deny an application. What must you provide?',
        options: ['Nothing; the status is enough', 'A reason, which the applicant sees and can appeal', 'An administrator\'s approval first', 'A supporting document upload'],
        correct: 1,
        explanation: 'Every denial needs a reason; the applicant sees it on their timeline and can appeal.',
      },
      {
        id: 'cw2',
        prompt: 'Your decision fails a compliance control. Who resolves the review it opens?',
        options: ['You, since it is your case', 'A different case manager', 'The applicant', 'Nobody; the system closes it after a day'],
        correct: 1,
        explanation: 'Separation of duties: a different case manager accepts the exception with a justification or reopens the case.',
      },
      {
        id: 'cw3',
        prompt: 'Someone asks the policy assistant about their own case. What happens?',
        options: ['The assistant decides their eligibility', 'The question goes to Assistant Reviews for a case manager', 'The question is deleted', 'The assistant answers and closes the case'],
        correct: 1,
        explanation: 'The assistant never decides eligibility; personal-case questions are withheld and go to a case manager.',
      },
      {
        id: 'cw4',
        prompt: 'Where does a case with no update for more than 5 days appear?',
        options: ['Under Overdue in My Work', 'It is closed automatically', 'Only in the audit log', 'Nowhere until the applicant asks'],
        correct: 0,
        explanation: 'More than 5 days without an update makes a case overdue, listed in My Work.',
      },
    ],
  },
  {
    id: 'administration',
    version: 1,
    title: 'Administration',
    summary: 'Giving access, access policies, AI quality runs, observability and the audit log.',
    minutes: 10,
    sections: [
      {
        heading: 'Staff Access',
        body: 'Administrators give or remove case manager, leadership and administrator access, always with a reason that is recorded with the change. You can never change your own access, remove the last case manager or remove the last administrator. The person is notified.',
        image: { src: '/training/staff-access.png', alt: 'Staff Access page listing staff, with the form to give access and a reason' },
      },
      {
        heading: 'Access Policies',
        body: 'Every API request is decided by the access policy before any route runs. Here you switch rules off or narrow routes without a deploy, with a reason; each change makes a new, write-once version and applies at once. A policy can only narrow what the code allows; it can never widen it.',
        image: { src: '/training/access-policies.png', alt: 'Access Policies page with rules to switch and routes to narrow' },
      },
      {
        heading: 'AI Quality',
        body: 'Quality signals compare the last 7 days with the 28 before and raise drift alerts. You can start an evaluation run against the real model at most once an hour (it costs money and is audited) and mark a good run as the baseline.',
        image: { src: '/training/drift-signals.png', alt: 'AI Quality signals with drift flagged' },
      },
      {
        heading: 'Observability',
        body: 'Service objectives (availability, latency, errors, AI spend, drift and fairness) are checked every minute. A breach opens an alert that links to its runbook entry; the alert closes by itself when the objective recovers.',
        image: { src: '/training/observability.png', alt: 'Observability page with open alerts linked to the runbook' },
      },
    ],
    questions: [
      {
        id: 'ad1',
        prompt: 'What does giving someone case manager access require?',
        options: ['Nothing; it applies at once', 'A reason, recorded with the change in the audit log', 'A restart of the API', 'The person\'s password'],
        correct: 1,
        explanation: 'Every grant or removal needs a reason and is recorded in the same transaction as the change.',
      },
      {
        id: 'ad2',
        prompt: 'What can an Access Policies change do?',
        options: ['Give citizens staff pages', 'Narrow what the code allows, never widen it', 'Turn off sign-in for everyone', 'Change a person\'s role'],
        correct: 1,
        explanation: 'The policy is a first layer that can only refuse more; the route guards stay as a second layer.',
      },
      {
        id: 'ad3',
        prompt: 'How often can you start an evaluation run against the real model?',
        options: ['As often as you like', 'At most once an hour', 'Once a day at midnight', 'Only leadership can start one'],
        correct: 1,
        explanation: 'At most one run of a kind in any hour, counted under a lock; each run is audited and costs money.',
      },
      {
        id: 'ad4',
        prompt: 'An objective is breached and an alert opens. What happens next?',
        options: ['Someone must close it by hand', 'It links to its runbook entry and closes by itself when the objective recovers', 'The API restarts', 'Nothing until the next deploy'],
        correct: 1,
        explanation: 'Alerts carry a runbook link and clear on their own once the objective is met again.',
      },
    ],
  },
  {
    id: 'leadership',
    version: 1,
    title: 'Leadership',
    summary: 'Reading the leadership dashboard: KPIs, trends, bottlenecks and the override rate.',
    minutes: 6,
    sections: [
      {
        heading: 'What the dashboard shows',
        body: 'Total applications, approval rate, average processing time, open cases and appeal rate, with 12-week trends. It shows aggregates only: no applicant names or records. Leadership reads the numbers and does no case work.',
        image: { src: '/training/leadership-dashboard.png', alt: 'Leadership dashboard with KPIs, 12-week trends and bottlenecks' },
      },
      {
        heading: 'Bottlenecks',
        body: 'Each stage shows its average days and how many cases are stuck there for more than 5 days, so you can see where work piles up.',
      },
      {
        heading: 'Override rate',
        body: 'How often staff went against what the system said: corrected assistant answers, accepted compliance exceptions and decisions against the automatic eligibility result. The target is below 20%, with a 12-week trend.',
        image: { src: '/training/override-rate.png', alt: 'Override rate with its weekly trend against the 20% target' },
      },
    ],
    questions: [
      {
        id: 'ld1',
        prompt: 'What does the leadership dashboard show about applicants?',
        options: ['Names and case details', 'Aggregates only, no applicant records', 'Social Security numbers, masked', 'Each applicant\'s eligibility'],
        correct: 1,
        explanation: 'Leadership sees aggregates only; no applicant data reaches the dashboard.',
      },
      {
        id: 'ld2',
        prompt: 'What is the target for the override rate?',
        options: ['Below 2%', 'Below 20%', 'Above 50%', 'Exactly 99%'],
        correct: 1,
        explanation: 'Below 20%, shown with a 12-week trend.',
      },
      {
        id: 'ld3',
        prompt: 'A bottleneck counts cases stuck in a stage for more than how long?',
        options: ['1 day', '5 days', '30 days', '90 days'],
        correct: 1,
        explanation: 'More than 5 days in a stage counts as stuck.',
      },
      {
        id: 'ld4',
        prompt: 'Can leadership decide a case?',
        options: ['Yes, from the dashboard', 'No; leadership reads aggregates and does no case work', 'Only appeals', 'Only after training'],
        correct: 1,
        explanation: 'Leadership is not staff: it reads aggregates only.',
      },
    ],
  },
];

const REQUIRED: Record<Role, string[]> = {
  citizen: [],
  case_manager: ['case-work'],
  admin: ['case-work', 'administration'],
  leadership: ['leadership'],
};

export const requiredModules = (role: Role | null | undefined): string[] => (role ? REQUIRED[role] ?? [] : []);

/** A module as the page sees it: everything but the answers. */
function publicModule(m: Module) {
  return {
    id: m.id,
    version: m.version,
    title: m.title,
    summary: m.summary,
    minutes: m.minutes,
    sections: m.sections,
    questions: m.questions.map((q) => ({ id: q.id, prompt: q.prompt, options: q.options })),
  };
}

function moduleFor(role: Role, moduleId: string): Module {
  const module = MODULES.find((m) => m.id === moduleId);
  if (!module || !requiredModules(role).includes(moduleId)) {
    throw new AppError(404, 'There is no such training module for your role.', 'NOT_FOUND');
  }
  return module;
}

export interface ModuleStatus {
  moduleId: string;
  version: number;
  passed: boolean;
  passedAt: string | null;
  bestScore: number | null;
  attempts: number;
}

/** Per module of the current version: passed or not, when, best score and attempts. */
async function statusOf(userIds: string[]): Promise<Map<string, ModuleStatus[]>> {
  const rows = userIds.length
    ? (
        await pool.query(
          `SELECT user_id, module_id, module_version, COUNT(*)::int AS attempts, MAX(score)::int AS best,
                  MIN(created_at) FILTER (WHERE passed) AS passed_at
           FROM training_attempts WHERE user_id = ANY($1::uuid[]) GROUP BY user_id, module_id, module_version`,
          [userIds]
        )
      ).rows
    : [];
  const out = new Map<string, ModuleStatus[]>();
  for (const m of MODULES) {
    for (const id of userIds) {
      const row = rows.find((r: any) => r.user_id === id && r.module_id === m.id && r.module_version === m.version);
      const list = out.get(id) ?? [];
      list.push({
        moduleId: m.id,
        version: m.version,
        passed: !!row?.passed_at,
        passedAt: row?.passed_at ? new Date(row.passed_at).toISOString() : null,
        bestScore: row?.best ?? null,
        attempts: row?.attempts ?? 0,
      });
      out.set(id, list);
    }
  }
  return out;
}

/** The caller's modules (without answers) and where they stand. Citizens have none. */
export async function getTraining(userId: string, role: Role) {
  const ids = requiredModules(role);
  if (ids.length === 0) throw new AppError(403, 'Training is for staff and leadership.', 'FORBIDDEN');
  const status = (await statusOf([userId])).get(userId) ?? [];
  return {
    passMark: PASS_MARK,
    modules: MODULES.filter((m) => ids.includes(m.id)).map((m) => ({ ...publicModule(m), status: status.find((s) => s.moduleId === m.id) })),
  };
}

/** Grades an attempt on the server and records it. Every question must be answered with one of its options. */
export async function submitAttempt(userId: string, role: Role, moduleId: string, answers: unknown) {
  const module = moduleFor(role, moduleId);
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) {
    throw new ValidationError('Answer every question.');
  }
  const given = answers as Record<string, unknown>;
  const results = module.questions.map((q) => {
    const choice = given[q.id];
    if (!Number.isInteger(choice) || (choice as number) < 0 || (choice as number) >= q.options.length) {
      throw new ValidationError('Answer every question.', { [q.id]: 'Choose one answer.' });
    }
    return { questionId: q.id, correct: choice === q.correct, correctOption: q.correct, explanation: q.explanation };
  });
  const score = results.filter((r) => r.correct).length;
  const passed = score >= PASS_MARK;
  await pool.query(
    `INSERT INTO training_attempts (user_id, module_id, module_version, score, total, passed) VALUES ($1, $2, $3, $4, $5, $6)`,
    [userId, module.id, module.version, score, module.questions.length, passed]
  );
  return { moduleId: module.id, version: module.version, score, total: module.questions.length, passed, passMark: PASS_MARK, results };
}

/** For administrators: every staff and leadership member, the modules their role needs, and where they stand. */
export async function getTeamProgress() {
  const people = (
    await pool.query(
      `SELECT id, email, full_name, role FROM users WHERE role IN ('case_manager', 'admin', 'leadership') ORDER BY role, lower(email)`
    )
  ).rows;
  const status = await statusOf(people.map((p: any) => p.id));
  return {
    modules: MODULES.map((m) => ({ id: m.id, title: m.title, version: m.version })),
    people: people.map((p: any) => {
      const required = requiredModules(p.role);
      const mine = (status.get(p.id) ?? []).filter((s) => required.includes(s.moduleId));
      return {
        email: p.email,
        fullName: p.full_name,
        role: p.role,
        modules: mine,
        complete: mine.length > 0 && mine.every((s) => s.passed),
      };
    }),
  };
}
