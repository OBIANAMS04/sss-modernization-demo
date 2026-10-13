import { useState, useEffect, useCallback, useId, useRef } from 'react';
import { Link } from 'react-router-dom';
import { getUser } from '../../utils/tokenManager';
import { getApiErrorMessage } from '../../utils/apiError';
import { isStaffUser } from '../../utils/roles';
import { staffService } from '../../services/staffService';
import AppNav from '../Common/AppNav';
import ConfirmAction from '../Common/ConfirmAction';
import DemoEnvironmentBanner from '../DemoEnvironmentBanner';

const ROLE_LABELS = { case_manager: 'Case manager', admin: 'Administrator' };
const MAX_REASON = 500; // the API's limit

const inputClass =
  'w-full px-3 py-2 border border-gray-500 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none text-sm bg-white';

/**
 * One person with staff access. Removing it opens a row below with a required reason, then confirms in place before
 * anything is sent. Who cannot be removed is said in words rather than hidden.
 */
function StaffRow({ member, isYou, onlyOne, busy, onRemove }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const panelId = useId();
  const reasonId = useId();
  const reasonRef = useRef(null);

  useEffect(() => {
    if (open) reasonRef.current?.focus();
  }, [open]);

  const role = ROLE_LABELS[member.role] || member.role;
  let action;
  if (member.role === 'admin') action = 'Administrator access is not changed here.';
  else if (onlyOne) action = 'At least one case manager must keep access.';
  else if (isYou) action = 'You cannot remove your own access.';
  else {
    action = (
      <button
        type="button"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => {
          setReason('');
          setOpen((wasOpen) => !wasOpen);
        }}
        className={`px-3 py-1.5 rounded-lg text-sm font-medium border focus:outline-none focus:ring-2 focus:ring-offset-2 ${
          open
            ? 'border-gray-500 text-gray-700 hover:bg-gray-50 focus:ring-gray-600'
            : 'border-red-700 text-red-700 hover:bg-red-50 focus:ring-red-600'
        }`}
      >
        {open ? 'Cancel removal' : 'Remove access'}
      </button>
    );
  }

  return (
    <>
      <tr className="align-top">
        <td className="px-2 sm:px-4 py-3 text-gray-900 break-words">
          {member.fullName}
          {isYou && <span className="text-gray-600"> (you)</span>}
          <span className="block text-xs text-gray-600 sm:hidden">{role}</span>
        </td>
        <td className="px-2 sm:px-4 py-3 text-gray-700 wrap-anywhere">{member.email}</td>
        <td className="hidden sm:table-cell px-4 py-3 text-gray-700">{role}</td>
        <td className="px-2 sm:px-4 py-3 text-gray-600">{action}</td>
      </tr>
      {open && (
        <tr id={panelId} className="bg-gray-50">
          <td colSpan={4} className="px-2 sm:px-4 py-4 wrap-anywhere">
            <label htmlFor={reasonId} className="block text-sm font-medium text-gray-700 mb-1">
              Reason for removing access for {member.email} (required, kept in the audit log)
            </label>
            <textarea
              ref={reasonRef}
              id={reasonId}
              rows={2}
              required
              maxLength={MAX_REASON}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className={`${inputClass} max-w-xl`}
            />
            <ConfirmAction
              label="Remove access"
              className="mt-2 bg-red-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-red-600 focus:ring-offset-2"
              question={`Confirm: remove case-manager access for ${member.email}?`}
              confirmLabel="Confirm removal"
              onConfirm={() => onRemove(member, reason.trim())}
              disabled={busy || !reason.trim()}
            />
          </td>
        </tr>
      )}
    </>
  );
}

export default function StaffAccess() {
  const user = getUser();
  const staff = isStaffUser(user);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [grant, setGrant] = useState({ email: '', reason: '' });
  const listHeadingId = useId();
  const grantHeadingId = useId();
  const reasonHintId = useId();
  const listHeadingRef = useRef(null);
  const errorRef = useRef(null);

  const load = useCallback(async () => {
    setMembers((await staffService.list()).staff);
  }, []);

  useEffect(() => {
    if (!staff) return;
    load()
      .catch((err) => setError(getApiErrorMessage(err, 'Could not load who has staff access.')))
      .finally(() => setLoading(false));
  }, [load, staff]);

  // A refused change is announced (role="alert") and also takes focus, because the button that was pressed has gone
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  // Runs a change, then reloads the list so it shows who has access now. After a change focus moves to the list heading
  // for the same reason.
  const change = async (action, successMessage) => {
    setError('');
    setNotice('');
    setBusy(true);
    try {
      const { user: changed } = await action();
      setNotice(successMessage(changed));
      await load().catch((err) => setError(getApiErrorMessage(err, 'Could not refresh the list.')));
      listHeadingRef.current?.focus();
      return true;
    } catch (err) {
      setError(getApiErrorMessage(err, 'That change failed.'));
      load().catch(() => {}); // the list may have changed under us
      return false;
    } finally {
      setBusy(false);
    }
  };

  const handleGrant = async () => {
    const done = await change(
      () => staffService.grant(grant.email.trim(), grant.reason.trim()),
      (changed) => `${changed.email} now has case-manager access.`
    );
    if (done) setGrant({ email: '', reason: '' });
  };

  const handleRemove = (member, reason) =>
    change(
      () => staffService.revoke(member.id, reason),
      (changed) => `${changed.email} no longer has case-manager access.`
    );

  return (
    <div className="min-h-screen bg-gray-50">
      <AppNav title="Staff Access" subtitle="Who can work cases, granted in the app and recorded" />

      <main id="main" tabIndex={-1} className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8 focus:outline-none">
        <DemoEnvironmentBanner />

        {!staff ? (
          <div className="bg-white rounded-lg shadow-md p-6 text-gray-700">Staff Access is available to case managers only.</div>
        ) : (
          <>
            {error && (
              <div ref={errorRef} tabIndex={-1} role="alert" className="mb-4 p-4 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm wrap-anywhere focus:outline-none">
                {error}
              </div>
            )}
            {notice && <div role="status" className="mb-4 p-4 bg-green-50 border border-green-200 text-green-800 rounded-lg text-sm wrap-anywhere">{notice}</div>}

            <p className="mb-6 text-sm text-gray-700">
              Case-manager access is granted here by an existing case manager, never by registering. Every change is recorded in the{' '}
              <Link to="/audit" className="text-blue-700 underline hover:text-blue-800 rounded focus:outline-none focus:ring-2 focus:ring-blue-500">
                Security Audit Log
              </Link>
              .
            </p>

            <section className="bg-white rounded-lg shadow-md mb-6">
              <h2 id={listHeadingId} ref={listHeadingRef} tabIndex={-1} className="text-xl font-bold text-gray-900 px-6 pt-6 pb-3 focus:outline-none">
                Current staff
              </h2>
              <div className="overflow-x-auto">
                <table aria-labelledby={listHeadingId} className="min-w-full text-sm">
                  <thead className="bg-gray-50 text-left text-gray-600">
                    <tr>
                      <th scope="col" className="px-2 sm:px-4 py-3 font-medium">Name</th>
                      <th scope="col" className="px-2 sm:px-4 py-3 font-medium">Email</th>
                      <th scope="col" className="hidden sm:table-cell px-4 py-3 font-medium">Role</th>
                      <th scope="col" className="px-2 sm:px-4 py-3 font-medium">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {loading ? (
                      <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-600">Loading...</td></tr>
                    ) : members.length === 0 ? (
                      <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-600">No staff to show.</td></tr>
                    ) : (
                      members.map((member) => (
                        <StaffRow
                          key={member.id}
                          member={member}
                          isYou={member.id === user?.id}
                          onlyOne={members.length <= 1}
                          busy={busy}
                          onRemove={handleRemove}
                        />
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="bg-white rounded-lg shadow-md p-6">
              <h2 id={grantHeadingId} className="text-xl font-bold text-gray-900">Give case-manager access</h2>
              <p className="text-sm text-gray-600 mt-1 mb-4">The person needs an account first. Case managers review and decide cases, so give access only to people who need it.</p>
              <form onSubmit={(e) => e.preventDefault()} aria-labelledby={grantHeadingId} className="space-y-4 max-w-xl">
                <div>
                  <label htmlFor="grant-email" className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                  <input
                    id="grant-email"
                    type="email"
                    autoComplete="off"
                    required
                    value={grant.email}
                    onChange={(e) => setGrant((prev) => ({ ...prev, email: e.target.value }))}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label htmlFor="grant-reason" className="block text-sm font-medium text-gray-700 mb-1">Reason</label>
                  <textarea
                    id="grant-reason"
                    rows={3}
                    required
                    maxLength={MAX_REASON}
                    aria-describedby={reasonHintId}
                    value={grant.reason}
                    onChange={(e) => setGrant((prev) => ({ ...prev, reason: e.target.value }))}
                    className={inputClass}
                  />
                  <p id={reasonHintId} className="text-xs text-gray-600 mt-1">Required. Kept in the Security Audit Log with your name.</p>
                </div>
                <div className="wrap-anywhere">
                  <ConfirmAction
                    label="Give access"
                    className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2"
                    question={`Confirm: give ${grant.email.trim()} case-manager access?`}
                    confirmLabel="Confirm access"
                    onConfirm={handleGrant}
                    disabled={busy || !grant.email.trim() || !grant.reason.trim()}
                  />
                </div>
              </form>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
