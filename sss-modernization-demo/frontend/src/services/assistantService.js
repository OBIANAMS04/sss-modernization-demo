import api from './api';

// STORY-018, 019, 022, 023: the policy assistant. Anyone signed in may ask, read their own history, open a cited passage and rate
// their own answers; the review queue and the quality figures are for case managers and admins.
export const assistantService = {
  // { question } -> the answer (or the matching policy sections) with its citations, oversight level and trace id.
  ask: async (question) => (await api.post('/assistant/ask', { question })).data,
  // The caller's own last 20 questions, newest first.
  history: async () => (await api.get('/assistant/history')).data.history,
  // One policy passage by id: its title, heading and text. This is what a citation opens.
  passage: async (id) => (await api.get('/assistant/passages', { params: { id } })).data.passage,
  // rating: 'helpful' | 'not-helpful' | 'problem'. A problem is reported to a case manager and the answer is withheld again.
  feedback: async (traceId, rating, comment) => (await api.post(`/assistant/${traceId}/feedback`, { rating, comment })).data,
  // Staff: withheld and reported exchanges, oldest first, and the latest reviews.
  reviews: async () => (await api.get('/assistant/reviews')).data,
  // Staff: { outcome: 'approved' | 'corrected' | 'declined', answer?, note }. The person is notified.
  review: async (traceId, review) => (await api.post(`/assistant/reviews/${traceId}`, review)).data,
  // Staff: how often answers failed the grounding check, against the 2% target.
  quality: async () => (await api.get('/assistant/quality')).data,
};
