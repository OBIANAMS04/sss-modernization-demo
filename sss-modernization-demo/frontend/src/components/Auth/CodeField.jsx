// STORY-003: the field for a 6-digit authentication code, shared by the sign-in step and the setup page. STORY-041: also the
// field for a recovery code (letters and digits), with recovery set.
// `error` is announced (role="alert") and marks the field invalid; the caller moves focus to it after a failed submit.
export default function CodeField({ id, label = 'Authentication code', hint, value, onChange, error, inputRef, recovery = false }) {
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;

  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-gray-700 mb-2">{label}</label>
      <input
        id={id}
        ref={inputRef}
        type="text"
        name={recovery ? 'recovery-code' : 'code'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        inputMode={recovery ? 'text' : 'numeric'}
        autoComplete={recovery ? 'off' : 'one-time-code'}
        autoCapitalize={recovery ? 'characters' : undefined}
        pattern={recovery ? undefined : '[0-9]{6}'}
        spellCheck={false}
        aria-required="true"
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={error ? `${hintId} ${errorId}` : hintId}
        className={`w-full px-4 py-2 border rounded-lg text-lg tracking-widest focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition ${
          error ? 'border-red-500' : 'border-gray-500'
        }`}
      />
      <p id={hintId} className="text-gray-600 text-xs mt-1">{hint}</p>
      {error && <p id={errorId} role="alert" className="text-red-700 text-sm mt-1 wrap-anywhere">{error}</p>}
    </div>
  );
}
