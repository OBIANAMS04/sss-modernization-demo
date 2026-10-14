const TOKEN_KEY = 'auth_token';
const USER_KEY = 'user_data';

export const getToken = () => localStorage.getItem(TOKEN_KEY);

export const setToken = (token) => localStorage.setItem(TOKEN_KEY, token);

export const removeToken = () => localStorage.removeItem(TOKEN_KEY);

export const getUser = () => {
  const user = localStorage.getItem(USER_KEY);
  return user ? JSON.parse(user) : null;
};

export const setUser = (user) => localStorage.setItem(USER_KEY, JSON.stringify(user));

export const removeUser = () => localStorage.removeItem(USER_KEY);

export const isAuthenticated = () => !!getToken();

export const clearAuth = () => {
  removeToken();
  removeUser();
};

// STORY-003: after a correct password, an account with two-step verification gets a pending token, not a session. It
// lasts five minutes, opens nothing but the code check, and stays in this tab only (sessionStorage), so it is never
// mistaken for the session in localStorage.
const PENDING_KEY = 'mfa_pending_token';

export const getPendingMfaToken = () => sessionStorage.getItem(PENDING_KEY);

export const setPendingMfaToken = (token) => sessionStorage.setItem(PENDING_KEY, token);

export const clearPendingMfaToken = () => sessionStorage.removeItem(PENDING_KEY);
