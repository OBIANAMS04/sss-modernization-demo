import api from './api';

const params = (filters = {}) =>
  Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== '' && v !== undefined && v !== null && v !== false));

export const caseService = {
  apply: async (exemptionId) => (await api.post('/cases', { exemptionId })).data,
  myCases: async () => (await api.get('/cases')).data,
  getCase: async (id) => (await api.get(`/cases/${id}`)).data,
  changeStatus: async (id, status, reason) => (await api.post(`/cases/${id}/status`, { status, reason })).data,
  assign: async (id, assignedTo) => (await api.put(`/cases/${id}/assignment`, { assignedTo })).data,
  addNote: async (id, content) => (await api.post(`/cases/${id}/notes`, { content })).data,
  addDocument: async (id, documentType, documentUrl) =>
    (await api.post(`/cases/${id}/documents`, { documentType, documentUrl })).data,

  // Staff only
  listAll: async (filters, page = 1) => (await api.get('/cases', { params: { scope: 'all', page, limit: 25, ...params(filters) } })).data,
  stats: async () => (await api.get('/cases/stats')).data,
  managers: async () => (await api.get('/cases/managers')).data.managers,
  exportCsv: async (filters) => {
    const response = await api.get('/cases/export', { params: params(filters), responseType: 'blob' });
    const url = URL.createObjectURL(response.data);
    const link = document.createElement('a');
    link.href = url;
    link.download = `sss-cases-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  },
};
