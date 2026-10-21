import api from './api';

// STORY-028 and 029: the Observability page, for administrators only.
export const observabilityService = {
  // Service health, request and error rates, latency by route, recent server errors with trace ids, AI usage and cost per day, objectives and alerts.
  overview: async () => (await api.get('/observability')).data,
  // Checks every objective now instead of at the next minute; opens alerts for breaches and closes the recovered ones.
  evaluate: async () => (await api.post('/observability/evaluate')).data,
};
