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
