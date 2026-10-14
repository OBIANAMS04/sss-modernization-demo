import api from './api';

export const dashboardService = {
  // The signed-in user's own applications, eligibility, case history and notifications.
  citizen: async () => (await api.get('/dashboards/citizen')).data,
  // Case managers and admins: the caller's open cases, what waits on them, the unassigned queue, what is overdue.
  caseManager: async () => (await api.get('/dashboards/case-manager')).data,
  // Admins: all cases, team performance and system health.
  admin: async () => (await api.get('/dashboards/admin')).data,
  // Leadership and admins: aggregates only (KPIs, trends, bottlenecks, team performance).
  leadership: async () => (await api.get('/dashboards/leadership')).data,
};
