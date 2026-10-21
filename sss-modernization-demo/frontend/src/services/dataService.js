import api from './api';

export const dataService = {
  // STORY-005: when the caller's records last changed, and how quickly changes become visible (green, yellow, red)
  pipelineStatus: async () => (await api.get('/data/pipeline-status')).data,
};
