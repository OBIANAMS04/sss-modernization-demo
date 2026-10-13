import api from './api';

// Staff only.
export const staffService = {
  list: async () => (await api.get('/staff')).data,
  grant: async (email, reason) => (await api.post('/staff/grant', { email, reason })).data,
  revoke: async (id, reason) => (await api.post(`/staff/${id}/revoke`, { reason })).data,
};
