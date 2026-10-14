import { useEffect, useState } from 'react';
import { getApiErrorMessage } from '../utils/apiError';
import { notificationService } from '../services/notificationService';

/**
 * The signed-in user's latest notifications, for the card beside a dashboard, with "Mark all read". Not being able to read
 * them is not shown: the dashboard does not depend on them. `notice` confirms a mark-all-read, since the button is gone once
 * everything is read.
 */
export default function useInbox(enabled = true) {
  const [inbox, setInbox] = useState({ notifications: [], unread: 0 });
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (enabled) notificationService.list(5).then(setInbox).catch(() => {});
  }, [enabled]);

  const markAllRead = async () => {
    setError('');
    try {
      await notificationService.markAllRead();
      setInbox(await notificationService.list(5));
      setNotice('All notifications marked as read.');
    } catch (err) {
      setError(getApiErrorMessage(err, 'Could not mark your notifications as read.'));
    }
  };

  return { inbox, markAllRead, notice, error };
}
