import { useState, useCallback } from 'react';
import api from '../services/api';

export const useApi = (endpoint, method = 'GET') => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const request = useCallback(async (payload = null) => {
    setLoading(true);
    setError(null);

    try {
      const config = {
        method,
        url: endpoint
      };

      if (payload && (method === 'POST' || method === 'PUT')) {
        config.data = payload;
      }

      const response = await api(config);
      setData(response.data);
      return response.data;
    } catch (err) {
      const errorMessage = err.response?.data?.message || 'An error occurred';
      setError(errorMessage);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [endpoint, method]);

  return { data, loading, error, request };
};
