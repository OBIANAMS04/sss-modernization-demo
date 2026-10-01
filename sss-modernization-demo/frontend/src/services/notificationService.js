import api from './api';

export const notificationService = {
  list: async (limit = 5) => (await api.get('/notifications', { params: { limit } })).data,
  markRead: async (id) => api.post(`/notifications/${id}/read`),
  markAllRead: async () => api.post('/notifications/read-all'),
};
