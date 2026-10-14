import api from './api';

// Staff only. A case manager gives and removes case-manager access; an admin also leadership and admin access.
export const staffService = {
  list: async () => (await api.get('/staff')).data,
  grant: async (email, reason, role = 'case_manager') => (await api.post('/staff/grant', { email, role, reason })).data,
  revoke: async (id, reason) => (await api.post(`/staff/${id}/revoke`, { reason })).data,
};
