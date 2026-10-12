import api from './api';

const params = (filters = {}) =>
  Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== '' && v !== undefined && v !== null));

// Staff only.
export const auditService = {
  list: async (filters, page = 1, pageSize = 50) =>
    (await api.get('/audit', { params: { ...params(filters), limit: pageSize, offset: (page - 1) * pageSize } })).data,
  stats: async () => (await api.get('/audit/stats')).data,
};
