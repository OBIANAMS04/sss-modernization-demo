import { useCallback, useEffect, useRef, useState } from 'react';
import { getUser } from '../../utils/tokenManager';
import { getApiErrorMessage } from '../../utils/apiError';
import { isAdminUser } from '../../utils/roles';
import { trainingService } from '../../services/trainingService';
import AppNav from '../Common/AppNav';
import DemoEnvironmentBanner from '../DemoEnvironmentBanner';
import { formatTime } from '../Assistant/format';

// STORY-035: training for staff and leadership. Each module has short sections with screens of the real pages and a knowledge
// check graded on the server (three of four right is a pass). Administrators also see the whole team's progress.

const ROLE_NAMES = { case_manager: 'Case manager', admin: 'Administrator', leadership: 'Leadership' };
const button = 'px-4 py-2 rounded-lg text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2 disabled:opacity-50 transition duration-200';

function StatusBadge({ status }) {
  if (status?.passed) return <span className="inline-block rounded-full bg-green-100 px-2 py-1 text-xs font-medium text-green-800">Passed {formatTime(status.passedAt)}</span>;
  if (status?.attempts) return <span className="inline-block rounded-full bg-amber-100 px-2 py-1 text-xs font-medium text-amber-900">Not passed yet (best {status.bestScore} of 4)</span>;
  return <span className="inline-block rounded-full bg-gray-100 px-2 py-1 text-xs font-medium text-gray-700">Not started</span>;
}

function KnowledgeCheck({ module, passMark, onDone }) {
  const [answers, setAnswers] = useState({});
  const [missing, setMissing] = useState([]);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const firstMissingRef = useRef(null);
  const resultRef = useRef(null);

  useEffect(() => {
    if (missing.length) firstMissingRef.current?.focus();
  }, [missing]);
  useEffect(() => {
    if (result) resultRef.current?.focus();
  }, [result]);

  const submit = async (e) => {
    e.preventDefault();
    const unanswered = module.questions.filter((q) => answers[q.id] === undefined).map((q) => q.id);
    setMissing(unanswered);
    if (unanswered.length) return;
    setBusy(true);
    setError('');
    try {
      const graded = await trainingService.attempt(module.id, answers);
      setResult(graded);
      onDone();
    } catch (err) {
      setError(getApiErrorMessage(err, 'Your answers could not be checked. Please try again.'));
    } finally {
      setBusy(false);
    }
  };

  const outcome = (q) => result?.results.find((r) => r.questionId === q.id);

  return (
    <form onSubmit={submit} noValidate className="mt-6 space-y-5" aria-labelledby={`check-${module.id}`}>
      <h3 id={`check-${module.id}`} className="text-lg font-bold text-gray-900">Knowledge check</h3>
      <p className="text-sm text-gray-700">Four questions. {passMark} right is a pass. You can try again as often as you like.</p>
      {module.questions.map((q, i) => {
        const isMissing = missing.includes(q.id);
        const graded = outcome(q);
        return (
          <fieldset
            key={q.id}
            aria-describedby={isMissing ? `${q.id}-missing` : graded ? `${q.id}-explained` : undefined}
            className={`rounded-lg border p-4 ${isMissing ? 'border-red-500' : 'border-gray-300'}`}
          >
            <legend
              ref={isMissing && q.id === missing[0] ? firstMissingRef : undefined}
              tabIndex={-1}
              className="px-1 font-medium text-gray-900 focus:outline-none"
            >
              {i + 1}. {q.prompt}
            </legend>
            <div className="mt-2 space-y-2">
              {q.options.map((option, n) => (
                <label key={option} className="flex items-start gap-2 text-sm text-gray-800">
                  <input
                    type="radio"
                    name={`${module.id}-${q.id}`}
                    value={n}
                    checked={answers[q.id] === n}
                    disabled={!!result}
                    onChange={() => {
                      setAnswers({ ...answers, [q.id]: n });
                      setMissing(missing.filter((id) => id !== q.id));
                    }}
                    className="mt-1"
                  />
                  <span>
                    {option}
                    {graded && n === graded.correctOption && <strong className="ml-2 text-green-800">(correct answer)</strong>}
                  </span>
                </label>
              ))}
            </div>
            {isMissing && <p id={`${q.id}-missing`} role="alert" className="mt-2 text-sm text-red-700">Choose an answer.</p>}
            {graded && (
              <p id={`${q.id}-explained`} className={`mt-2 text-sm ${graded.correct ? 'text-green-800' : 'text-red-700'}`}>
                {graded.correct ? 'Right. ' : 'Not quite. '}
                {graded.explanation}
              </p>
            )}
          </fieldset>
        );
      })}
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {result ? (
        <div ref={resultRef} tabIndex={-1} role="status" className={`rounded-lg border p-4 focus:outline-none ${result.passed ? 'border-green-300 bg-green-50 text-green-900' : 'border-amber-400 bg-amber-50 text-amber-900'}`}>
          <p className="font-semibold">{result.passed ? `Passed: ${result.score} of ${result.total}.` : `${result.score} of ${result.total}: not passed yet. ${passMark} right is a pass.`}</p>
          <button
            type="button"
            onClick={() => {
              setResult(null);
              setAnswers({});
            }}
            className={`${button} mt-3 border border-gray-500 bg-white text-gray-800 hover:bg-gray-50`}
          >
            Try again
          </button>
        </div>
      ) : (
        <button type="submit" disabled={busy} className={`${button} bg-blue-600 text-white hover:bg-blue-700`}>
          {busy ? 'Checking...' : 'Check my answers'}
        </button>
      )}
    </form>
  );
}

function TeamProgress({ refreshKey }) {
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    trainingService.progress().then(setProgress, (err) => setError(getApiErrorMessage(err, 'Team progress could not be loaded.')));
  }, [refreshKey]);
  const titleOf = (id) => progress?.modules.find((m) => m.id === id)?.title ?? id;
  return (
    <section aria-labelledby="team-progress" className="bg-white rounded-lg shadow-md p-6 mb-6">
      <h2 id="team-progress" className="text-xl font-bold text-gray-900">Team progress</h2>
      <p className="mt-1 text-sm text-gray-700">Every case manager, administrator and leadership member, the modules their role needs, and whether they have passed the current version.</p>
      {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
      {!progress && !error && <p className="mt-3 text-sm text-gray-600">Loading...</p>}
      {progress && (
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-sm">
            <caption className="sr-only">Training progress by person</caption>
            <thead className="bg-gray-50 text-left text-gray-600">
              <tr>
                <th scope="col" className="px-3 py-2">Person</th>
                <th scope="col" className="px-3 py-2">Role</th>
                <th scope="col" className="px-3 py-2">Modules</th>
                <th scope="col" className="px-3 py-2">Complete</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {progress.people.map((p) => (
                <tr key={p.email}>
                  <td className="px-3 py-2"><span className="font-medium text-gray-900">{p.fullName}</span><br /><span className="text-gray-600 wrap-anywhere">{p.email}</span></td>
                  <td className="px-3 py-2">{ROLE_NAMES[p.role] ?? p.role}</td>
                  <td className="px-3 py-2">
                    <ul className="space-y-1">
                      {p.modules.map((m) => (
                        <li key={m.moduleId}>{titleOf(m.moduleId)}: <StatusBadge status={m} /></li>
                      ))}
                    </ul>
                  </td>
                  <td className="px-3 py-2">{p.complete ? 'Yes' : 'No'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export default function Training() {
  const user = getUser();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const load = useCallback(() => {
    trainingService.mine().then(
      (d) => {
        setData(d);
        setError('');
      },
      (err) => setError(getApiErrorMessage(err, 'Training could not be loaded.'))
    );
  }, []);
  useEffect(load, [load]);

  return (
    <div className="min-h-screen bg-gray-50">
      <AppNav title="Training" subtitle="Short modules for your role, each with a knowledge check" />
      <main id="main" tabIndex={-1} className="max-w-5xl mx-auto py-8 px-4 sm:px-6 lg:px-8 focus:outline-none">
        <DemoEnvironmentBanner />
        {error && <p role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</p>}
        {!data && !error && <p className="text-gray-600">Loading...</p>}
        {data && (
          <>
            <section aria-labelledby="your-modules" className="mb-6">
              <h2 id="your-modules" className="sr-only">Your modules</h2>
              <div className="grid gap-4 md:grid-cols-2">
                {data.modules.map((m) => (
                  <article key={m.id} className="bg-white rounded-lg shadow-md p-6">
                    <h3 className="text-lg font-bold text-gray-900">{m.title}</h3>
                    <p className="mt-1 text-sm text-gray-700">{m.summary} About {m.minutes} minutes.</p>
                    <p className="mt-3"><StatusBadge status={m.status} /></p>
                    <button
                      type="button"
                      aria-expanded={open === m.id}
                      aria-controls={`module-${m.id}`}
                      onClick={() => setOpen(open === m.id ? null : m.id)}
                      className={`${button} mt-4 bg-blue-600 text-white hover:bg-blue-700`}
                    >
                      {open === m.id ? `Close ${m.title}` : m.status?.passed ? `Review ${m.title}` : `Start ${m.title}`}
                    </button>
                  </article>
                ))}
              </div>
            </section>

            {data.modules
              .filter((m) => m.id === open)
              .map((m) => (
                <section key={m.id} id={`module-${m.id}`} aria-labelledby={`module-${m.id}-title`} className="bg-white rounded-lg shadow-md p-6 mb-6">
                  <h2 id={`module-${m.id}-title`} className="text-xl font-bold text-gray-900">{m.title}</h2>
                  {m.sections.map((s) => (
                    <div key={s.heading} className="mt-5">
                      <h3 className="font-semibold text-gray-900">{s.heading}</h3>
                      <p className="mt-1 text-gray-800">{s.body}</p>
                      {s.image && (
                        <figure className="mt-3">
                          <img src={s.image.src} alt={s.image.alt} loading="lazy" className="max-h-96 w-full rounded-lg border border-gray-300 object-cover object-top" />
                          <figcaption className="mt-1 text-xs text-gray-600">
                            Screen from the demo with synthetic data. <a href={s.image.src} className="text-blue-700 underline" target="_blank" rel="noreferrer">Open the full screen</a>
                          </figcaption>
                        </figure>
                      )}
                    </div>
                  ))}
                  <KnowledgeCheck
                    module={m}
                    passMark={data.passMark}
                    onDone={() => {
                      load();
                      setRefreshKey((k) => k + 1);
                    }}
                  />
                </section>
              ))}

            {isAdminUser(user) && <TeamProgress refreshKey={refreshKey} />}
          </>
        )}
      </main>
    </div>
  );
}
