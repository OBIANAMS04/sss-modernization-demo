import { useEffect, useRef, useState } from 'react';
import { getApiErrorMessage } from '../../utils/apiError';
import { mfaService } from '../../services/mfaService';
import AppNav from '../Common/AppNav';
import DemoEnvironmentBanner from '../DemoEnvironmentBanner';
import CodeField from './CodeField';

// STORY-003: turn two-step verification (MFA) on or off. An authenticator app (Google Authenticator, Authy, Microsoft
// Authenticator) scans the QR code, or takes the setup key typed in; the 6-digit code it then shows confirms the setup.

const CODE_FIELD_ID = 'mfa-setup-code';
const buttonClass = 'px-4 py-2 rounded-lg text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2 disabled:opacity-50 transition duration-200';

// "ABCDEFGH..." as "ABCD EFGH ...", which is easier to read out and to copy by eye
const grouped = (secret) => secret.match(/.{1,4}/g).join(' ');

export default function MfaSetup() {
  const [enabled, setEnabled] = useState(null); // null until the status has loaded
  const [setup, setSetup] = useState(null); // { secret, qrCode } while a setup waits for its code
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState(''); // about the code field: not 6 digits, or not accepted
  const [error, setError] = useState(''); // about the page: could not load, or the tries are used up
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const codeRef = useRef(null);
  const errorRef = useRef(null);
  const statusHeadingRef = useRef(null);
  const setupHeadingRef = useRef(null);
  const startRef = useRef(null);
  const cancelled = useRef(false);

  useEffect(() => {
    mfaService
      .status()
      .then((status) => setEnabled(status.mfaEnabled))
      .catch((err) => setError(getApiErrorMessage(err, 'Could not load your two-step verification status.')));
  }, []);

  // A refused request is announced (role="alert") and also takes focus, because the button that was pressed may be gone
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  // Starting a setup moves focus to its first step; cancelling gives focus back to the button that started it
  useEffect(() => {
    if (setup) setupHeadingRef.current?.focus();
    else if (cancelled.current) {
      cancelled.current = false;
      startRef.current?.focus();
    }
  }, [setup]);

  const handleStart = async () => {
    setError('');
    setNotice('');
    setBusy(true);
    try {
      const { secret, qrCode } = await mfaService.startSetup();
      setCode('');
      setCodeError('');
      setSetup({ secret, qrCode });
    } catch (err) {
      setError(getApiErrorMessage(err, 'Could not start setup. Please try again.'));
    } finally {
      setBusy(false);
    }
  };

  const handleCancel = () => {
    cancelled.current = true;
    setSetup(null);
    setCode('');
    setCodeError('');
  };

  // Confirming and turning off ask for a code the same way: check its shape here, then let the server judge it
  const submitCode = (action, successMessage, afterwards) => async (e) => {
    e.preventDefault();
    const entered = code.replace(/\s/g, ''); // an app shows "123 456"; spaces are not part of the code
    if (!/^\d{6}$/.test(entered)) {
      setCodeError('Enter the 6-digit code from your authenticator app.');
      codeRef.current?.focus();
      return;
    }

    setError('');
    setNotice('');
    setBusy(true);
    try {
      await action(entered);
      afterwards();
      setCode('');
      setCodeError('');
      setNotice(successMessage);
      statusHeadingRef.current?.focus();
    } catch (err) {
      const message = getApiErrorMessage(err, 'We could not check that code. Please try again.');
      setCode('');
      if (err.response?.status === 429) {
        setCodeError('');
        setError(message); // the tries for this sign-in are used up; signing in again starts a new count
      } else {
        setCodeError(message);
        codeRef.current?.focus();
      }
    } finally {
      setBusy(false);
    }
  };

  const handleConfirm = submitCode(
    mfaService.confirmSetup,
    'Two-step verification is now on. You will be asked for a code from your authenticator app each time you sign in.',
    () => {
      setSetup(null);
      setEnabled(true);
    }
  );

  const handleDisable = submitCode(
    mfaService.disable,
    'Two-step verification is off. Signing in needs only your password again.',
    () => setEnabled(false)
  );

  const codeField = (hint) => (
    <CodeField
      id={CODE_FIELD_ID}
      inputRef={codeRef}
      value={code}
      onChange={(value) => {
        setCode(value);
        if (codeError) setCodeError('');
      }}
      error={codeError}
      hint={hint}
    />
  );

  return (
    <div className="min-h-screen bg-gray-50">
      <AppNav title="Two-step verification" subtitle="Protect your account with a code from an authenticator app (MFA)" />

      <main id="main" tabIndex={-1} className="max-w-3xl mx-auto py-8 px-4 sm:px-6 lg:px-8 focus:outline-none">
        <DemoEnvironmentBanner />

        {error && (
          <div ref={errorRef} tabIndex={-1} role="alert" className="mb-4 p-4 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm wrap-anywhere focus:outline-none">
            {error}
          </div>
        )}
        {notice && <div role="status" className="mb-4 p-4 bg-green-50 border border-green-200 text-green-800 rounded-lg text-sm wrap-anywhere">{notice}</div>}

        <section aria-labelledby="mfa-status-heading" className="bg-white rounded-lg shadow-md p-6 mb-6">
          <h2 id="mfa-status-heading" ref={statusHeadingRef} tabIndex={-1} className="text-xl font-bold text-gray-900 focus:outline-none">
            Status
          </h2>
          {enabled === null ? (
            !error && <p className="mt-2 text-gray-600">Loading...</p>
          ) : (
            <>
              <p className="mt-2 text-gray-900 font-medium">
                Two-step verification is{' '}
                <span className={`inline-block text-xs font-medium px-2 py-1 rounded-full ${enabled ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-700'}`}>
                  {enabled ? 'On' : 'Off'}
                </span>
              </p>
              <p className="mt-1 text-gray-700 wrap-anywhere">
                {enabled
                  ? 'After your password, sign-in asks for a code from your authenticator app.'
                  : 'Signing in needs only your password. Add a code from an authenticator app (Google Authenticator, Authy or Microsoft Authenticator) for more protection.'}
              </p>
              {!enabled && !setup && (
                <button
                  type="button"
                  ref={startRef}
                  onClick={handleStart}
                  disabled={busy}
                  className={`${buttonClass} mt-4 bg-blue-600 text-white hover:bg-blue-700`}
                >
                  {busy ? 'Starting...' : 'Set up an authenticator app'}
                </button>
              )}
            </>
          )}
        </section>

        {setup && (
          <section aria-labelledby="mfa-setup-heading" className="bg-white rounded-lg shadow-md p-6 mb-6">
            <h2 id="mfa-setup-heading" ref={setupHeadingRef} tabIndex={-1} className="text-xl font-bold text-gray-900 focus:outline-none">
              Set up your authenticator app
            </h2>
            <ol className="mt-4 list-decimal pl-5 space-y-5 text-gray-700">
              <li className="pl-1">Install an authenticator app on your phone, such as Google Authenticator, Authy or Microsoft Authenticator.</li>
              <li className="pl-1">
                In the app, add an account and scan this QR code.
                <img
                  src={setup.qrCode}
                  alt="QR code for your authenticator app. The setup key below adds the same account if you cannot scan it."
                  width={240}
                  height={240}
                  className="mt-3 h-auto max-w-full rounded-lg border border-gray-300 bg-white"
                />
              </li>
              <li className="pl-1">
                If you cannot scan it, choose to enter a key in the app and type this setup key (time-based, 6 digits):
                <code className="mt-2 block rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 text-base font-semibold tracking-wider text-gray-900 wrap-anywhere select-all">
                  {grouped(setup.secret)}
                </code>
              </li>
              <li className="pl-1">Enter the 6-digit code the app shows now to finish.</li>
            </ol>

            <form onSubmit={handleConfirm} noValidate className="mt-4 max-w-sm space-y-4">
              {codeField('6 digits. The app shows a new code every 30 seconds.')}
              <div className="flex flex-wrap gap-3">
                <button type="submit" disabled={busy} className={`${buttonClass} bg-blue-600 text-white hover:bg-blue-700`}>
                  {busy ? 'Checking...' : 'Verify and turn on'}
                </button>
                <button type="button" onClick={handleCancel} disabled={busy} className={`${buttonClass} border border-gray-500 bg-white text-gray-700 hover:bg-gray-50`}>
                  Cancel
                </button>
              </div>
            </form>
          </section>
        )}

        {enabled && (
          <section aria-labelledby="mfa-off-heading" className="bg-white rounded-lg shadow-md p-6">
            <h2 id="mfa-off-heading" className="text-xl font-bold text-gray-900">Turn off two-step verification</h2>
            <p className="mt-1 text-sm text-gray-600">Enter a current code from your authenticator app to confirm it is you.</p>
            <form onSubmit={handleDisable} noValidate className="mt-4 max-w-sm space-y-4">
              {codeField('6 digits. A code that was just used will not work: wait for the next one.')}
              <button type="submit" disabled={busy} className={`${buttonClass} bg-red-600 text-white hover:bg-red-700`}>
                {busy ? 'Checking...' : 'Turn off two-step verification'}
              </button>
            </form>
          </section>
        )}
      </main>
    </div>
  );
}
