import api from './api';

export const dashboardService = {
  // The signed-in user's own applications, eligibility, case history and notifications.
  citizen: async () => (await api.get('/dashboards/citizen')).data,
};
