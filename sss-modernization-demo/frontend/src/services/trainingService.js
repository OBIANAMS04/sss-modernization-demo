import api from './api';

// STORY-035: the staff training portal
export const trainingService = {
  // { passMark, modules: [{ id, version, title, summary, minutes, sections, questions, status }] } for the caller's role
  mine: async () => (await api.get('/training')).data,

  // Graded on the server: { score, total, passed, passMark, results: [{ questionId, correct, correctOption, explanation }] }
  attempt: async (moduleId, answers) => (await api.post(`/training/${encodeURIComponent(moduleId)}/attempts`, { answers })).data,

  // Administrators: { modules, people: [{ email, fullName, role, modules, complete }] }
  progress: async () => (await api.get('/training/progress')).data,
};
