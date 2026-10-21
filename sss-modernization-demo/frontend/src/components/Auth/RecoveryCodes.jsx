import { useEffect, useRef, useState } from 'react';

// STORY-041: the recovery codes, shown once (when two-step verification is turned on, or when new ones are made). Each works once in
// place of the 6-digit code at sign-in, for someone who has lost their authenticator. They can be copied or saved as a text file.
export default function RecoveryCodes({ codes, onDone }) {
  const headingRef = useRef(null);
  const [copied, setCopied] = useState('');

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const text = `SSS Modernization Demo: two-step verification recovery codes\nEach code works once.\n\n${codes.join('\n')}\n`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied('Copied. Keep them somewhere safe.');
    } catch {
      setCopied('Copying is blocked in this browser. Select the codes and copy them instead.');
    }
  };

  const download = () => {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    link.download = 'sss-demo-recovery-codes.txt';
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const button = 'px-4 py-2 rounded-lg text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2 transition duration-200';

  return (
    <section aria-labelledby="recovery-codes-heading" className="bg-white rounded-lg shadow-md p-6 mb-6 border-2 border-amber-400">
      <h2 id="recovery-codes-heading" ref={headingRef} tabIndex={-1} className="text-xl font-bold text-gray-900 focus:outline-none">
        Save your recovery codes
      </h2>
      <p className="mt-2 text-gray-700">
        If you lose your phone or authenticator app, sign in with one of these codes instead of the 6-digit code. Each code works once.
        <strong> This is the only time they are shown.</strong>
      </p>
      <ul aria-label="Recovery codes" className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-2 font-mono text-base text-gray-900 select-all">
        {codes.map((code) => (
          <li key={code} className="rounded border border-gray-300 bg-gray-50 px-3 py-1.5 tracking-wider">{code}</li>
        ))}
      </ul>
      <div className="mt-4 flex flex-wrap gap-3">
        <button type="button" onClick={copy} className={`${button} border border-gray-500 bg-white text-gray-700 hover:bg-gray-50`}>Copy codes</button>
        <button type="button" onClick={download} className={`${button} border border-gray-500 bg-white text-gray-700 hover:bg-gray-50`}>Download as a text file</button>
        <button type="button" onClick={onDone} className={`${button} bg-blue-600 text-white hover:bg-blue-700`}>I have saved them</button>
      </div>
      <p role="status" className="mt-2 text-sm text-gray-700">{copied}</p>
    </section>
  );
}
