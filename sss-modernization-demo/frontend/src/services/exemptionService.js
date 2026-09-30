import api from './api';

export const exemptionService = {
  // Latest saved determination: one entry per exemption type (empty if never checked).
  getExemptions: async () => {
    const response = await api.get('/exemptions');
    return response.data;
  },

  checkEligibility: async () => {
    const response = await api.post('/exemptions/check');
    return response.data;
  },
};
