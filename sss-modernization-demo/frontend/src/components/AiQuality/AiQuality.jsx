import { useCallback, useEffect, useId, useState } from 'react';
import { getUser } from '../../utils/tokenManager';
import { getApiErrorMessage } from '../../utils/apiError';
import { isAdminUser, isStaffUser } from '../../utils/roles';
import { aiQualityService } from '../../services/aiQualityService';
import AppNav from '../Common/AppNav';
import ConfirmAction from '../Common/ConfirmAction';
import Chart from '../Dashboard/Chart';
import DashboardSection from '../Dashboard/DashboardSection';
import StatTile from '../Dashboard/StatTile';
import DemoEnvironmentBanner from '../DemoEnvironmentBanner';
import { formatTime } from '../Assistant/format';

// STORY-021 and 025: AI Quality, for case managers and admins. How the assistant's real answers are changing (drift), how it scores
// on the golden set against a baseline, and whether it and the decision rules treat people alike (fairness). An administrator can run
// the evaluation and the fairness check on the server; both call the model, so they cost money and say so before they start.

const POLL_MS = 3000;
const percent = (value) => (value === null || value === undefined ? '—' : `${Math.round(value * 1000) / 10}%`);
const plainPercent = (value) => (value === null || value === undefined ? '—' : `${value}%`);
const shortDay = (day) => new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });

const UNIT_FORMAT = {
  percent: (v) => `${v}%`,
  count: (v) => String(v),
  characters: (v) => `${v}`,
  ms: (v) => `${v} ms`,
};
const showValue = (unit, value) => (value === null || value === undefined ? '—' : UNIT_FORMAT[unit](value));

const STATE_WORDS = {
  ok: ['Within tolerance', 'text-green-700'],
  drift: ['Drift', 'text-red-700'],
  'not-enough-data': ['Not enough data', 'text-gray-700'],
};

const button = 'bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50';
const th = 'px-2 py-2 font-medium sm:px-3';
const td = 'px-2 py-2 text-right tabular-nums text-gray-900 sm:px-3';

function Message({ tone, children }) {
  const style = tone === 'bad' ? 'border-red-300 bg-red-50 text-red-800' : 'border-green-200 bg-green-50 text-green-800';
  return (
    <div role={tone === 'bad' ? 'alert' : 'status'} className={`mb-4 rounded-lg border p-4 text-sm wrap-anywhere ${style}`}>
      {children}
    </div>
  );
}

function RunStatus({ run }) {
  if (run.status === 'running') return <span className="font-medium text-gray-700">Running</span>;
  if (run.status === 'failed') return <span className="font-medium text-red-700">Failed</span>;
  return run.passed ? <span className="font-medium text-green-700">Passed</span> : <span className="font-medium text-red-700">Missed a threshold</span>;
}

function Alerts({ alerts }) {
  const open = alerts.filter((a) => !a.clearedAt);
  const cleared = alerts.filter((a) => a.clearedAt);
  return (
    <DashboardSection title="Open alerts" hint="An alert opens once when something drifts, is recorded in the audit log and sent to every administrator, and closes when it clears.">
      {open.length === 0 ? (
        <Message tone="good">No alert is open: nothing has drifted past its tolerance.</Message>
      ) : (
        <ul className="mb-4 space-y-2">
          {open.map((a) => (
            <li key={a.id} role="alert" className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-800 wrap-anywhere">
              <p className="font-semibold">{a.kind === 'signal' ? 'Quality signal drift' : a.kind === 'eval' ? 'Evaluation run' : 'Fairness run'}</p>
              <p>{a.message}</p>
              <p className="mt-1 text-red-800">Opened {formatTime(a.openedAt)}</p>
            </li>
          ))}
        </ul>
      )}
      {cleared.length > 0 && (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <caption className="text-left text-sm font-medium text-gray-700 pb-2">Alerts that have cleared in the last 30 days</caption>
            <thead className="bg-gray-50 text-left text-gray-600">
              <tr>
                <th scope="col" className={th}>What</th>
                <th scope="col" className={th}>Opened</th>
                <th scope="col" className={th}>Cleared</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {cleared.map((a) => (
                <tr key={a.id}>
                  <td className="px-2 py-2 text-gray-900 sm:px-3 wrap-anywhere">{a.message}</td>
                  <td className="px-2 py-2 text-gray-900 sm:px-3">{formatTime(a.openedAt)}</td>
                  <td className="px-2 py-2 text-gray-900 sm:px-3">{formatTime(a.clearedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </DashboardSection>
  );
}

function Signals({ data }) {
  const selectId = useId();
  const [key, setKey] = useState('groundedRate');
  const { signals, trend, markers, windows } = data;
  const series = trend.series.find((s) => s.key === key) ?? trend.series[0];
  const format = (v) => showValue(series.unit, v);
  return (
    <DashboardSection
      title="Quality signals"
      hint={`Measured from real AI answers. Drift compares the last ${windows.recentDays} days with the ${windows.baselineDays} days before; a window needs at least ${windows.minAnswers} answers, otherwise it says "not enough data".`}
    >
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <caption className="sr-only">Each quality signal, the last 7 days against the 28 days before, and whether it drifted</caption>
          <thead className="bg-gray-50 text-left text-gray-600">
            <tr>
              <th scope="col" className={th}>Signal</th>
              <th scope="col" className={`${th} text-right`}>Last {windows.recentDays} days</th>
              <th scope="col" className={`${th} text-right`}>Before ({windows.baselineDays} days)</th>
              <th scope="col" className={`${th} text-right`}>Change</th>
              <th scope="col" className={th}>Drift is</th>
              <th scope="col" className={th}>Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {signals.map((s) => {
              const [words, tone] = STATE_WORDS[s.state];
              return (
                <tr key={s.key}>
                  <th scope="row" className="px-2 py-2 text-left font-normal text-gray-900 sm:px-3">
                    {s.label}
                    <span className="block text-xs text-gray-600">{s.description}</span>
                  </th>
                  <td className={td}>{showValue(s.unit, s.recent)}</td>
                  <td className={td}>{showValue(s.unit, s.baseline)}</td>
                  <td className={td}>{s.change === null ? '—' : `${s.change > 0 ? '+' : ''}${s.change}${s.unit === 'percent' ? ' points' : ''}`}</td>
                  <td className="px-2 py-2 text-gray-900 sm:px-3">{s.tolerance}</td>
                  <td className={`px-2 py-2 font-medium sm:px-3 ${tone}`}>{words}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-8">
        <h3 className="text-lg font-semibold text-gray-900">Trend</h3>
        <p className="mb-3 text-sm text-gray-600">One point a day for the last {trend.days.length} days (UTC). A day with no real answers has no point.</p>
        <label htmlFor={selectId} className="block text-sm font-medium text-gray-700">Signal</label>
        <select
          id={selectId}
          value={key}
          onChange={(e) => setKey(e.target.value)}
          className="mt-1 mb-4 rounded-lg border border-gray-500 bg-white px-3 py-2 text-sm text-gray-900"
        >
          {trend.series.map((s) => (
            <option key={s.key} value={s.key}>{s.label}</option>
          ))}
        </select>
        <Chart
          type="line"
          label={`${series.label} per day, last ${trend.days.length} days`}
          categoryHeader="Day"
          categoryTitle="Day (UTC)"
          categories={trend.days.map(shortDay)}
          series={[{ name: series.label, values: series.values, format }]}
          extraColumns={[{ name: 'Answers', values: trend.answers }]}
          format={format}
        />
      </div>

      <div className="mt-8">
        <h3 className="text-lg font-semibold text-gray-900">Change markers</h3>
        <p className="mb-3 text-sm text-gray-600">When the model (as the API reports it) or the version of the policy documents changed, so a step in the trend can be explained.</p>
        {markers.length === 0 ? (
          <p className="text-sm text-gray-700">No change has been recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <caption className="sr-only">Changes of model and of policy documents in the last 35 days</caption>
              <thead className="bg-gray-50 text-left text-gray-600">
                <tr>
                  <th scope="col" className={th}>When</th>
                  <th scope="col" className={th}>What changed</th>
                  <th scope="col" className={th}>From</th>
                  <th scope="col" className={th}>To</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {markers.map((m) => (
                  <tr key={m.id}>
                    <td className="px-2 py-2 text-gray-900 sm:px-3">{formatTime(m.at)}</td>
                    <td className="px-2 py-2 text-gray-900 sm:px-3">{m.kind === 'model' ? 'Model' : 'Policy documents'}</td>
                    <td className="px-2 py-2 text-gray-900 sm:px-3 wrap-anywhere">{m.from ?? 'first seen'}</td>
                    <td className="px-2 py-2 text-gray-900 sm:px-3 wrap-anywhere">{m.to}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </DashboardSection>
  );
}

/** The run button, with the confirmation that says it calls the model and costs money (the call is made only after Confirm). */
function RunButton({ label, question, confirmLabel, onConfirm, busy }) {
  return <ConfirmAction label={label} className={button} question={question} confirmLabel={confirmLabel} onConfirm={onConfirm} disabled={busy} />;
}

function Evaluation({ evaluation, admin, busy, onStart, onBaseline }) {
  const { latest, baseline, thresholds, belowBaseline, failures, runs } = evaluation;
  const running = runs.some((r) => r.status === 'running');
  return (
    <DashboardSection
      title="Evaluation against the golden set"
      hint="The 33 golden questions are asked on the server through the same path as a real question, and scored on retrieval, facts, citations and grounding. A run below a threshold, or more than 5 points under the baseline, is drift."
    >
      {admin && (
        <div className="mb-4">
          <RunButton
            label="Run evaluation"
            question="This asks the AI model all 33 golden questions, one call each. It calls the model and costs money (about a dollar or less with the real model). It can be started once an hour. Run it now?"
            confirmLabel="Yes, run the evaluation"
            onConfirm={onStart}
            busy={busy || running}
          />
        </div>
      )}
      {running && <Message tone="good">An evaluation is running. This page reads its result as soon as it is done.</Message>}
      {!latest ? (
        <p className="text-sm text-gray-700">No evaluation has been run yet.{admin ? '' : ' An administrator can start one.'}</p>
      ) : (
        <>
          <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatTile label="Latest run" value={latest.passed ? 'Passed' : 'Missed a threshold'} tone={latest.passed ? 'text-green-700' : 'text-red-700'} note={`${formatTime(latest.createdAt)}, started by ${latest.startedByEmail ?? 'unknown'}`} />
            <StatTile label="Model" value={latest.model ?? '—'} note={`Mode: ${latest.mode ?? '—'}`} />
            <StatTile label="Policy documents" value={latest.corpusVersion ?? '—'} note="Version when the run started" />
          </div>
          {belowBaseline.length > 0 && (
            <Message tone="bad">
              <p className="font-semibold">More than 5 points under the baseline</p>
              <ul className="list-disc pl-5">{belowBaseline.map((m) => <li key={m}>{m}</li>)}</ul>
            </Message>
          )}
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <caption className="text-left text-sm font-medium text-gray-700 pb-2">Latest run against its thresholds and the baseline{baseline ? '' : ' (no baseline has been marked yet)'}</caption>
              <thead className="bg-gray-50 text-left text-gray-600">
                <tr>
                  <th scope="col" className={th}>Score</th>
                  <th scope="col" className={`${th} text-right`}>Latest run</th>
                  <th scope="col" className={`${th} text-right`}>Baseline</th>
                  <th scope="col" className={`${th} text-right`}>Threshold</th>
                  <th scope="col" className={th}>Result</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {thresholds.map((t) => (
                  <tr key={t.key}>
                    <th scope="row" className="px-2 py-2 text-left font-normal text-gray-900 sm:px-3">{t.name}</th>
                    <td className={td}>{percent(t.value)}</td>
                    <td className={td}>{baseline ? percent(baseline.scores[t.key]) : '—'}</td>
                    <td className={td}>{percent(t.min)}</td>
                    <td className={`px-2 py-2 font-medium sm:px-3 ${!t.enforced ? 'text-gray-700' : t.passed ? 'text-green-700' : 'text-red-700'}`}>
                      {!t.enforced ? 'Not enforced in this mode' : t.passed ? 'Meets it' : 'Below it'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {failures.length > 0 && (
            <div className="mt-4">
              <h3 className="text-lg font-semibold text-gray-900">Questions that missed something</h3>
              <ul className="mt-2 list-disc pl-5 text-sm text-gray-900">
                {failures.map((f) => (
                  <li key={f.id} className="wrap-anywhere">
                    {f.id}: {f.question} ({[!f.retrievalHit && 'expected passage not retrieved', f.factsMissing.length > 0 && `${f.factsMissing.length} fact(s) missing`, f.invalidCitations > 0 && 'invalid citation', f.grounded === false && 'not grounded'].filter(Boolean).join(', ')})
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      {runs.length > 0 && (
        <div className="mt-6 overflow-x-auto">
          <table className="min-w-full text-sm">
            <caption className="text-left text-sm font-medium text-gray-700 pb-2">Evaluation runs, newest first</caption>
            <thead className="bg-gray-50 text-left text-gray-600">
              <tr>
                <th scope="col" className={th}>Started</th>
                <th scope="col" className={th}>Model</th>
                <th scope="col" className={th}>Mode</th>
                <th scope="col" className={`${th} text-right`}>Retrieval</th>
                <th scope="col" className={`${th} text-right`}>Facts</th>
                <th scope="col" className={`${th} text-right`}>Citations</th>
                <th scope="col" className={`${th} text-right`}>Grounded</th>
                <th scope="col" className={th}>Result</th>
                <th scope="col" className={th}>Baseline</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {runs.map((r) => (
                <tr key={r.id}>
                  <td className="px-2 py-2 text-gray-900 sm:px-3">{formatTime(r.createdAt)}</td>
                  <td className="px-2 py-2 text-gray-900 sm:px-3 wrap-anywhere">{r.model ?? '—'}</td>
                  <td className="px-2 py-2 text-gray-900 sm:px-3">{r.mode ?? '—'}</td>
                  <td className={td}>{percent(r.scores.retrievalHitRate)}</td>
                  <td className={td}>{percent(r.scores.factAccuracy)}</td>
                  <td className={td}>{percent(r.scores.citationValidity)}</td>
                  <td className={td}>{percent(r.scores.groundedRate)}</td>
                  <td className="px-2 py-2 sm:px-3"><RunStatus run={r} /></td>
                  <td className="px-2 py-2 text-gray-900 sm:px-3">
                    {r.isBaseline ? (
                      <span className="font-medium">Baseline</span>
                    ) : admin && r.status === 'completed' ? (
                      <button type="button" onClick={() => onBaseline(r.id)} disabled={busy} className="text-blue-700 underline hover:text-blue-900 disabled:opacity-50">
                        Mark as baseline<span className="sr-only"> (run of {formatTime(r.createdAt)})</span>
                      </button>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </DashboardSection>
  );
}

function GroupTable({ caption, header, groups, minDecisions }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <caption className="text-left text-sm font-medium text-gray-700 pb-2">{caption}</caption>
        <thead className="bg-gray-50 text-left text-gray-600">
          <tr>
            <th scope="col" className={th}>{header}</th>
            <th scope="col" className={`${th} text-right`}>Decisions</th>
            <th scope="col" className={`${th} text-right`}>Approval rate</th>
            <th scope="col" className={`${th} text-right`}>Against the highest</th>
            <th scope="col" className={`${th} text-right`}>Days to decide</th>
            <th scope="col" className={`${th} text-right`}>Override rate</th>
            <th scope="col" className={th}>Four-fifths rule</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {groups.map((g) => (
            <tr key={g.group}>
              <th scope="row" className="px-2 py-2 text-left font-normal text-gray-900 sm:px-3">{g.group}</th>
              <td className={td}>{g.decisions}</td>
              <td className={td}>{plainPercent(g.approvalRate)}</td>
              <td className={td}>{plainPercent(g.ratioToHighest)}</td>
              <td className={td}>{g.avgDaysToDecide ?? '—'}</td>
              <td className={td}>{plainPercent(g.overrideRate)}</td>
              <td className={`px-2 py-2 font-medium sm:px-3 ${g.flagged ? 'text-red-700' : 'text-gray-700'}`}>
                {g.flagged ? 'Flagged: under 80% of the highest' : g.enough ? (g.group === 'Unknown' || g.ratioToHighest === null ? 'Not compared' : 'Within the rule') : `Fewer than ${minDecisions} decisions`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Fairness({ fairness, admin, busy, onStart }) {
  const { latest, outcomes, statement, runs } = fairness;
  const summary = latest?.status === 'completed' ? latest.summary : null;
  const running = runs.some((r) => r.status === 'running');
  return (
    <DashboardSection
      title="Fairness"
      hint="Whether the assistant and the decision rules treat people alike, tested by changing only a detail that must not matter, and monitored on the groups the demo holds."
    >
      <div className="mb-6 rounded-lg border border-gray-300 bg-gray-50 p-4">
        <h3 className="text-lg font-semibold text-gray-900">{statement.heading}</h3>
        <p className="mt-2 text-sm text-gray-900">Not collected: {statement.notCollected.join(', ')}.</p>
        {statement.paragraphs.map((p) => (
          <p key={p.slice(0, 24)} className="mt-2 text-sm text-gray-900">{p}</p>
        ))}
      </div>

      <h3 className="text-lg font-semibold text-gray-900">Assistant counterfactual check</h3>
      <p className="mb-3 text-sm text-gray-600">
        Ten questions, each asked as it is and with one statement in front that changes only the asker&apos;s stated name, gender, ethnicity, age wording, disability mention or
        English fluency. The same passages must be retrieved and the same oversight level given in at least 95% of the 60 pairs, and the key facts must be in every answer.
        The rules for eligibility and compliance are tested the same way in the automated tests (names, every US region, phone and address formats).
      </p>
      {admin && (
        <div className="mb-4">
          <RunButton
            label="Run fairness check"
            question="This asks the AI model 70 questions, one call each. It calls the model and costs money (a few dollars or less with the real model). It can be started once an hour. Run it now?"
            confirmLabel="Yes, run the fairness check"
            onConfirm={onStart}
            busy={busy || running}
          />
        </div>
      )}
      {running && <Message tone="good">A fairness check is running. This page reads its result as soon as it is done.</Message>}
      {!summary ? (
        <p className="mb-6 text-sm text-gray-700">No counterfactual check has been run yet.{admin ? '' : ' An administrator can start one.'}</p>
      ) : (
        <div className="mb-6">
          <Message tone={latest.passed ? 'good' : 'bad'}>
            {latest.passed ? 'Passed' : 'Missed its criteria'}: run {formatTime(latest.createdAt)}, mode {latest.mode}, model {latest.model ?? '—'}.
          </Message>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <caption className="text-left text-sm font-medium text-gray-700 pb-2">Latest counterfactual run against its criteria</caption>
              <thead className="bg-gray-50 text-left text-gray-600">
                <tr>
                  <th scope="col" className={th}>Criterion</th>
                  <th scope="col" className={`${th} text-right`}>Result</th>
                  <th scope="col" className={`${th} text-right`}>Required</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                <tr>
                  <th scope="row" className="px-2 py-2 text-left font-normal text-gray-900 sm:px-3">Same passages retrieved ({summary.samePassages.count} of {summary.pairs} pairs)</th>
                  <td className={td}>{percent(summary.samePassages.rate)}</td>
                  <td className={td}>at least {percent(summary.samePassages.required)}</td>
                </tr>
                <tr>
                  <th scope="row" className="px-2 py-2 text-left font-normal text-gray-900 sm:px-3">Same oversight level ({summary.sameLevel.count} of {summary.pairs} pairs)</th>
                  <td className={td}>{percent(summary.sameLevel.rate)}</td>
                  <td className={td}>at least {percent(summary.sameLevel.required)}</td>
                </tr>
                <tr>
                  <th scope="row" className="px-2 py-2 text-left font-normal text-gray-900 sm:px-3">
                    Key facts in every variant {summary.factsInEveryVariant ? `(${summary.factsInEveryVariant.count} of ${summary.factsInEveryVariant.of} questions)` : '(no answers were generated)'}
                  </th>
                  <td className={td}>{summary.factsInEveryVariant ? percent(summary.factsInEveryVariant.rate) : '—'}</td>
                  <td className={td}>{percent(1)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-sm">
              <caption className="text-left text-sm font-medium text-gray-700 pb-2">Pairs that came out the same, by what was changed</caption>
              <thead className="bg-gray-50 text-left text-gray-600">
                <tr>
                  <th scope="col" className={th}>What changed</th>
                  <th scope="col" className={`${th} text-right`}>Pairs</th>
                  <th scope="col" className={`${th} text-right`}>Same passages</th>
                  <th scope="col" className={`${th} text-right`}>Same level</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {summary.byAttribute.map((a) => (
                  <tr key={a.attribute}>
                    <th scope="row" className="px-2 py-2 text-left font-normal text-gray-900 sm:px-3">{a.label}</th>
                    <td className={td}>{a.pairs}</td>
                    <td className={td}>{a.samePassages}</td>
                    <td className={td}>{a.sameLevel}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <h3 className="text-lg font-semibold text-gray-900">Decision outcomes by group</h3>
      <p className="mb-3 text-sm text-gray-600">
        Approvals and denials of the last {outcomes.windowDays} days, {outcomes.decisions} in all. The age band comes from the date of birth and the region from the state in the address
        (neither is shown per person). A group with fewer than {outcomes.minDecisions} decisions shows its count only. The four-fifths rule flags a group whose approval rate is under
        80% of the highest group&apos;s; a flag means look closer, not that something is unfair.
      </p>
      {outcomes.flagged.length > 0 ? (
        <Message tone="bad">Flagged by the four-fifths rule: {outcomes.flagged.join(', ')}.</Message>
      ) : (
        <Message tone="good">No group is flagged by the four-fifths rule.</Message>
      )}
      <div className="space-y-6">
        <GroupTable caption="Outcomes by age band" header="Age band" groups={outcomes.byAgeBand} minDecisions={outcomes.minDecisions} />
        <GroupTable caption="Outcomes by region" header="Region" groups={outcomes.byRegion} minDecisions={outcomes.minDecisions} />
      </div>
    </DashboardSection>
  );
}

export default function AiQuality() {
  const user = getUser();
  const staff = isStaffUser(user);
  const admin = isAdminUser(user);
  const [quality, setQuality] = useState(null);
  const [fairness, setFairness] = useState(null);
  const [loading, setLoading] = useState(staff);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    () =>
      Promise.all([aiQualityService.quality(), aiQualityService.fairness()])
        .then(([q, f]) => {
          setQuality(q);
          setFairness(f);
          setError('');
        })
        .catch((err) => setError(getApiErrorMessage(err, 'Could not load AI quality.')))
        .finally(() => setLoading(false)),
    []
  );

  useEffect(() => {
    if (staff) load();
  }, [staff, load]);

  // While a run is going the page reads again every few seconds, so its result appears when it is done
  const running = Boolean(quality?.evaluation.runs.some((r) => r.status === 'running') || fairness?.runs.some((r) => r.status === 'running'));
  useEffect(() => {
    if (!running) return undefined;
    const timer = setInterval(load, POLL_MS);
    return () => clearInterval(timer);
  }, [running, load]);

  const act = async (work, done) => {
    setBusy(true);
    setNotice('');
    setError('');
    try {
      await work();
      setNotice(done);
      await load();
    } catch (err) {
      setError(getApiErrorMessage(err, 'That did not work.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <AppNav title="AI Quality" subtitle="Drift, evaluation and fairness of the policy assistant" />
      <main id="main" tabIndex={-1} className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8 focus:outline-none">
        <DemoEnvironmentBanner />
        {!staff ? (
          <div className="bg-white rounded-lg shadow-md p-6 text-gray-700">AI quality is available to case managers and administrators only.</div>
        ) : (
          <>
            {error && <div role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 wrap-anywhere">{error}</div>}
            {notice && <div role="status" className="mb-4 rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-800 wrap-anywhere">{notice}</div>}
            {loading ? (
              <div role="status" className="text-center py-12">
                <div className="inline-block animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600" aria-hidden="true"></div>
                <p className="mt-4 text-gray-600">Loading AI quality...</p>
              </div>
            ) : (
              quality &&
              fairness && (
                <div className="space-y-6">
                  <p className="max-w-3xl text-gray-700">
                    This page watches the assistant after it has gone live. It shows how its real answers are changing, how it scores against a fixed set of questions, and whether
                    it and the decision rules treat people alike. Everything here is demonstrated on a synthetic deployment.
                  </p>
                  <Alerts alerts={quality.alerts} />
                  <Signals data={quality} />
                  <Evaluation
                    evaluation={quality.evaluation}
                    admin={admin}
                    busy={busy}
                    onStart={() => act(aiQualityService.startEvaluation, 'The evaluation has started. It calls the model once for each question; the result appears here when it is done.')}
                    onBaseline={(id) => act(() => aiQualityService.markBaseline(id), 'That run is now the baseline.')}
                  />
                  <Fairness
                    fairness={fairness}
                    admin={admin}
                    busy={busy}
                    onStart={() => act(aiQualityService.startFairnessRun, 'The fairness check has started. The result appears here when it is done.')}
                  />
                </div>
              )
            )}
          </>
        )}
      </main>
    </div>
  );
}
