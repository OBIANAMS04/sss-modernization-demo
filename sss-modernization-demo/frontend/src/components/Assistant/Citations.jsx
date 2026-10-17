import { sourceButtonId, sourceName } from './format';

/** The passage text with the quoted part marked, when the quote is in it. */
function PassageText({ text, quote }) {
  const at = quote ? text.indexOf(quote) : -1;
  if (at < 0) return text;
  return (
    <>
      {text.slice(0, at)}
      <mark className="bg-yellow-100 text-gray-900">{quote}</mark>
      {text.slice(at + quote.length)}
    </>
  );
}

/** What opening a source shows: the passage, or that it is loading or could not be read. */
function PassagePanel({ id, entry, quote }) {
  return (
    <div id={id} aria-live="polite" className="mt-2 rounded-lg border border-gray-400 bg-gray-50 p-3 text-sm">
      {entry?.state === 'ready' ? (
        <>
          <p className="font-semibold text-gray-900 wrap-anywhere">{sourceName(entry.passage)}</p>
          <p className="mt-1 whitespace-pre-line text-gray-800 wrap-anywhere">
            <PassageText text={entry.passage.text} quote={quote} />
          </p>
          <p className="mt-2 text-gray-600">Demo policy, written for this synthetic demonstration. It is not Selective Service System policy.</p>
        </>
      ) : entry?.state === 'error' ? (
        <p role="alert" className="text-red-800 wrap-anywhere">{entry.message}</p>
      ) : (
        <p role="status" className="text-gray-700">Loading the policy passage...</p>
      )}
    </div>
  );
}

/**
 * STORY-019: the sources of an answer, or the policy sections a question matched, as a numbered list. Each is a button that opens the
 * passage under it (a disclosure: focus stays on the button, which says whether it is open); a citation also shows the quote it
 * rests on. `open` is the set of indexes that are open, `onToggle(index)` opens or closes one, `passages` is usePassages().passages,
 * `as` is the heading level for the label ('h3' under a page section, 'h4' under a question in the history).
 */
export default function Citations({ base, label, items, open, onToggle, passages, as: Heading = 'h3' }) {
  if (items.length === 0) return null;
  return (
    <div className="mt-4">
      <Heading className="text-sm font-semibold text-gray-900">{label}</Heading>
      <ol className="mt-2 space-y-3">
        {items.map((item, i) => {
          const isOpen = open.has(i);
          const panelId = `${base}-passage-${i + 1}`;
          return (
            <li key={`${item.passageId}-${i}`} className="text-sm">
              <button
                id={sourceButtonId(base, i)}
                type="button"
                aria-expanded={isOpen}
                aria-controls={isOpen ? panelId : undefined}
                onClick={() => onToggle(i)}
                className="rounded text-left font-medium text-blue-700 underline hover:text-blue-900 wrap-anywhere"
              >
                [{i + 1}] {sourceName(item)}
                <span className="sr-only">{isOpen ? '. Close the policy passage' : '. Open the policy passage'}</span>
              </button>
              {item.quote && <p className="mt-1 text-gray-700 wrap-anywhere">&ldquo;{item.quote}&rdquo;</p>}
              {isOpen && <PassagePanel id={panelId} entry={passages[item.passageId]} quote={item.quote} />}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
