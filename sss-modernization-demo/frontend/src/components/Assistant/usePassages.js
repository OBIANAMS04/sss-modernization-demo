import { useCallback, useRef, useState } from 'react';
import { assistantService } from '../../services/assistantService';
import { getApiErrorMessage } from '../../utils/apiError';

/**
 * STORY-019: the policy passages a citation opens. Each is read once, when it is first opened, and kept for the life of the page.
 * `passages[id]` is { state: 'loading' }, { state: 'ready', passage } or { state: 'error', message }; a failed one is tried again
 * the next time it is opened. `seed` stores passages the page already holds (the policy text returned with an answer).
 */
export default function usePassages() {
  const [passages, setPassages] = useState({});
  const requested = useRef(new Set());

  const load = useCallback((id) => {
    if (requested.current.has(id)) return;
    requested.current.add(id);
    setPassages((prev) => ({ ...prev, [id]: { state: 'loading' } }));
    assistantService
      .passage(id)
      .then((passage) => setPassages((prev) => ({ ...prev, [id]: { state: 'ready', passage } })))
      .catch((err) => {
        requested.current.delete(id);
        setPassages((prev) => ({ ...prev, [id]: { state: 'error', message: getApiErrorMessage(err, 'Could not open this policy passage.') } }));
      });
  }, []);

  const seed = useCallback((list) => {
    for (const { passageId } of list) requested.current.add(passageId);
    setPassages((prev) => ({
      ...prev,
      ...Object.fromEntries(list.map(({ passageId, docTitle, heading, text }) => [passageId, { state: 'ready', passage: { id: passageId, docTitle, heading, text } }])),
    }));
  }, []);

  return { passages, load, seed };
}
