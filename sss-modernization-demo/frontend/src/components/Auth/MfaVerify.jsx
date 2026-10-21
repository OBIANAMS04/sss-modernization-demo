import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { authService } from '../../services/authService';
import { clearPendingMfaToken, getPendingMfaToken, setToken, setUser } from '../../utils/tokenManager';
import { getApiErrorMessage } from '../../utils/apiError';
import usePageTitle from '../../utils/usePageTitle';
import CodeField from './CodeField';

// STORY-003: the second step of sign-in for an account with two-step verification. The password was already right; the
// session starts only when the authentication code is. The pending token from the first step lasts five minutes.

/** When the pending token ends (milliseconds since the epoch), or null if it cannot be read. Read like SessionTimer reads a session. */
function expiryOf(token) {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return typeof payload.exp === 'number' ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

export default function MfaVerify() {
  usePageTitle('Enter your code');
  const navigate = useNavigate();
  const [pendingToken] = useState(getPendingMfaToken); // read once: it is cleared when this step ends
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  // STORY-041: someone who has lost their authenticator signs in with one of their recovery codes instead
  const [useRecovery, setUseRecovery] = useState(false);
  const inputRef = useRef(null);

  // Back to the password step, and say why on that page
  const leave = useCallback(
    (reason) => {
      clearPendingMfaToken();
      navigate('/login', { replace: true, state: { mfaEnded: reason } });
    },
    [navigate]
  );

  // The pending token ends after five minutes; the server would only answer 401 and the page would reload without a reason
  useEffect(() => {
    const end = expiryOf(pendingToken);
    if (!end) return undefined;
    const timer = setTimeout(() => leave('expired'), Math.max(0, end - Date.now()));
    return () => clearTimeout(timer);
  }, [pendingToken, leave]);

  // This page has one field and one purpose, so focus starts there (the page behind it was replaced)
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Someone who opens this address without having just entered a password has nothing to finish
  if (!pendingToken) return <Navigate to="/login" replace />;

  const fail = (message) => {
    setError(message);
    setCode('');
    inputRef.current?.focus();
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const entered = code.replace(/\s/g, ''); // an app shows "123 456"; spaces are not part of the code
    if (useRecovery ? !/^[A-Za-z2-7-]{16,19}$/.test(entered) : !/^\d{6}$/.test(entered)) {
      setError(useRecovery ? 'Enter one of your recovery codes, like ABCD-EFGH-JKLM-NPQR.' : 'Enter the 6-digit code from your authenticator app.');
      inputRef.current?.focus();
      return;
    }

    setLoading(true);
    try {
      const response = useRecovery
        ? await authService.verifyMfaRecovery(pendingToken, entered)
        : await authService.verifyMfa(pendingToken, entered);
      clearPendingMfaToken();
      setToken(response.token);
      setUser(response.user);
      navigate('/dashboard');
    } catch (err) {
      // 429: the five tries are used up, so the pending sign-in is over and the password is asked for again
      if (err.response?.status === 429) {
        leave('attempts');
        return;
      }
      fail(getApiErrorMessage(err, 'We could not check that code. Please try again.'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <main id="main" className="flex items-center justify-center min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 px-4 py-12">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-lg shadow-xl p-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2 text-center">Two-step verification</h1>
          <p className="text-gray-600 text-center mb-6">
            {useRecovery
              ? 'Enter one of the recovery codes you saved when you turned on two-step verification. Each works once.'
              : 'Enter the 6-digit code from your authenticator app to finish signing in.'}
          </p>

          <form onSubmit={handleSubmit} noValidate className="space-y-4">
            <CodeField
              key={useRecovery ? 'recovery' : 'code'}
              id={useRecovery ? 'mfa-recovery-code' : 'mfa-code'}
              label={useRecovery ? 'Recovery code' : 'Authentication code'}
              recovery={useRecovery}
              inputRef={inputRef}
              value={code}
              onChange={(value) => {
                setCode(value);
                if (error) setError('');
              }}
              error={error}
              hint={useRecovery ? '16 letters and digits; dashes and spaces are optional.' : '6 digits. The app shows a new code every 30 seconds.'}
            />

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-600 text-white py-2 px-4 rounded-lg font-semibold hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition duration-200"
            >
              {loading ? 'Checking...' : 'Verify and sign in'}
            </button>
          </form>

          <div className="mt-4 text-center">
            <button
              type="button"
              onClick={() => {
                setUseRecovery(!useRecovery);
                setCode('');
                setError('');
                setTimeout(() => inputRef.current?.focus(), 0);
              }}
              className="text-blue-700 hover:text-blue-800 text-sm font-semibold underline focus:outline-none focus:ring-2 focus:ring-blue-600 rounded"
            >
              {useRecovery ? 'Use the code from my authenticator app' : 'Lost your authenticator? Use a recovery code'}
            </button>
          </div>

          <div className="mt-6 text-center">
            <p className="text-gray-600 text-sm">
              Not your account, or no code?{' '}
              <Link to="/login" onClick={() => clearPendingMfaToken()} className="text-blue-600 hover:text-blue-700 font-semibold">
                Sign in again
              </Link>
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
