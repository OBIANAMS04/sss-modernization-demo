import { useState, useEffect, useCallback } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getUser } from '../../utils/tokenManager';
import { getApiErrorMessage } from '../../utils/apiError';
import { caseService } from '../../services/caseService';
import { complianceService } from '../../services/complianceService';
import CompliancePanel from './CompliancePanel';
import { isStaffUser } from '../../utils/roles';
import AppNav from '../Common/AppNav';
import StatusBadge from '../Common/StatusBadge';
import DemoEnvironmentBanner from '../DemoEnvironmentBanner';

const ACTION_LABELS = {
  Submitted: 'Submit application',
  'In Review': 'Start review',
  Approved: 'Approve',
  Denied: 'Deny',
  Appealed: 'Appeal this decision',
};

const ACTION_STYLES = {
  Approved: 'bg-green-600 hover:bg-green-700',
  Denied: 'bg-red-600 hover:bg-red-700',
  Appealed: 'bg-purple-600 hover:bg-purple-700',
};

const DOC_LABELS = {
  proof_of_age: 'Proof of age',
  income_statement: 'Income statement',
  hardship_evidence: 'Hardship evidence',
  identity: 'Identity document',
  other: 'Other',
};

const formatDate = (value) => (value ? new Date(value).toLocaleString() : '—');

function describeEvent(event) {
  switch (event.eventType) {
    case 'created':
      return 'Application submitted';
    case 'status_change':
      return `Status changed: ${event.fromStatus} → ${event.toStatus}`;
    case 'note':
      return 'Internal note added';
    case 'document': {
      const type = (event.detail || '').replace('Document added: ', '');
      return `Document added: ${DOC_LABELS[type] || type}`;
    }
    default:
      return event.detail || event.eventType;
  }
}

const inputClass =
  'w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition text-sm';

export default function CaseDetail() {
  const { id } = useParams();
  const user = getUser();
  const staff = isStaffUser(user);

  const [caseData, setCaseData] = useState(null);
  const [managers, setManagers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [reason, setReason] = useState('');
  const [assignee, setAssignee] = useState('');
  const [note, setNote] = useState('');
  const [doc, setDoc] = useState({ type: 'proof_of_age', url: '' });
  const [compliance, setCompliance] = useState(null);

  const load = useCallback(async () => {
    const data = await caseService.getCase(id);
    setCaseData(data);
    setAssignee(data.assignedTo || '');
    if (data.actions.canAssign) setManagers(await caseService.managers());
    if (staff) setCompliance(await complianceService.caseCompliance(id));
  }, [id, staff]);

  useEffect(() => {
    load()
      .catch((err) => setError(getApiErrorMessage(err, 'Could not load this case.')))
      .finally(() => setLoading(false));
  }, [load]);

  // Runs an action, then reloads the case so the timeline and allowed actions stay in sync.
  const run = async (action, successMessage) => {
    setError('');
    setNotice('');
    setBusy(true);
    try {
      await action();
      await load();
      setNotice(successMessage);
      return true;
    } catch (err) {
      setError(getApiErrorMessage(err, 'That action failed.'));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const handleStatus = async (status) => {
    if (status === 'Denied' && !reason.trim()) {
      setError('Please enter a reason before denying. The applicant will see it.');
      return;
    }
    if (await run(() => caseService.changeStatus(id, status, reason.trim() || undefined), `Case moved to ${status}.`)) {
      setReason('');
    }
  };

  const handleNote = async (e) => {
    e.preventDefault();
    if (await run(() => caseService.addNote(id, note), 'Note added.')) setNote('');
  };

  const handleDocument = async (e) => {
    e.preventDefault();
    if (await run(() => caseService.addDocument(id, doc.type, doc.url.trim()), 'Document added.')) {
      setDoc((prev) => ({ ...prev, url: '' }));
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <AppNav title="Exemption Case" subtitle="Status, timeline, and documents" />

      <main className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
        <DemoEnvironmentBanner />

        <Link to={staff ? '/cases' : '/profile'} className="inline-block mb-4 text-blue-600 font-medium hover:text-blue-700">
          ← {staff ? 'All cases' : 'My profile'}
        </Link>

        {error && <div className="mb-4 p-4 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">{error}</div>}
        {notice && <div className="mb-4 p-4 bg-green-50 border border-green-200 text-green-800 rounded-lg text-sm">{notice}</div>}

        {loading ? (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600"></div>
            <p className="mt-4 text-gray-600">Loading case...</p>
          </div>
        ) : (
          caseData && (
            <>
              <section className="bg-white rounded-lg shadow-md p-6 mb-6">
                <div className="flex flex-wrap justify-between items-start gap-4">
                  <div>
                    <h2 className="text-xl font-bold text-gray-900">{caseData.exemptionType || 'Exemption'} case</h2>
                    <p className="text-sm text-gray-600">
                      {caseData.userId === user?.id ? 'Your application' : `${caseData.applicantName} · ${caseData.applicantEmail}`}
                    </p>
                  </div>
                  <StatusBadge status={caseData.status} />
                </div>
                <dl className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4 text-sm">
                  <div>
                    <dt className="text-gray-500">Submitted</dt>
                    <dd className="text-gray-900">{formatDate(caseData.submittedAt)}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-500">Last updated</dt>
                    <dd className="text-gray-900">{formatDate(caseData.updatedAt)}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-500">Assigned to</dt>
                    <dd className="text-gray-900">{caseData.assignedTo || 'Unassigned'}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-500">Approved</dt>
                    <dd className="text-gray-900">{formatDate(caseData.approvedAt)}</dd>
                  </div>
                </dl>
                {caseData.exemption && (
                  <p className="mt-4 text-sm text-gray-600">
                    Eligibility check: <StatusBadge status={caseData.exemption.eligibility} /> {caseData.exemption.reason}
                  </p>
                )}
              </section>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 space-y-6">
                  <section className="bg-white rounded-lg shadow-md p-6">
                    <h3 className="text-lg font-bold text-gray-900 mb-4">Timeline</h3>
                    <ol className="space-y-4">
                      {caseData.timeline.map((event) => (
                        <li key={event.id} className="border-l-4 border-blue-200 pl-4">
                          <p className="font-medium text-gray-900 text-sm">{describeEvent(event)}</p>
                          {event.eventType === 'status_change' && event.detail && (
                            <p className="text-sm text-gray-700 mt-1">Reason: {event.detail}</p>
                          )}
                          <p className="text-xs text-gray-500 mt-1">
                            {formatDate(event.createdAt)}
                            {event.actorEmail ? ` · ${event.actorEmail}` : ''}
                          </p>
                        </li>
                      ))}
                    </ol>
                  </section>

                  {staff && compliance && (
                    <CompliancePanel
                      compliance={compliance}
                      currentEmail={user?.email}
                      busy={busy}
                      onResolve={(reviewId, action, resolveNote) =>
                        run(
                          () => complianceService.resolve(reviewId, action, resolveNote),
                          action === 'reopen' ? 'Case reopened for review.' : 'Exception accepted and recorded.'
                        )
                      }
                    />
                  )}
                </div>

                <div className="space-y-6">
                  {caseData.actions.transitions.length > 0 && (
                    <section className="bg-white rounded-lg shadow-md p-6">
                      <h3 className="text-lg font-bold text-gray-900 mb-3">Actions</h3>
                      <label htmlFor="reason" className="block text-sm font-medium text-gray-700 mb-1">
                        Reason {caseData.actions.transitions.includes('Denied') ? '(required to deny; shown to the applicant)' : '(optional)'}
                      </label>
                      <textarea id="reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} className={inputClass} />
                      <div className="flex flex-wrap gap-2 mt-3">
                        {caseData.actions.transitions.map((status) => (
                          <button
                            key={status}
                            onClick={() => handleStatus(status)}
                            disabled={busy}
                            className={`text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50 transition duration-200 ${ACTION_STYLES[status] || 'bg-blue-600 hover:bg-blue-700'}`}
                          >
                            {ACTION_LABELS[status] || status}
                          </button>
                        ))}
                      </div>
                    </section>
                  )}

                  {caseData.actions.canAssign && (
                    <section className="bg-white rounded-lg shadow-md p-6">
                      <h3 className="text-lg font-bold text-gray-900 mb-3">Assignment</h3>
                      <select value={assignee} onChange={(e) => setAssignee(e.target.value)} className={inputClass}>
                        <option value="">Unassigned</option>
                        {managers.map((m) => (
                          <option key={m.email} value={m.email}>{m.fullName} ({m.email})</option>
                        ))}
                      </select>
                      <div className="flex gap-2 mt-3">
                        <button
                          onClick={() => run(() => caseService.assign(id, assignee || null), 'Assignment saved.')}
                          disabled={busy}
                          className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                        >
                          Save
                        </button>
                        <button
                          onClick={() => run(() => caseService.assign(id, user.email), 'Assigned to you.')}
                          disabled={busy || caseData.assignedTo === user?.email}
                          className="border border-blue-600 text-blue-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-50 disabled:opacity-50"
                        >
                          Assign to me
                        </button>
                      </div>
                    </section>
                  )}

                  <section className="bg-white rounded-lg shadow-md p-6">
                    <h3 className="text-lg font-bold text-gray-900 mb-3">Documents</h3>
                    {caseData.documents.length === 0 ? (
                      <p className="text-sm text-gray-600 mb-3">No documents yet.</p>
                    ) : (
                      <ul className="space-y-2 mb-4">
                        {caseData.documents.map((d) => (
                          <li key={d.id} className="text-sm">
                            <a href={d.documentUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline font-medium">
                              {DOC_LABELS[d.documentType] || d.documentType}
                            </a>
                            <span className="block text-xs text-gray-500">{d.uploadedBy} · {formatDate(d.createdAt)}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                    {caseData.actions.canAddDocument && (
                      <form onSubmit={handleDocument} className="space-y-2">
                        <select value={doc.type} onChange={(e) => setDoc((p) => ({ ...p, type: e.target.value }))} className={inputClass}>
                          {caseData.documentTypes.map((t) => (
                            <option key={t} value={t}>{DOC_LABELS[t] || t}</option>
                          ))}
                        </select>
                        <input
                          type="url"
                          required
                          placeholder="https://link-to-your-document"
                          value={doc.url}
                          onChange={(e) => setDoc((p) => ({ ...p, url: e.target.value }))}
                          className={inputClass}
                        />
                        <button type="submit" disabled={busy} className="w-full bg-gray-800 text-white py-2 rounded-lg text-sm font-medium hover:bg-gray-900 disabled:opacity-50">
                          Add document link
                        </button>
                        <p className="text-xs text-gray-500">Attach a link to the document. Direct file upload arrives with cloud storage.</p>
                      </form>
                    )}
                  </section>

                  {caseData.actions.canAddNote && (
                    <section className="bg-white rounded-lg shadow-md p-6">
                      <h3 className="text-lg font-bold text-gray-900">Internal Notes</h3>
                      <p className="text-xs text-gray-500 mb-3">Visible to case managers only.</p>
                      <ul className="space-y-3 mb-4">
                        {caseData.notes.map((n) => (
                          <li key={n.id} className="text-sm bg-gray-50 rounded-lg p-3">
                            <p className="text-gray-800 whitespace-pre-wrap">{n.content}</p>
                            <p className="text-xs text-gray-500 mt-1">{n.noteBy} · {formatDate(n.createdAt)}</p>
                          </li>
                        ))}
                      </ul>
                      <form onSubmit={handleNote} className="space-y-2">
                        <textarea rows={3} required maxLength={5000} value={note} onChange={(e) => setNote(e.target.value)} className={inputClass} placeholder="Add a note for the case team" />
                        <button type="submit" disabled={busy} className="w-full bg-gray-800 text-white py-2 rounded-lg text-sm font-medium hover:bg-gray-900 disabled:opacity-50">
                          Add note
                        </button>
                      </form>
                    </section>
                  )}
                </div>
              </div>
            </>
          )
        )}
      </main>
    </div>
  );
}
