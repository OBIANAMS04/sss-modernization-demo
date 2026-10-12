import { useEffect, useId, useRef, useState } from 'react';

/**
 * STORY-011 (WCAG 3.3.4 Error Prevention): an applicant confirms a submission with legal effect before it is sent.
 * The button (`label`, styled by `className`) is replaced in place by `question` with Confirm and Cancel. Focus moves to
 * Confirm; Cancel brings the button back and puts focus on it.
 */
export default function ConfirmAction({ label, className, question, confirmLabel, onConfirm, disabled }) {
  const [asking, setAsking] = useState(false);
  const questionId = useId();
  const triggerRef = useRef(null);
  const confirmRef = useRef(null);
  const cancelled = useRef(false);

  useEffect(() => {
    if (asking) {
      confirmRef.current?.focus();
    } else if (cancelled.current) {
      cancelled.current = false;
      triggerRef.current?.focus();
    }
  }, [asking]);

  if (!asking) {
    return (
      <button type="button" ref={triggerRef} onClick={() => setAsking(true)} disabled={disabled} className={className}>
        {label}
      </button>
    );
  }

  return (
    <div role="group" aria-labelledby={questionId} className="mt-2 w-full">
      <p id={questionId} className="text-sm text-gray-700">{question}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          ref={confirmRef}
          onClick={() => {
            setAsking(false);
            onConfirm();
          }}
          disabled={disabled}
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
        >
          {confirmLabel}
        </button>
        <button
          type="button"
          onClick={() => {
            cancelled.current = true;
            setAsking(false);
          }}
          className="bg-white text-gray-700 border border-gray-500 hover:bg-gray-50 px-4 py-2 rounded-lg text-sm font-medium"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
