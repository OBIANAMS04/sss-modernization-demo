import api from './api';

export const authService = {
  register: async (email, password, fullName, ssn, dob) => {
    const response = await api.post('/auth/register', {
      email,
      password,
      fullName,
      ssn,
      dob
    });
    return response.data;
  },

  login: async (email, password) => {
    const response = await api.post('/auth/login', {
      email,
      password
    });
    return response.data;
  },

  // Records the sign-out in the audit log; signing out locally never waits on it
  logout: () => api.post('/auth/logout').catch(() => {})
};
