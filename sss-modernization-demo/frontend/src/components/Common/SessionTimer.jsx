import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { authService } from '../../services/authService';
import { clearAuth, getToken, setToken } from '../../utils/tokenManager';

// STORY-011 (WCAG 2.2.1 Timing Adjustable): a sign-in lasts an hour, so people are warned two minutes before it
// ends and can extend it. The token's own expiry is the clock. The warning names the time the session ends rather
// than counting down, because a screen reader would announce every tick of a countdown.
const WARN_MS = 120 * 1000;

/** When a token expires (milliseconds since the epoch), or null when there is no token or it cannot be read. */
function expiryOf(token) {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return typeof payload.exp === 'number' ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

const clockTime = (ms) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

const buttonBase = 'rounded-lg px-4 py-2 text-sm font-medium focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:ring-offset-2';

export default function SessionTimer() {
  const navigate = useNavigate();
  const [expiresAt, setExpiresAt] = useState(() => expiryOf(getToken()));
  const [warnedFor, setWarnedFor] = useState(null); // the expiry the warning is about; a new token has a new expiry, which closes it
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const stayRef = useRef(null);
  const signOutRef = useRef(null);
  const ended = useRef(false); // signed out here, so a late reply must not bring the session back
  const open = expiresAt !== null && warnedFor === expiresAt;

  // Warn two minutes before the session ends (at once if that moment has passed) and sign out when it ends.
  // Another tab may have extended the session meanwhile, so each timer checks the stored token before it acts.
  useEffect(() => {
    if (!expiresAt) return undefined;
    const changed = () => expiryOf(getToken()) !== expiresAt;
    const warn = setTimeout(() => {
      if (changed()) setExpiresAt(expiryOf(getToken()));
      else setWarnedFor(expiresAt);
    }, Math.max(0, expiresAt - WARN_MS - Date.now()));
    const end = setTimeout(() => {
      if (changed()) {
        setExpiresAt(expiryOf(getToken()));
        return;
      }
      ended.current = true;
      clearAuth();
      navigate('/login?expired=1');
    }, Math.max(0, expiresAt - Date.now()));
    return () => {
      clearTimeout(warn);
      clearTimeout(end);
    };
  }, [expiresAt, navigate]);

  // Extending the session in another tab (or signing out there) changes the stored token
  useEffect(() => {
    const sync = () => setExpiresAt(expiryOf(getToken()));
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);

  // The warning takes focus when it opens and gives it back to whatever had it when it closes
  useEffect(() => {
    if (!open) return undefined;
    const opener = document.activeElement;
    stayRef.current?.focus();
    return () => opener?.focus();
  }, [open]);

  const stay = async () => {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      const { token } = await authService.refresh();
      const next = expiryOf(token);
      if (ended.current) return;
      if (next === null) throw new Error('The replacement token could not be read');
      setToken(token);
      setExpiresAt(next); // closes the warning and schedules the next one
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const signOut = () => {
    ended.current = true;
    authService.logout(); // recorded in the audit log; sign-out does not wait for it
    clearAuth();
    navigate('/login');
  };

  // Escape is the same as staying signed in. Focus cycles between the two buttons and cannot reach the page behind.
  const onKeyDown = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      stay();
    } else if (event.key === 'Tab') {
      event.preventDefault();
      const buttons = [stayRef.current, signOutRef.current];
      const at = buttons.indexOf(document.activeElement);
      buttons[event.shiftKey ? (at <= 0 ? buttons.length - 1 : at - 1) : (at + 1) % buttons.length].focus();
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 focus:outline-hidden" tabIndex={-1} onKeyDown={onKeyDown}>
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="session-timer-title"
        aria-describedby="session-timer-description"
        className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl"
      >
        <h2 id="session-timer-title" className="text-xl font-bold text-gray-900">Your session is about to end</h2>
        <p id="session-timer-description" className="mt-2 text-sm text-gray-700">
          For your security, you will be signed out at {clockTime(expiresAt)} unless you choose to stay signed in.
        </p>
        {failed && (
          <p role="alert" className="mt-3 text-sm text-red-700">
            We could not extend your session. Please try again.
          </p>
        )}
        <div className="mt-6 flex flex-wrap gap-3">
          <button
            ref={stayRef}
            type="button"
            onClick={stay}
            aria-disabled={busy || undefined}
            className={`${buttonBase} bg-blue-600 text-white hover:bg-blue-700 aria-disabled:opacity-60`}
          >
            Stay signed in
          </button>
          <button
            ref={signOutRef}
            type="button"
            onClick={signOut}
            className={`${buttonBase} border border-gray-500 bg-white text-gray-700 hover:bg-gray-50`}
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
