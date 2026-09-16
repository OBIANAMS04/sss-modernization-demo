import { useState, useEffect } from 'react';
import { getToken, getUser, isAuthenticated } from '../utils/tokenManager';

export const useAuth = () => {
  const [auth, setAuth] = useState({
    isAuthenticated: false,
    user: null,
    loading: true
  });

  useEffect(() => {
    const token = getToken();
    const user = getUser();

    setAuth({
      isAuthenticated: !!token,
      user: user || null,
      loading: false
    });
  }, []);

  return auth;
};
