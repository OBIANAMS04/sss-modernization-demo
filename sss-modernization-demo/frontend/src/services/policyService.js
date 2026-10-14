import api from './api';

// STORY-016, admins only. The policy engine, the version in force, every rule and route with its state, and the last 20 versions.
export const policyService = {
  get: async () => (await api.get('/policies')).data,
  // changes: { rules?: { [id]: boolean }, routes?: { [route]: roles[] }, reason }. Saves a new version, which applies at once; returns what get returns.
  save: async (changes) => (await api.put('/policies', changes)).data,
};
