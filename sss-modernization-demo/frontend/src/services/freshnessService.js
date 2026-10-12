import api from './api';

// Staff only.
export const freshnessService = {
  dashboard: async (hours = 24) => (await api.get('/freshness/dashboard', { params: { hours } })).data,
  probe: async () => (await api.post('/freshness/probe')).data,
};
