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

  getProfile: async () => {
    const response = await api.get('/users/me');
    return response.data;
  },

  updateProfile: async (full_name) => {
    const response = await api.put('/users/me', {
      full_name
    });
    return response.data;
  }
};
