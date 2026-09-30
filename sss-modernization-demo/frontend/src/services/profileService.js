import api from './api';

export const profileService = {
  getProfile: async (userId) => {
    const response = await api.get(`/users/${userId}`);
    return response.data;
  },

  // Saving the profile also re-runs exemption eligibility; the response carries it as `eligibility`.
  updateProfile: async (userId, { phone, address, annualIncome, hasDocumentedHardship }) => {
    const response = await api.put(`/users/${userId}`, {
      phone,
      address,
      annualIncome,
      hasDocumentedHardship,
    });
    return response.data;
  },
};
