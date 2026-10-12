import axios from 'axios';
import { getToken, removeToken } from '../utils/tokenManager';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001/api';

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json'
  }
});

api.interceptors.request.use(
  (config) => {
    const token = getToken();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // While signed in, a 401 means the session ended (expired, or past its 12-hour limit): say so on the sign-in page
      const hadSession = !!getToken();
      removeToken();
      window.location.href = hadSession ? '/login?expired=1' : '/login';
    }
    return Promise.reject(error);
  }
);

export default api;
