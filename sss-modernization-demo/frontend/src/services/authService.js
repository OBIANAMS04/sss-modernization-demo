import api from './api';
import { getToken } from '../utils/tokenManager';

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

  // STORY-003: the second step of sign-in for an account with two-step verification. The pending token from the password
  // step goes in the body (there is no session yet); the response is the same { user, token } as login.
  // STORY-041: a recovery code instead of the 6-digit code; it works once
  verifyMfaRecovery: async (pendingToken, recoveryCode) => (await api.post('/auth/mfa/verify', { pendingToken, recoveryCode })).data,

  verifyMfa: async (pendingToken, code) => {
    const response = await api.post('/auth/mfa/verify', { pendingToken, code });
    return response.data;
  },

  // STORY-011 (WCAG 2.2.1): extends the session; the response carries the replacement token
  refresh: async () => {
    const response = await api.post('/auth/refresh');
    return response.data;
  },

  // Records the sign-out in the audit log; signing out locally never waits on it. Callers clear the token right after
  // calling this, and the request interceptor only reads it a moment later (so the sign-out was refused with a 401).
  // No body: a JSON "null" is refused by the server's strict JSON parser before the route runs.
  logout: () => {
    const token = getToken();
    // Signed out already (for example in another tab): nothing to record, and a request without a token is refused
    if (!token) return Promise.resolve();
    return api.post('/auth/logout', undefined, token ? { headers: { Authorization: `Bearer ${token}` } } : undefined).catch(() => {});
  }
};
