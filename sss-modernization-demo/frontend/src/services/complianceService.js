import api from './api';

const params = (filters = {}) =>
  Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== '' && v !== undefined && v !== null));

// Staff only, except the matrix.
export const complianceService = {
  matrix: async () => (await api.get('/compliance/matrix')).data,
  dashboard: async (days = 30) => (await api.get('/compliance/dashboard', { params: { days } })).data,
  decisions: async (filters, page = 1) => (await api.get('/compliance/decisions', { params: { ...params(filters), page } })).data,
  caseCompliance: async (caseId) => (await api.get(`/compliance/cases/${caseId}`)).data,
  reviews: async (status = 'Open') => (await api.get('/compliance/reviews', { params: { status } })).data.reviews,
  resolve: async (reviewId, action, note) => (await api.post(`/compliance/reviews/${reviewId}/resolve`, { action, note })).data,
};
